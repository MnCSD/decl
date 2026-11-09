import { spawn } from 'node:child_process';
import path from 'node:path';
import type { AppEntry } from '../../apps/apps-config';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import { ActionError } from '../types';
import { run, runPowerShell } from './exec';

const RUNNING_POLL_MS = 3000;

// Brings the first window of a process to the front. The process name comes in via
// an environment variable, not pasted into the script.
// Note: Windows only lets background programs steal focus in some situations, so
// sometimes the taskbar button flashes instead. That's a Windows rule, not a bug.
const FOCUS_SCRIPT = `
$p = Get-Process -Name $env:DECK_PROC -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p -and (New-Object -ComObject WScript.Shell).AppActivate($p.Id)) { 'ok' }
`;

/** Lowercase names of all running processes, via the built-in `tasklist` command. */
export async function listRunningProcesses(): Promise<Set<string>> {
  const out = await run('tasklist.exe', ['/fo', 'csv', '/nh'], 5000);
  const names = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line); // first CSV column = image name
    if (match?.[1]) names.add(match[1].toLowerCase());
  }
  return names;
}

/** Tracks which allow-listed apps are running and launches/focuses them. */
export class AppManager {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();

  constructor(
    private readonly apps: AppEntry[],
    private readonly store: StateStore,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    await this.poll();
    this.timer = setInterval(() => void this.poll(), RUNNING_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async launch(appId: string): Promise<void> {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) throw new ActionError(`App "${appId}" is not in apps.json`);

    const isRunning = app.process !== null && this.running.has(app.process);
    if (isRunning && app.whenRunning !== 'launch') {
      if (await this.focus(app)) return;
      if (app.whenRunning === 'focus-only') throw new ActionError(`${app.name} is running but couldn't be brought to front`);
    }
    await this.spawnDetached(app);
    setTimeout(() => void this.poll(), 1500); // pick up the new process quickly
  }

  private async focus(app: AppEntry): Promise<boolean> {
    try {
      const name = path.win32.basename(app.process!, '.exe');
      return (await runPowerShell(FOCUS_SCRIPT, 5000, { DECK_PROC: name })).trim() === 'ok';
    } catch {
      return false;
    }
  }

  /** Starts the app as an independent process (it keeps running if the agent stops). */
  private spawnDetached(app: AppEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(app.path, app.args, {
        cwd: path.win32.dirname(app.path), // some apps (e.g. OBS) need their own folder as working dir
        detached: true,
        stdio: 'ignore',
      });
      child.once('spawn', () => {
        child.unref();
        this.log.info({ app: app.id }, 'Launched app');
        resolve();
      });
      child.once('error', (err) => {
        this.log.warn({ err, app: app.id }, 'Could not launch app');
        reject(new ActionError(`Couldn't start ${app.name}`));
      });
    });
  }

  private async poll(): Promise<void> {
    try {
      this.running = await listRunningProcesses();
    } catch (err) {
      this.log.debug({ err }, 'tasklist failed');
      return;
    }
    this.store.set(
      'apps',
      this.apps.map((a) => ({ id: a.id, name: a.name, running: a.process !== null && this.running.has(a.process) })),
    );
  }
}
