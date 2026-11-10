import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '@deck/protocol';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { StateStore } from '../../../state-store';
import { avatarUrl } from './avatars';
import { saveCredentials } from './credentials';
import { DiscordVoice } from './discord-voice';
import { DiscordIpc, DiscordRpcError } from './ipc';

const SELF = '111111111111111111';
const FRIEND = '222222222222222222';

/** Encodes one Discord IPC frame: opcode + length (little-endian) + JSON. */
function frame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

type Msg = { cmd: string; args: Record<string, unknown>; evt?: string; nonce: string };

/**
 * A pretend Discord app on a test pipe. `handle` answers each command;
 * `push` sends an event. Frames are split in two on purpose to test reassembly.
 */
function fakeDiscord(handle: (msg: Msg) => unknown) {
  const pipe = `\\\\?\\pipe\\deskdeck-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const sockets: net.Socket[] = [];
  const received: Msg[] = [];
  const send = (s: net.Socket, payload: unknown) => {
    const buf = frame(1, payload);
    s.write(buf.subarray(0, 5));
    s.write(buf.subarray(5));
  };
  const server = net.createServer((s) => {
    sockets.push(s);
    let buf = Buffer.alloc(0);
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
        const op = buf.readInt32LE(0);
        const body = JSON.parse(buf.subarray(8, 8 + buf.readInt32LE(4)).toString());
        buf = buf.subarray(8 + buf.readInt32LE(4));
        if (op === 0) {
          send(s, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1, user: { id: SELF, username: 'me' } } });
        } else {
          const msg = body as Msg;
          received.push(msg);
          const reply = handle(msg);
          if (reply instanceof Error) {
            send(s, { cmd: msg.cmd, evt: 'ERROR', nonce: msg.nonce, data: { code: 4006, message: reply.message } });
          } else {
            send(s, { cmd: msg.cmd, evt: msg.evt ?? null, nonce: msg.nonce, data: reply });
          }
        }
      }
    });
  });
  return {
    pipe,
    received,
    listen: () => new Promise<void>((r) => server.listen(pipe, r)),
    push: (evt: string, data: unknown) => sockets.forEach((s) => send(s, { cmd: 'DISPATCH', evt, data })),
    close: () => {
      sockets.forEach((s) => s.destroy());
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const waitFor = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('avatarUrl', () => {
  it('builds CDN urls only from valid ids and hashes', () => {
    expect(avatarUrl(FRIEND, 'a'.repeat(32))).toBe(`https://cdn.discordapp.com/avatars/${FRIEND}/${'a'.repeat(32)}.png?size=64`);
    expect(avatarUrl(FRIEND, null)).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
    expect(avatarUrl('../../evil', null)).toBeNull();
    expect(avatarUrl(FRIEND, '../x')).toMatch(/embed\/avatars/); // bad hash -> default avatar, never in the url
  });
});

