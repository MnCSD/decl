/**
 * CLI test client: pretends to be the tablet.
 *
 *   npm run client -- pair 123456          pair once, saves the token
 *   npm run client -- status               print one state snapshot
 *   npm run client -- watch                print live state until Ctrl+C
 *   npm run client -- run media.playPause
 *   npm run client -- run obs.setScene '{"scene":"Chat"}'
 *   npm run client -- adjust volume.level 40
 *   npm run client -- actions              list known action ids
 *   npm run client -- icons ./out          save the app icons the agent sends
 *
 * Options: --host 192.168.2.8 (default 127.0.0.1), --port 4343
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import {
  ACTION_IDS,
  ADJUST_IDS,
  ActionIdSchema,
  AdjustIdSchema,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type DeckState,
  type ServerMessage,
} from '@deck/protocol';
import { defaultDataDir } from '../config';

let TOKEN_FILE = path.join(defaultDataDir(), 'cli-client.json');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function loadToken(): string {
  if (!fs.existsSync(TOKEN_FILE)) fail('Not paired yet. Run: npm run client -- pair <code>');
  return (JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as { token: string }).token;
}

function saveToken(token: string): void {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));
}

type WithoutVersion<T> = T extends unknown ? Omit<T, 'v'> : never;

/**
 * Wraps a socket with a message queue, so we never miss a message that arrives
 * before we start waiting for it.
 */
class Connection {
  private queue: ServerMessage[] = [];
  private waiters: Array<() => void> = [];
  closedReason: string | null = null;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) {
        console.error(`⚠ Bad message from agent: ${parsed.error}`);
        return;
      }
      this.queue.push(parsed.message);
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closedReason = `connection closed (${code}${reason.length ? `: ${reason}` : ''})`;
      this.wake();
    });
  }

  send(msg: WithoutVersion<ClientMessage>): void {
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
  }

  /** Resolves with the next message, or rejects if the socket closes / times out. */
  async next(timeoutMs = 5000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length === 0) {
      if (this.closedReason) throw new Error(this.closedReason);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for the agent');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.queue.shift()!;
  }

  /** Waits for a specific message type, printing errors that arrive meanwhile. */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const msg = await this.next(timeoutMs);
      if (msg.type === type) return msg as Extract<ServerMessage, { type: T }>;
      if (msg.type === 'error') console.error(`⚠ Agent error: ${msg.message}`);
      if (msg.type === 'authFailed') throw new Error(`authentication failed (${msg.reason})`);
      if (msg.type === 'pairFailed') {
        throw new Error(
          msg.reason === 'locked' ? `pairing locked, retry in ${msg.retryAfterSec ?? '?'}s` : 'wrong pairing code',
        );
      }
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

async function connect(host: string, port: number): Promise<Connection> {
  const url = `ws://${host}:${port}`;
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(new Error(`cannot connect to ${url}: ${err.message}`)));
  });
  return new Connection(ws);
}

