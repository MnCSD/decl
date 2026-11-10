import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  parseActionRequest,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '@deck/protocol';
import type { Logger } from './logger';
import { ActionError, type Platform } from './platform/types';
import type { DeviceRecord, DeviceStore } from './security/device-store';
import { isPrivateAddress } from './security/net';
import type { PairingManager } from './security/pairing';
import type { StateStore } from './state-store';

const AUTH_TIMEOUT_MS = 15_000; // unauthenticated sockets are dropped after this
const HEARTBEAT_MS = 15_000;
const BROADCAST_THROTTLE_MS = 100; // coalesce bursts of state changes into one snapshot
const MAX_MESSAGE_BYTES = 64 * 1024;

// Custom WebSocket close codes (4000–4999 are reserved for applications).
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_BAD_MESSAGE = 4002;

/** Distributes Omit over a union, so each message variant keeps its own fields. */
type WithoutVersion<T> = T extends unknown ? Omit<T, 'v'> : never;
type OutgoingMessage = WithoutVersion<ServerMessage>;

interface Client {
  ws: WebSocket;
  ip: string;
  device: DeviceRecord | null;
  alive: boolean;
  authTimer: NodeJS.Timeout | null;
}

export interface ServerDeps {
  host: string;
  port: number;
  store: StateStore;
  devices: DeviceStore;
  pairing: PairingManager;
  platform: Platform;
  log: Logger;
  /** Custom ringtone (data: URL) from the data folder, or null for the tablet's built-in chime. */
  ringtone?: string | null;
}

