import { z } from 'zod';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import type { WindowsHelper } from './helper';

const POLL_MS = 1000;

// What the helper's "status" command returns. Checked so a surprise from PowerShell
// can't put malformed data into the state the tablet receives.
const StatusSchema = z.object({
  volume: z.object({ level: z.number().min(0).max(100), muted: z.boolean() }).nullable(),
  media: z
    .object({
      playing: z.boolean(),
      title: z.string(),
      artist: z.string(),
      artUrl: z.string().startsWith('data:image/').nullable(),
    })
    .nullable(),
});

/**
 * Keeps `volume` and `media` in the state up to date by asking the helper once a second
 * (so changes made on the PC itself show up on the tablet too).
 */
export class MediaVolumePoller {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private failures = 0;

  constructor(
    private readonly helper: WindowsHelper,
    private readonly store: StateStore,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    await this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Polls now; called right after an action so the tablet updates without waiting a second. */
  async poll(): Promise<void> {
    if (this.busy) return; // previous poll still running (e.g. slow album art)
    this.busy = true;
    try {
      const status = StatusSchema.parse(await this.helper.call({ cmd: 'status' }));
      this.failures = 0;
      this.store.set('volume', status.volume ? { level: Math.round(status.volume.level), muted: status.volume.muted } : null);
      this.store.set('media', status.media);
    } catch (err) {
      // Log the first failure, not one per second.
      if (this.failures++ === 0) this.log.warn({ err }, 'Could not read volume/now playing');
    } finally {
      this.busy = false;
    }
  }
}
