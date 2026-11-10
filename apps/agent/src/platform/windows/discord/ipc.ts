import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { z } from 'zod';

/**
 * Talks to the Discord desktop app over its local RPC pipe.
 * Discord listens on the Windows named pipe \\?\pipe\discord-ipc-0 (…-9 if several
 * Discord versions run at once). Nothing goes over the network.
 *
 * Every message is a "frame": 4-byte opcode + 4-byte length (little-endian), then JSON.
 * Requests carry a random `nonce`; Discord echoes it in the reply so we can match them.
 */

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 } as const;
const REQUEST_TIMEOUT_MS = 5000;

/** A reply from Discord with `evt: "ERROR"`, e.g. code 4006 = not authenticated. */
export class DiscordRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message);
  }
}

// Only the fields we use; Discord sends more (zod drops unknown fields).
const MessageSchema = z.object({
  cmd: z.string(),
  evt: z.string().nullish(),
  nonce: z.string().nullish(),
  data: z.unknown().optional(),
});

const ErrorDataSchema = z.object({ code: z.number().optional(), message: z.string().optional() });

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class DiscordIpc {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<string, Pending>();
  private onReady: ((data: unknown) => void) | null = null;

  /** Subscribed events (VOICE_STATE_UPDATE, …). */
  onEvent: (evt: string, data: unknown) => void = () => {};
  /** The pipe closed (Discord quit or restarted). Not called after close(). */
  onClose: () => void = () => {};

  /**
   * Opens the pipe and does the handshake. Resolves with the READY event's data.
   * `pipePath` is for tests (a fake Discord); normally the first discord-ipc-N is used.
   */
  async connect(clientId: string, pipePath?: string): Promise<unknown> {
    const socket = pipePath ? await connectPipe(pipePath) : await openPipe();
    this.socket = socket;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.handleClose(new Error('Discord closed the connection')));
    socket.on('error', () => {}); // 'close' follows and handles it

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onReady = null;
        reject(new Error('Discord did not answer the handshake'));
        this.close();
      }, REQUEST_TIMEOUT_MS);
      this.onReady = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      this.write(OP.HANDSHAKE, { v: 1, client_id: clientId });
    });
  }

  /** Sends a command and resolves with the reply's `data`. */
  request(cmd: string, args: Record<string, unknown> = {}, evt?: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (!this.socket) return Promise.reject(new Error('Not connected to Discord'));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord did not answer ${cmd}`));
      }, timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      this.write(OP.FRAME, { cmd, args, evt, nonce });
    });
  }

  subscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('SUBSCRIBE', args, evt);
  }

  unsubscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('UNSUBSCRIBE', args, evt);
  }

  close(): void {
    const socket = this.socket;
    this.onClose = () => {}; // closing on purpose: don't report it
    this.handleClose(new Error('Connection closed'));
    socket?.destroy();
  }

  // ---------------------------------------------------------------------------

  private write(op: number, payload: unknown): void {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    this.socket?.write(Buffer.concat([header, json]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // A chunk can hold part of a frame or several frames.
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length).toString('utf8');
      this.buffer = this.buffer.subarray(8 + length);

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        continue; // ignore garbage; Discord never sends it
      }
      if (op === OP.PING) this.write(OP.PONG, payload);
      else if (op === OP.CLOSE) {
        // e.g. { code: 4000, message: "Invalid Client ID" }
        const info = ErrorDataSchema.safeParse(payload);
        this.handleClose(new DiscordRpcError(info.success ? (info.data.message ?? 'Closed') : 'Closed', info.success ? info.data.code : undefined));
        this.socket?.destroy();
      } else if (op === OP.FRAME) this.onFrame(payload);
    }
  }

  private onFrame(payload: unknown): void {
    const parsed = MessageSchema.safeParse(payload);
    if (!parsed.success) return;
    const msg = parsed.data;

    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY' && this.onReady) {
      this.onReady(msg.data);
      this.onReady = null;
      return;
    }
    if (msg.nonce && this.pending.has(msg.nonce)) {
      const p = this.pending.get(msg.nonce)!;
      this.pending.delete(msg.nonce);
      clearTimeout(p.timer);
      if (msg.evt === 'ERROR') {
        const info = ErrorDataSchema.safeParse(msg.data);
        p.reject(new DiscordRpcError(info.success ? (info.data.message ?? 'Discord error') : 'Discord error', info.success ? info.data.code : undefined));
      } else {
        p.resolve(msg.data);
      }
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt) this.onEvent(msg.evt, msg.data);
  }

  private handleClose(err: Error): void {
    if (!this.socket) return;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.onClose();
  }
}

/** Connects to the first Discord pipe that exists (discord-ipc-0 … 9). */
async function openPipe(): Promise<net.Socket> {
  for (let i = 0; i < 10; i++) {
    try {
      return await connectPipe(`\\\\?\\pipe\\discord-ipc-${i}`);
    } catch {
      // not this one; try the next number
    }
  }
  throw new Error('Discord is not running');
}

function connectPipe(pipePath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}