export class DeckServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<Client>();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ServerDeps) {}

  /** The actual port (useful when started with port 0 in tests). */
  get port(): number {
    return (this.wss?.address() as AddressInfo).port;
  }

  async start(): Promise<void> {
    const { host, port, log } = this.deps;

    const wss = new WebSocketServer({
      host,
      port,
      maxPayload: MAX_MESSAGE_BYTES,
      // Runs before the WebSocket handshake completes: refuse anything not on the LAN.
      verifyClient: (info, done) => {
        const ip = info.req.socket.remoteAddress;
        if (isPrivateAddress(ip)) return done(true);
        log.warn({ ip }, 'Rejected connection from non-private address');
        done(false, 403, 'Forbidden');
      },
    });
    this.wss = wss;

    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    wss.on('error', (err) => log.error({ err }, 'WebSocket server error'));
    wss.on('connection', (ws, req) => this.onConnection(ws, req));

    this.unsubscribe = this.deps.store.onChange(() => this.scheduleBroadcast());

    // Heartbeat: ping every client; if it didn't answer the previous ping, it's gone
    // (e.g. the tablet lost Wi-Fi without closing the socket), so drop it.
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          client.ws.terminate();
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }, HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    for (const client of this.clients) client.ws.terminate();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  // -------------------------------------------------------------------------

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const client: Client = { ws, ip, device: null, alive: true, authTimer: null };
    this.clients.add(client);
    this.deps.log.debug({ ip }, 'Socket connected');

    client.authTimer = setTimeout(() => {
      this.send(ws, { type: 'authFailed', reason: 'timeout' });
      ws.close(CLOSE_AUTH_FAILED, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(CLOSE_BAD_MESSAGE, 'Binary messages are not supported');
        return;
      }
      // Catch everything: an unhandled promise rejection would crash the whole agent.
      this.onMessage(client, data.toString()).catch((err: unknown) => {
        this.deps.log.error({ err }, 'Error while handling message');
        this.send(ws, { type: 'error', message: 'Internal error' });
      });
    });
    ws.on('close', () => {
      if (client.authTimer) clearTimeout(client.authTimer);
      this.clients.delete(client);
      if (client.device) this.deps.log.info({ device: client.device.name, ip }, 'Device disconnected');
    });
    ws.on('error', (err) => this.deps.log.warn({ err, ip }, 'Socket error'));
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send(client.ws, { type: 'error', message: parsed.error });
      // Unauthenticated sockets sending garbage get no second chance.
      if (!client.device) client.ws.close(CLOSE_BAD_MESSAGE, 'Invalid message');
      return;
    }
    const msg = parsed.message;

    if (msg.type === 'ping') {
      this.send(client.ws, { type: 'pong' });
      return;
    }

    if (!client.device) {
      if (msg.type === 'hello') return this.handleHello(client, msg.token);
      if (msg.type === 'pair') return this.handlePair(client, msg.code, msg.deviceName);
      this.send(client.ws, { type: 'authFailed', reason: 'not-authenticated' });
      client.ws.close(CLOSE_AUTH_FAILED, 'Not authenticated');
      return;
    }

    switch (msg.type) {
      case 'runAction':
        return this.handleRunAction(client, msg);
      case 'adjust':
        return this.handleAdjust(client, msg);
      case 'hello':
      case 'pair':
        this.send(client.ws, { type: 'error', message: 'Already authenticated' });
        return;
    }
  }

  private handleHello(client: Client, token: string): void {
    const device = this.deps.devices.findByToken(token);
    if (!device) {
      this.deps.log.warn({ ip: client.ip }, 'Rejected connection with unknown token');
      this.send(client.ws, { type: 'authFailed', reason: 'unknown-token' });
      client.ws.close(CLOSE_AUTH_FAILED, 'Unknown token');
      return;
    }
    this.authenticate(client, device);
  }

  private handlePair(client: Client, code: string, deviceName: string): void {
    const attempt = this.deps.pairing.attempt(code);
    if (attempt.result !== 'ok') {
      this.deps.log.warn({ ip: client.ip, result: attempt.result }, 'Pairing attempt failed');
      this.send(
        client.ws,
        attempt.result === 'locked'
          ? { type: 'pairFailed', reason: 'locked', retryAfterSec: attempt.retryAfterSec }
          : { type: 'pairFailed', reason: 'wrong-code' },
      );
      client.ws.close(CLOSE_AUTH_FAILED, 'Pairing failed');
      return;
    }

    const { device, token } = this.deps.devices.add(deviceName);
    this.deps.log.info({ device: device.name, deviceId: device.id, ip: client.ip }, 'Paired new device');
    this.send(client.ws, { type: 'paired', deviceId: device.id, token });
    this.authenticate(client, device);
  }

  private authenticate(client: Client, device: DeviceRecord): void {
    if (client.authTimer) clearTimeout(client.authTimer);
    client.authTimer = null;
    client.device = device;
    try {
      this.deps.devices.touch(device.id); // "last seen" is nice-to-have; never block a login on it
    } catch (err) {
      this.deps.log.warn({ err }, 'Could not update device last-seen time');
    }
    this.deps.log.info({ device: device.name, ip: client.ip }, 'Device connected');
    this.send(client.ws, { type: 'welcome', deviceId: device.id, deviceName: device.name });
    this.send(client.ws, { type: 'state', state: this.deps.store.get() });
    void this.sendAppIcons(client);
    this.send(client.ws, { type: 'sounds', ringtone: this.deps.ringtone ?? null });
  }

  /** Icons can take a few seconds to extract at startup, so they're sent when ready. */
  private async sendAppIcons(client: Client): Promise<void> {
    try {
      const icons = await this.deps.platform.getAppIcons();
      if (Object.keys(icons).length > 0) this.send(client.ws, { type: 'appIcons', icons });
    } catch (err) {
      this.deps.log.warn({ err }, 'Could not send app icons');
    }
  }

  private async handleRunAction(client: Client, msg: Extract<ClientMessage, { type: 'runAction' }>): Promise<void> {
    const parsed = parseActionRequest(msg.actionId, msg.params);
    if (!parsed.ok) {
      this.send(client.ws, { type: 'result', id: msg.id, ok: false, error: parsed.error });
      return;
    }
    this.deps.log.info({ device: client.device?.name, actionId: msg.actionId }, 'Run action');
    await this.execute(client, msg.id, () => this.deps.platform.runAction(parsed.request));
  }

  private async handleAdjust(client: Client, msg: Extract<ClientMessage, { type: 'adjust' }>): Promise<void> {
    this.deps.log.debug({ device: client.device?.name, actionId: msg.actionId, value: msg.value }, 'Adjust');
    await this.execute(client, msg.id, () => this.deps.platform.adjust(msg.actionId, msg.value));
  }

  /** Runs an action and always answers with a `result` message. */
  private async execute(client: Client, id: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.send(client.ws, { type: 'result', id, ok: true });
    } catch (err) {
      // ActionError messages are written for the user; anything else is unexpected, so hide details.
      const message = err instanceof ActionError ? err.message : 'Action failed on the PC';
      if (!(err instanceof ActionError)) this.deps.log.error({ err }, 'Unexpected action error');
      this.send(client.ws, { type: 'result', id, ok: false, error: message });
    }
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const state = this.deps.store.get();
      for (const client of this.clients) {
        if (client.device) this.send(client.ws, { type: 'state', state });
      }
    }, BROADCAST_THROTTLE_MS);
  }

  private send(ws: WebSocket, message: OutgoingMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  }
}
