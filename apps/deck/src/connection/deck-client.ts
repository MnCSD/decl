import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ActionId,
  type AdjustId,
  type ClientMessage,
  type DeckState,
  type ServerMessage,
} from '@deck/protocol';
import type { Pairing, PcAddress } from './storage';

/**
 * The tablet's side of the WebSocket connection to the agent.
 * Plain TypeScript (no React), so the rules live in one readable place:
 * - authenticates with the saved token (`hello`) or pairs with a 6-digit code (`pair`),
 * - validates every incoming message with the shared zod schemas,
 * - reconnects with backoff when the connection drops,
 * - notices silently dead connections (Wi-Fi drop) with an app-level ping.
 */

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface DeckClientEvents {
  onStatus: (status: ConnectionStatus) => void;
  onState: (state: DeckState) => void;
  onIcons: (icons: Record<string, string>) => void;
  /** Custom ringtone from the PC (data: URL), or null = use the built-in chime. */
  onRingtone: (ringtone: string | null) => void;
  /** The agent no longer knows our token (device removed on the PC). We must pair again. */
  onUnpaired: () => void;
}

export type PairOutcome = { ok: true; pairing: Pairing } | { ok: false; error: string };

type WithoutVersion<T> = T extends unknown ? Omit<T, 'v'> : never;
type Outgoing = WithoutVersion<ClientMessage>;

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 10_000];
const PING_EVERY_MS = 10_000;
const DEAD_AFTER_MS = 25_000; // no message at all for this long = connection is gone
const ACTION_TIMEOUT_MS = 8000;
const PAIR_TIMEOUT_MS = 8000;

function urlFor(pc: PcAddress): string {
  return `ws://${pc.host}:${pc.port}`;
}

function encode(msg: Outgoing): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

/**
 * One-shot pairing: opens a socket, sends the code, and waits for a token.
 * Separate from DeckClient because it runs before we have a token.
 */
export function pairWithPc(pc: PcAddress, code: string, deviceName: string): Promise<PairOutcome> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: PairOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      resolve(outcome);
    };

    const ws = new WebSocket(urlFor(pc));
    const timer = setTimeout(
      () => finish({ ok: false, error: `No answer from ${pc.host}. Is the agent running?` }),
      PAIR_TIMEOUT_MS,
    );

    ws.onopen = () => ws.send(encode({ type: 'pair', code, deviceName }));
    ws.onmessage = (event) => {
      const parsed = parseServerMessage(String(event.data));
      if (!parsed.ok) return;
      const msg = parsed.message;
      if (msg.type === 'paired') finish({ ok: true, pairing: { ...pc, token: msg.token } });
      else if (msg.type === 'pairFailed') {
        finish({
          ok: false,
          error:
            msg.reason === 'locked'
              ? `Too many wrong codes. Try again in ${msg.retryAfterSec ?? 60} s.`
              : 'Wrong code. Check the code in the agent window.',
        });
      }
    };
    // Browsers/React Native give no details on why a socket failed, so keep it generic.
    ws.onerror = () => finish({ ok: false, error: `Couldn't reach ${pc.host}:${pc.port}. Same Wi-Fi? Agent running?` });
    ws.onclose = () => finish({ ok: false, error: `Connection to ${pc.host} closed before pairing finished.` });
  });
}

interface PendingAction {
  resolve: (result: { ok: boolean; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DeckClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'offline';
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private nextId = 1;
  private pending = new Map<string, PendingAction>();

  constructor(
    private readonly pairing: Pairing,
    private readonly events: DeckClientEvents,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.closeSocket();
    this.setStatus('offline');
  }

  /** Reconnect right away (e.g. app came back to the foreground) instead of waiting for the backoff. */
  retryNow(): void {
    if (this.stopped || this.status !== 'offline') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this.connect();
  }

  runAction(actionId: ActionId, params?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const id = String(this.nextId++);
    return this.request(id, { type: 'runAction', id, actionId, params });
  }

  adjust(actionId: AdjustId, value: number): Promise<{ ok: boolean; error?: string }> {
    const id = String(this.nextId++);
    return this.request(id, { type: 'adjust', id, actionId, value: Math.round(value) });
  }

  // -------------------------------------------------------------------------

  private request(id: string, msg: Outgoing): Promise<{ ok: boolean; error?: string }> {
    if (this.status !== 'online' || !this.ws) return Promise.resolve({ ok: false, error: 'PC is offline' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'No answer from the PC' });
      }, ACTION_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.ws!.send(encode(msg));
    });
  }

  private connect(): void {
    this.closeSocket();
    this.setStatus('connecting');

    const ws = new WebSocket(urlFor(this.pairing));
    this.ws = ws;

    ws.onopen = () => {
      this.lastMessageAt = Date.now();
      ws.send(encode({ type: 'hello', token: this.pairing.token }));
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      const parsed = parseServerMessage(String(event.data));
      if (!parsed.ok) {
        console.warn(`Ignoring bad message from agent: ${parsed.error}`);
        return;
      }
      this.handle(parsed.message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // an old socket we already replaced
      this.ws = null;
      this.stopPing();
      this.failPending('Connection lost');
      if (!this.stopped) this.scheduleReconnect();
    };
    // onerror is always followed by onclose, which does the cleanup.
    ws.onerror = () => {};
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.attempt = 0;
        this.setStatus('online');
        this.startPing();
        return;
      case 'state':
        this.events.onState(msg.state);
        return;
      case 'appIcons':
        this.events.onIcons(msg.icons);
        return;
      case 'sounds':
        this.events.onRingtone(msg.ringtone);
        return;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve({ ok: msg.ok, error: msg.error });
        return;
      }
      case 'authFailed':
        if (msg.reason === 'unknown-token') {
          this.stop();
          this.events.onUnpaired();
        }
        return;
      case 'error':
        console.warn(`Agent error: ${msg.message}`);
        return;
      case 'pong':
      case 'paired':
      case 'pairFailed':
        return;
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('offline');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * React Native's WebSocket doesn't expose protocol-level pings, so we send our own
   * `ping` and treat a long silence as a dead connection (e.g. tablet left the Wi-Fi).
   */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws) return;
      if (Date.now() - this.lastMessageAt > DEAD_AFTER_MS) {
        // Don't wait for a polite close over a dead network; drop it and reconnect.
        this.closeSocket();
        this.scheduleReconnect();
        return;
      }
      this.ws.send(encode({ type: 'ping' }));
    }, PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private closeSocket(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
    this.failPending('Connection closed');
  }

  private failPending(error: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error });
      this.pending.delete(id);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatus(status);
  }
}
