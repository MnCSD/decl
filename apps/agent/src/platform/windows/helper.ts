import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../../logger';

const HOST_SCRIPT = fileURLToPath(new URL('./helper/helper-host.ps1', import.meta.url));
const CSHARP_SOURCE = fileURLToPath(new URL('./helper/DeckHelper.cs', import.meta.url));

const STARTUP_TIMEOUT_MS = 30_000; // first start compiles C#; slow PCs/antivirus can take a while
const CALL_TIMEOUT_MS = 5_000;
const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * Commands the helper understands (see helper/helper-host.ps1).
 * Each takes a fixed kind of argument that the agent itself supplies.
 */
export type HelperCall =
  | { cmd: 'status' }
  | { cmd: 'paths.pictures' }
  | { cmd: 'volume.set'; arg: number }
  | { cmd: 'volume.toggleMute' }
  | { cmd: 'media.playPause' }
  | { cmd: 'media.next' }
  | { cmd: 'media.previous' }
  | { cmd: 'system.lock' }
  | { cmd: 'system.screensOff' }
  | { cmd: 'system.screenshot'; arg: string }
  | { cmd: 'system.sleep' };

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface Reply {
  id?: number;
  ready?: boolean;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

/**
 * A long-running PowerShell process with our C# code compiled into it.
 * Starting PowerShell + compiling takes ~1 s, so we do it once and then send
 * one-line JSON commands over stdin; replies come back as JSON lines on stdout.
 * If the process dies, pending calls fail and it restarts automatically.
 */
export class WindowsHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stopped = false;
  private restarts = 0;

  constructor(private readonly log: Logger) {}

  /** Starts the helper and waits until it's ready (C# compiled, media API loaded). */
  start(): Promise<void> {
    this.stopped = false;
    this.ready = this.spawnProcess();
    return this.ready;
  }

  stop(): void {
    this.stopped = true;
    this.proc?.stdin.end(); // the script's read loop ends when stdin closes
    this.proc?.kill();
    this.proc = null;
  }

  /** Sends one command and resolves with its `data`. Rejects with the helper's error message. */
  async call(request: HelperCall, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    if (!this.ready) throw new Error('Helper not started');
    await this.ready;
    const proc = this.proc;
    if (!proc) throw new Error('Helper is not running');

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Helper call "${request.cmd}" timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    });
  }

  // -------------------------------------------------------------------------

  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HOST_SCRIPT],
        { windowsHide: true, env: { ...process.env, DECK_HELPER_CS: CSHARP_SOURCE } },
      );
      this.proc = proc;
      let isReady = false;

      const startupTimer = setTimeout(() => {
        if (isReady) return;
        reject(new Error('Windows helper did not start in time'));
        proc.kill();
      }, STARTUP_TIMEOUT_MS);

      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        let reply: Reply;
        try {
          reply = JSON.parse(line) as Reply;
        } catch {
          this.log.debug({ line }, 'Helper printed a non-JSON line');
          return;
        }
        if (reply.ready) {
          isReady = true;
          this.restarts = 0;
          clearTimeout(startupTimer);
          this.log.info('Windows helper ready');
          resolve();
          return;
        }
        this.settle(reply);
      });

      // PowerShell writes errors (e.g. a C# compile error) to stderr.
      readline.createInterface({ input: proc.stderr }).on('line', (line) => {
        if (line.trim()) this.log.warn({ line }, 'Windows helper stderr');
      });

      proc.on('error', (err) => {
        clearTimeout(startupTimer);
        reject(err);
      });

      proc.on('exit', (code) => {
        clearTimeout(startupTimer);
        if (this.proc === proc) this.proc = null;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Windows helper stopped'));
          this.pending.delete(id);
        }
        if (!isReady) reject(new Error(`Windows helper exited during startup (code ${code})`));
        if (this.stopped) return;

        const delay = RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)]!;
        this.restarts++;
        this.log.warn({ code, retryInMs: delay }, 'Windows helper exited; restarting');
        setTimeout(() => {
          if (this.stopped) return;
          this.ready = this.spawnProcess();
          this.ready.catch((err: unknown) => this.log.error({ err }, 'Windows helper restart failed'));
        }, delay);
      });
    });
  }

  private settle(reply: Reply): void {
    if (typeof reply.id !== 'number') return;
    const p = this.pending.get(reply.id);
    if (!p) return; // already timed out
    this.pending.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.ok) p.resolve(reply.data ?? null);
    else p.reject(new Error(reply.error ?? 'Helper command failed'));
  }
}
