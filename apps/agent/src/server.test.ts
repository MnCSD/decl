import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createInitialState, parseServerMessage, type ServerMessage } from '@deck/protocol';
import { MockPlatform } from './platform/mock/mock-platform';
import { DeviceStore } from './security/device-store';
import { PairingManager } from './security/pairing';
import { DeckServer } from './server';
import { StateStore } from './state-store';

/** Opens a socket and collects every parsed message it receives. */
async function open(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: ServerMessage[] = [];
  let closeCode: number | null = null;
  ws.on('message', (d) => {
    const p = parseServerMessage(d.toString());
    if (p.ok) messages.push(p.message);
  });
  ws.on('close', (code) => (closeCode = code));
  await new Promise((r) => ws.once('open', r));
  const waitFor = async <T extends ServerMessage['type']>(type: T) => {
    for (let i = 0; i < 100; i++) {
      const m = messages.find((x) => x.type === type);
      if (m) return m as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no ${type} message`);
  };
  const send = (msg: object) => ws.send(JSON.stringify({ v: 1, ...msg }));
  return { ws, messages, waitFor, send, closeCode: () => closeCode };
}

describe('DeckServer (mock platform)', () => {
  let server: DeckServer;
  let pairing: PairingManager;
  let platform: MockPlatform;
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-server-'));
    const log = pino({ level: 'silent' });
    const store = new StateStore(createInitialState({ version: 'test', mock: true, hostname: 'test' }));
    platform = new MockPlatform(log);
    await platform.start(store);
    pairing = new PairingManager({ onNewCode: () => {} });
    server = new DeckServer({
      host: '127.0.0.1',
      port: 0, // any free port
      store,
      devices: new DeviceStore(path.join(dir, 'devices.json')),
      pairing,
      platform,
      log,
    });
    await server.start();
  });

  afterEach(async () => {
    platform.stop();
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pairs, reconnects with the token, and runs actions', async () => {
    const a = await open(server.port);
    a.send({ type: 'pair', code: pairing.currentCode(), deviceName: 'Test tablet' });
    const { token } = await a.waitFor('paired');
    expect((await a.waitFor('state')).state.voice.micMuted).toBe(true);
    a.ws.close();

    const b = await open(server.port);
    b.send({ type: 'hello', token });
    await b.waitFor('welcome');
    b.send({ type: 'runAction', id: 'r1', actionId: 'discord.toggleMute' });
    expect(await b.waitFor('result')).toMatchObject({ id: 'r1', ok: true });

    // A fresh snapshot shows the change.
    await new Promise((r) => setTimeout(r, 200));
    const states = b.messages.filter((m) => m.type === 'state');
    expect(states.at(-1)).toMatchObject({ state: { voice: { micMuted: false } } });
    b.ws.close();
  });

  it('returns a failed result for invalid params and failing actions', async () => {
    const c = await open(server.port);
    c.send({ type: 'pair', code: pairing.currentCode(), deviceName: 'T' });
    await c.waitFor('paired');
    c.send({ type: 'runAction', id: 'bad', actionId: 'obs.setScene', params: { scene: 'Nope' } });
    expect(await c.waitFor('result')).toMatchObject({ id: 'bad', ok: false, error: 'Scene "Nope" not found' });
    c.ws.close();
  });

  it('rejects unknown tokens and closes the socket', async () => {
    const c = await open(server.port);
    c.send({ type: 'hello', token: 'x'.repeat(43) });
    expect(await c.waitFor('authFailed')).toMatchObject({ reason: 'unknown-token' });
    await new Promise((r) => setTimeout(r, 50));
    expect(c.closeCode()).toBe(4001);
  });

  it('refuses actions before authentication', async () => {
    const c = await open(server.port);
    c.send({ type: 'runAction', id: 'x', actionId: 'system.lock' });
    expect(await c.waitFor('authFailed')).toMatchObject({ reason: 'not-authenticated' });
  });

  it('rejects a wrong pairing code', async () => {
    const c = await open(server.port);
    const wrong = pairing.currentCode() === '000000' ? '111111' : '000000';
    c.send({ type: 'pair', code: wrong, deviceName: 'T' });
    expect(await c.waitFor('pairFailed')).toMatchObject({ reason: 'wrong-code' });
  });
});
