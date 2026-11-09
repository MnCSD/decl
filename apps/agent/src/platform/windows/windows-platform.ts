import type { ActionRequest, AdjustId } from '@deck/protocol';
import { loadAppIcons } from '../../apps/app-icons';
import type { AppEntry } from '../../apps/apps-config';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import { ActionError, type Platform } from '../types';
import { AppManager } from './apps';
import { SystemStatusPoller } from './system-status';

/**
 * The real Windows PC.
 * Implemented so far: live system status, app launch/focus with real icons.
 * Other actions are added per domain in later milestones, each in its own file here.
 */
export class WindowsPlatform implements Platform {
  readonly name = 'windows';
  private status: SystemStatusPoller | null = null;
  private appManager: AppManager | null = null;
  private icons: Promise<Record<string, string>> | null = null;

  constructor(
    private readonly log: Logger,
    private readonly apps: AppEntry[] = [],
  ) {}

  async start(store: StateStore): Promise<void> {
    this.icons = loadAppIcons(this.apps, this.log); // runs in the background
    this.status = new SystemStatusPoller(store, this.log);
    this.appManager = new AppManager(this.apps, store, this.log);
    await Promise.all([this.status.start(), this.appManager.start()]);
  }

  stop(): void {
    this.status?.stop();
    this.appManager?.stop();
  }

  getAppIcons(): Promise<Record<string, string>> {
    return this.icons ?? Promise.resolve({});
  }

  async runAction(req: ActionRequest): Promise<void> {
    switch (req.actionId) {
      case 'app.launch':
        return this.appManager!.launch(req.params.app);
      default:
        throw new ActionError(`"${req.actionId}" is not implemented on Windows yet`);
    }
  }

  async adjust(adjustId: AdjustId): Promise<void> {
    throw new ActionError(`"${adjustId}" is not implemented on Windows yet`);
  }
}