/** Connects and authenticates with the saved token; returns the first state snapshot. */
async function connectAuthed(host: string, port: number): Promise<{ conn: Connection; state: DeckState }> {
  const conn = await connect(host, port);
  conn.send({ type: 'hello', token: loadToken() });
  await conn.waitFor('welcome');
  const { state } = await conn.waitFor('state');
  return { conn, state };
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatState(s: DeckState): string {
  const n = (v: number | null, unit: string) => (v === null ? '–' : `${v}${unit}`);
  const parts = [
    `up ${formatDuration(s.system.uptimeSec)}`,
    `CPU ${n(s.system.cpuPercent, '%')} ${n(s.system.cpuTempC, '°')}`,
    `GPU ${n(s.system.gpuTempC, '°')}`,
    s.volume ? `vol ${s.volume.level}${s.volume.muted ? ' (muted)' : ''}` : 'vol –',
    `mic ${s.voice.micMuted ? 'MUTED' : 'live'}${s.voice.deafened ? ' +deaf' : ''}`,
    s.media ? `${s.media.playing ? '▶' : '❚❚'} ${s.media.artist} – ${s.media.title}` : 'no media',
    s.obs.connected
      ? `OBS ${s.obs.scene ?? '?'}${s.obs.recording ? ` ● ${formatDuration(s.obs.recordingSec)}` : ''}${s.obs.streaming ? ' LIVE' : ''}`
      : 'OBS off',
    s.light.reachable ? `light ${s.light.on ? `${s.light.brightness}% ${s.light.rgb}` : 'off'}` : 'light –',
    `profile ${s.profile.id}${s.modes.active ? ` / ${s.modes.active}` : ''}${s.modes.dnd ? ' DND' : ''}`,
    `apps running: ${s.apps.filter((a) => a.running).map((a) => a.id).join(',') || 'none'}`,
  ];
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: String(DEFAULT_PORT) },
      name: { type: 'string', default: 'CLI test client' },
      'data-dir': { type: 'string' },
    },
  });
  if (values['data-dir']) TOKEN_FILE = path.join(values['data-dir'], 'cli-client.json');
  const host = values.host ?? '127.0.0.1';
  const port = Number(values.port);
  const [command, ...args] = positionals;

  switch (command) {
    case 'pair': {
      const code = (args[0] ?? '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) fail('Usage: pair <6-digit code>');
      const conn = await connect(host, port);
      conn.send({ type: 'pair', code, deviceName: values.name ?? 'CLI test client' });
      const paired = await conn.waitFor('paired');
      saveToken(paired.token);
      console.log(`✔ Paired as device ${paired.deviceId}. Token saved to ${TOKEN_FILE}`);
      conn.ws.close();
      return;
    }

    case 'status': {
      const { conn, state } = await connectAuthed(host, port);
      console.log(JSON.stringify(state, null, 2));
      conn.ws.close();
      return;
    }

    case 'watch': {
      const { conn, state } = await connectAuthed(host, port);
      const stamp = () => new Date().toLocaleTimeString();
      console.log(`[${stamp()}] ${formatState(state)}`);
      for (;;) {
        const msg = await conn.next(60 * 60_000);
        if (msg.type === 'state') console.log(`[${stamp()}] ${formatState(msg.state)}`);
      }
    }

    case 'run': {
      const actionId = ActionIdSchema.safeParse(args[0]);
      if (!actionId.success) fail(`Unknown action "${args[0] ?? ''}". Run "actions" to list them.`);
      let params: Record<string, unknown> | undefined;
      if (args[1]) {
        try {
          params = JSON.parse(args[1]) as Record<string, unknown>;
        } catch {
          fail('Params must be JSON, e.g. \'{"scene":"Chat"}\'');
        }
      }
      const { conn } = await connectAuthed(host, port);
      conn.send({ type: 'runAction', id: 'cli-1', actionId: actionId.data, params });
      const result = await conn.waitFor('result');
      if (result.ok) console.log(`✔ ${actionId.data} ok`);
      else console.log(`✖ ${actionId.data} failed: ${result.error}`);
      // Show the state the action produced (it arrives ~100 ms later).
      const update = await conn.waitFor('state', 1000).catch(() => null);
      if (update) console.log(formatState(update.state));
      conn.ws.close();
      return;
    }

    case 'adjust': {
      const adjustId = AdjustIdSchema.safeParse(args[0]);
      const value = Number(args[1]);
      if (!adjustId.success || !Number.isInteger(value)) {
        fail(`Usage: adjust <${ADJUST_IDS.join('|')}> <0-100>`);
      }
      const { conn } = await connectAuthed(host, port);
      conn.send({ type: 'adjust', id: 'cli-1', actionId: adjustId.data, value });
      const result = await conn.waitFor('result');
      console.log(result.ok ? `✔ ${adjustId.data} = ${value}` : `✖ failed: ${result.error}`);
      conn.ws.close();
      return;
    }

    case 'icons': {
      // Saves the app icons the agent sends: <out>/<appId>.png plus icons.json (id -> data URL).
      const outDir = args[0];
      if (!outDir) fail('Usage: icons <output folder>');
      const { conn } = await connectAuthed(host, port);
      const { icons } = await conn.waitFor('appIcons', 60_000);
      fs.mkdirSync(outDir, { recursive: true });
      for (const [id, dataUrl] of Object.entries(icons)) {
        fs.writeFileSync(path.join(outDir, `${id}.png`), Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
      }
      fs.writeFileSync(path.join(outDir, 'icons.json'), JSON.stringify(icons));
      console.log(`✔ Saved ${Object.keys(icons).length} icons to ${outDir}: ${Object.keys(icons).join(', ')}`);
      conn.ws.close();
      return;
    }

    case 'actions':
      console.log(`Actions:\n  ${ACTION_IDS.join('\n  ')}\nAdjust:\n  ${ADJUST_IDS.join('\n  ')}`);
      return;

    default:
      console.log('Commands: pair <code> | status | watch | run <actionId> [paramsJson] | adjust <id> <value> | icons <dir> | actions');
      console.log('Options:  --host <ip> (default 127.0.0.1)  --port <port> (default 4343)');
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
