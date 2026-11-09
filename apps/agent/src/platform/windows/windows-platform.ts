import fs from 'node:fs';
import path from 'node:path';
import type { ActionRequest, AdjustId } from '@deck/protocol';
import { loadAppIcons } from '../../apps/app-icons';
import type { AppEntry } from '../../apps/apps-config';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import { ActionError, type Platform } from '../types';
import { AppManager } from './apps';
import { run } from './exec';
import { WindowsHelper } from './helper';
import { MediaVolumePoller } from './media-volume';
import { SystemStatusPoller } from './system-status';

/** "2026-11-09_19-41-05" in local time (toISOString would be UTC). */
function localTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * The real Windows PC.
 * Implemented: live system status, volume + now playing, system and media actions,
 * app launch/focus with real icons. Discord/OBS/lights/modes come in M5.
 */
export class WindowsPlatform implements Platform {
  readonly name = 'windows';
  private status: SystemStatusPoller | null = null;
  private appManager: AppManager | null = null;
  private icons: Promise<Record<string, string>> | null = null;
  private helper: WindowsHelper;
  private mediaVolume: MediaVolumePoller | null = null;

  constructor(
    private readonly log: Logger,
    private readonly apps: AppEntry[] = [],
  ) {
    this.helper = new WindowsHelper(log);
  }

  async start(store: StateStore): Promise<void> {
    this.icons = loadAppIcons(this.apps, this.log); // runs in the background
    this.status = new SystemStatusPoller(store, this.log);
    this.appManager = new AppManager(this.apps, store, this.log);
    this.mediaVolume = new MediaVolumePoller(this.helper, store, this.log);

    const startHelper = this.helper
      .start()
      .then(() => this.mediaVolume!.start())
      .catch((err: unknown) => {
        // The rest of the agent still works; the helper keeps retrying in the background.
        this.log.error({ err }, 'Windows helper failed to start: volume, media and system actions unavailable');
      });
    await Promise.all([this.status.start(), this.appManager.start(), startHelper]);
  }

  stop(): void {
    this.status?.stop();
    this.appManager?.stop();
    this.mediaVolume?.stop();
    this.helper.stop();
  }

  getAppIcons(): Promise<Record<string, string>> {
    return this.icons ?? Promise.resolve({});
  }

  async runAction(req: ActionRequest): Promise<void> {
    switch (req.actionId) {
      case 'app.launch':
        return this.appManager!.launch(req.params.app);

      case 'system.lock':
      case 'system.screensOff':
      case 'system.sleep':
        return this.helperAction(req.actionId);
      case 'system.screenshot':
        return this.screenshot();
      // Implemented, but no key uses them until the long-press menu (M6) to avoid accidents.
      case 'system.shutdown':
        return this.shutdown(['/s', '/t', '0']);
      case 'system.restart':
        return this.shutdown(['/r', '/t', '0']);

      case 'media.playPause':
      case 'media.next':
      case 'media.previous':
      case 'volume.toggleMute':
        await this.helperAction(req.actionId);
        // Media apps take a moment to report the new track/state.
        void this.mediaVolume?.poll();
        setTimeout(() => void this.mediaVolume?.poll(), 400);
        return;

      default:
        throw new ActionError(`"${req.actionId}" is not implemented on Windows yet`);
    }
  }

  async adjust(adjustId: AdjustId, value: number): Promise<void> {
    if (adjustId === 'volume.level') {
      await this.callHelper({ cmd: 'volume.set', arg: value });
      void this.mediaVolume?.poll();
      return;
    }
    throw new ActionError(`"${adjustId}" is not implemented on Windows yet`);
  }

  // -------------------------------------------------------------------------

  private helperAction(
    cmd: 'system.lock' | 'system.screensOff' | 'system.sleep' | 'media.playPause' | 'media.next' | 'media.previous' | 'volume.toggleMute',
  ): Promise<void> {
    return this.callHelper({ cmd });
  }

  /** Calls the helper, turning its failures into messages the tablet can show. */
  private async callHelper(request: Parameters<WindowsHelper['call']>[0]): Promise<void> {
    try {
      await this.helper.call(request);
    } catch (err) {
      this.log.warn({ err, cmd: request.cmd }, 'Helper command failed');
      throw new ActionError(`Couldn't run ${request.cmd} on the PC`);
    }
  }

  /** Saves a PNG of all screens to Pictures\Screenshots (same folder Win+PrtScn uses). */
  private async screenshot(): Promise<void> {
    let pictures: string;
    try {
      pictures = String(await this.helper.call({ cmd: 'paths.pictures' }));
    } catch {
      throw new ActionError('Could not find the Pictures folder');
    }
    const folder = path.join(pictures, 'Screenshots');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `DeskDeck_${localTimestamp(new Date())}.png`);
    await this.callHelper({ cmd: 'system.screenshot', arg: file });
    this.log.info({ file }, 'Screenshot saved');
  }

  private async shutdown(args: string[]): Promise<void> {
    try {
      await run('shutdown.exe', args); // built-in Windows command; args are fixed above
    } catch (err) {
      this.log.warn({ err }, 'shutdown.exe failed');
      throw new ActionError('Windows refused to shut down');
    }
  }
}