// Named pipes as written here are Windows-only.
describe.runIf(process.platform === 'win32')('Discord local RPC (fake Discord)', () => {
  let cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of cleanup) await c();
    cleanup = [];
  });

  it('IPC: handshake, matched replies, errors and events', async () => {
    const discord = fakeDiscord((msg) => (msg.cmd === 'BAD' ? new Error('Not authenticated') : { echo: msg.args }));
    await discord.listen();
    cleanup.push(discord.close);

    const ipc = new DiscordIpc();
    cleanup.push(async () => ipc.close());
    const ready = await ipc.connect('123456789', discord.pipe);
    expect(ready).toMatchObject({ user: { id: SELF } });

    const [a, b] = await Promise.all([ipc.request('ONE', { n: 1 }), ipc.request('TWO', { n: 2 })]);
    expect(a).toEqual({ echo: { n: 1 } });
    expect(b).toEqual({ echo: { n: 2 } });

    const err = await ipc.request('BAD').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscordRpcError);
    expect((err as DiscordRpcError).code).toBe(4006);

    const events: string[] = [];
    ipc.onEvent = (evt) => events.push(evt);
    discord.push('VOICE_SETTINGS_UPDATE', { mute: true });
    await waitFor(() => events.length === 1);
    expect(events).toEqual(['VOICE_SETTINGS_UPDATE']);
  });

  it('DiscordVoice: reads the channel, follows speaking/leaving, toggles mute', async () => {
    const settings = { mute: false, deaf: false };
    const discord = fakeDiscord((msg) => {
      switch (msg.cmd) {
        case 'AUTHENTICATE':
          return msg.args.access_token === 'good-token' ? { user: { id: SELF, username: 'me' } } : new Error('Invalid token');
        case 'GET_VOICE_SETTINGS':
          return settings;
        case 'SET_VOICE_SETTINGS':
          Object.assign(settings, msg.args);
          return settings;
        case 'GET_SELECTED_VOICE_CHANNEL':
          return {
            id: '333',
            name: 'Duo queue',
            voice_states: [
              { nick: null, user: { id: SELF, username: 'me', avatar: null }, voice_state: { self_mute: false } },
              { nick: 'Eleni', user: { id: FRIEND, username: 'eleni99', avatar: null }, voice_state: { self_deaf: true } },
            ],
          };
        default:
          return {}; // SUBSCRIBE etc.
      }
    });
    await discord.listen();
    cleanup.push(discord.close);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdeck-discord-'));
    const credsFile = path.join(dir, 'discord.json');
    // Valid for 7 days, so no refresh (= no internet) is needed.
    saveCredentials(credsFile, {
      clientId: '123456789',
      clientSecret: 'secret',
      accessToken: 'good-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    });

    const store = new StateStore(createInitialState({ version: 't', mock: false, hostname: 'pc' }));
    const voice = new DiscordVoice(credsFile, store, pino({ level: 'silent' }), discord.pipe);
    cleanup.push(async () => {
      voice.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    voice.start();

    await waitFor(() => store.get().voice.link === 'connected');
    let v = store.get().voice;
    expect(v.channel).toEqual({ name: 'Duo queue', memberCount: 2 });
    // Others first, us last; nickname wins over username.
    expect(v.members.map((m) => m.name)).toEqual(['Eleni', 'me']);
    expect(v.members[0]).toMatchObject({ deafened: true, speaking: false });
    // It followed the channel's events.
    const subs = discord.received.filter((m) => m.cmd === 'SUBSCRIBE').map((m) => m.evt);
    expect(subs).toEqual(expect.arrayContaining(['VOICE_SETTINGS_UPDATE', 'VOICE_CHANNEL_SELECT', 'SPEAKING_START', 'VOICE_STATE_DELETE']));

    discord.push('SPEAKING_START', { user_id: FRIEND });
    await waitFor(() => store.get().voice.members[0]?.speaking === true);

    await voice.toggleMute();
    expect(settings.mute).toBe(true);
    expect(store.get().voice.micMuted).toBe(true);

    discord.push('VOICE_STATE_DELETE', { nick: 'Eleni', user: { id: FRIEND, username: 'eleni99' } });
    await waitFor(() => store.get().voice.channel?.memberCount === 1);
    v = store.get().voice;
    expect(v.members.map((m) => m.name)).toEqual(['me']);

    // A normal message notification is not a call.
    discord.push('NOTIFICATION_CREATE', { channel_id: '444', message: { type: 0, author: { id: FRIEND, username: 'eleni99' } } });
    // A call notification (message type 3) rings.
    discord.push('NOTIFICATION_CREATE', {
      channel_id: '555',
      message: { type: 3, author: { id: FRIEND, username: 'eleni99', global_name: 'Eleni' } },
    });
    await waitFor(() => store.get().voice.incomingCall !== null);
    expect(store.get().voice.incomingCall).toEqual({ name: 'Eleni', avatarUrl: null });

    await voice.answerCall();
    expect(discord.received.find((m) => m.cmd === 'SELECT_VOICE_CHANNEL')?.args).toEqual({ channel_id: '555', force: true });
    expect(store.get().voice.incomingCall).toBeNull();
    await expect(voice.answerCall()).rejects.toThrow(/Nobody is calling/);
  });

  it('DiscordVoice: says "notSetUp" without discord.json, and actions explain why', async () => {
    const store = new StateStore(createInitialState({ version: 't', mock: false, hostname: 'pc' }));
    const voice = new DiscordVoice(path.join(os.tmpdir(), 'deskdeck-missing', 'discord.json'), store, pino({ level: 'silent' }), '\\\\?\\pipe\\nope');
    cleanup.push(async () => voice.stop());
    voice.start();
    await waitFor(() => store.get().voice.link === 'notSetUp');
    await expect(voice.toggleMute()).rejects.toThrow(/discord:setup/);
  });
});
