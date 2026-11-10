import type { ActionRequest, AdjustId, ModeId } from '@deck/protocol';
import { loadAppIcons } from '../../apps/app-icons';
import type { AppEntry } from '../../apps/apps-config';
import type { Logger } from '../../logger';
import type { StateStore } from '../../state-store';
import { ActionError, type Platform } from '../types';

const TRACKS = [
  { title: 'Midnight City', artist: 'M83' },
  { title: 'Intro', artist: 'The xx' },
  { title: 'Nightcall', artist: 'Kavinsky' },
];

/** Fake voice channel; the last one is "us". */
const MOCK_MEMBERS = ['Nikos', 'Eleni', 'Kostas', 'You'];

const MODE_LIGHT: Record<ModeId, { on: boolean; brightness: number; rgb: string }> = {
  gaming: { on: true, brightness: 70, rgb: '#A78BFA' },
  study: { on: true, brightness: 90, rgb: '#FFF4E0' },
  movie: { on: true, brightness: 15, rgb: '#FFB547' },
  goodnight: { on: false, brightness: 0, rgb: '#FFB547' },
};

/** Moves `value` randomly by up to ±step, kept within [min, max]. */
function wander(value: number, step: number, min: number, max: number): number {
  const next = value + (Math.random() * 2 - 1) * step;
  return Math.round(Math.min(max, Math.max(min, next)));
}

/**
 * Simulated PC: live-looking stats and actions that change state as the real
 * ones will. Nothing here touches the real system.
 */
export class MockPlatform implements Platform {
  readonly name = 'mock';
  private store!: StateStore;
  private timer: NodeJS.Timeout | null = null;
  private trackIndex = 0;
  private seconds = 0;
  private icons: Promise<Record<string, string>> | null = null;

  constructor(
    private readonly log: Logger,
    private readonly apps: AppEntry[] = [],
  ) {}

  getAppIcons(): Promise<Record<string, string>> {
    return this.icons ?? Promise.resolve({});
  }

  async start(store: StateStore): Promise<void> {
    this.store = store;
    this.icons = loadAppIcons(this.apps, this.log); // real icons even in mock mode
    // Pretend a couple of apps are already open.
    store.set(
      'apps',
      this.apps.map((a) => ({ id: a.id, name: a.name, running: ['discord', 'spotify', 'league'].includes(a.id) })),
    );
    store.set('system', { uptimeSec: 3 * 3600 + 12 * 60, cpuPercent: 14, cpuTempC: 52, gpuTempC: 38 });
    store.set('volume', { level: 72, muted: false });
    store.set('media', { playing: true, ...TRACKS[0]!, artUrl: null });
    store.set('voice', {
      link: 'connected',
      micMuted: true,
      deafened: false,
      channel: { name: 'Duo queue', memberCount: 4 },
      incomingCall: null,
      members: MOCK_MEMBERS.map((name, i) => ({
        id: String(1000 + i),
        name,
        avatarUrl: null, // the tablet draws initials
        speaking: false,
        muted: false,
        deafened: false,
      })),
    });
    store.set('obs', {
      connected: true,
      scene: 'Game',
      scenes: ['Game', 'Chat', 'BRB'],
      recording: true,
      recordingSec: 12 * 60 + 48,
      streaming: false,
    });
    store.set('light', { reachable: true, on: true, brightness: 60, rgb: '#A78BFA' });
    store.set('profile', { id: 'game', auto: true, reason: 'LEAGUE OPEN' });

    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.store.update('system', (s) => ({
      uptimeSec: s.uptimeSec + 1,
      cpuPercent: wander(s.cpuPercent ?? 15, 6, 3, 95),
      cpuTempC: wander(s.cpuTempC ?? 50, 1, 40, 85),
      gpuTempC: wander(s.gpuTempC ?? 40, 1, 33, 80),
    }));
    this.store.update('obs', (o) => (o.recording ? { ...o, recordingSec: o.recordingSec + 1 } : o));
    // Friends talk now and then (not us: we're the last member).
    this.store.update('voice', (v) => ({
      ...v,
      members: v.members.map((m, i) => ({ ...m, speaking: i < v.members.length - 1 && Math.random() < 0.35 })),
    }));
    // A fake incoming call: rings 10 s after start for 30 s, then every 2 minutes.
    this.seconds++;
    const t = this.seconds % 120;
    if (t === 10) this.store.update('voice', (v) => ({ ...v, incomingCall: { name: 'Eleni', avatarUrl: null } }));
    if (t === 40) this.store.update('voice', (v) => ({ ...v, incomingCall: null }));
  }

  async runAction(req: ActionRequest): Promise<void> {
    await new Promise((r) => setTimeout(r, 60)); // pretend there's some latency
    this.log.info({ actionId: req.actionId, params: req.params }, '[mock] action');
    const s = this.store;

    switch (req.actionId) {
      case 'system.lock':
      case 'system.sleep':
      case 'system.shutdown':
      case 'system.restart':
      case 'system.screensOff':
      case 'system.screenshot':
        // Real effects come in M3; in mock mode we only log them.
        return;

      case 'media.playPause':
        s.update('media', (m) => (m ? { ...m, playing: !m.playing } : m));
        return;
      case 'media.next':
      case 'media.previous': {
        const delta = req.actionId === 'media.next' ? 1 : -1;
        this.trackIndex = (this.trackIndex + delta + TRACKS.length) % TRACKS.length;
        s.set('media', { playing: true, ...TRACKS[this.trackIndex]!, artUrl: null });
        return;
      }
      case 'volume.toggleMute':
        s.update('volume', (v) => (v ? { ...v, muted: !v.muted } : v));
        return;

      case 'discord.toggleMute':
        s.update('voice', (v) => ({ ...v, micMuted: !v.micMuted }));
        return;
      case 'discord.toggleDeafen':
        // Discord also mutes the mic while deafened.
        s.update('voice', (v) => ({ ...v, micMuted: !v.deafened ? true : v.micMuted, deafened: !v.deafened }));
        return;
      case 'discord.answerCall': {
        const call = s.get().voice.incomingCall;
        if (!call) throw new ActionError('Nobody is calling');
        s.update('voice', (v) => ({ ...v, incomingCall: null, channel: { name: call.name, memberCount: v.members.length } }));
        return;
      }
      case 'discord.dismissCall':
        s.update('voice', (v) => ({ ...v, incomingCall: null }));
        return;

      case 'obs.setScene': {
        const { scene } = req.params;
        if (!s.get().obs.scenes.includes(scene)) throw new ActionError(`Scene "${scene}" not found`);
        s.update('obs', (o) => ({ ...o, scene }));
        return;
      }
      case 'obs.toggleRecord':
        s.update('obs', (o) => ({ ...o, recording: !o.recording, recordingSec: 0 }));
        return;
      case 'obs.toggleStream':
        s.update('obs', (o) => ({ ...o, streaming: !o.streaming }));
        return;
      case 'obs.saveReplay':
        return;
      case 'obs.addMarker':
        // Deliberate failure path so the tablet's error flash can be tested.
        if (!s.get().obs.recording) throw new ActionError('Not recording');
        return;

      case 'light.toggle':
        s.update('light', (l) => ({ ...l, on: !l.on, brightness: !l.on && l.brightness === 0 ? 60 : l.brightness }));
        return;
      case 'light.off':
        s.update('light', (l) => ({ ...l, on: false }));
        return;
      case 'light.setColor':
        s.update('light', (l) => ({ ...l, on: true, rgb: req.params.rgb }));
        return;

      case 'dnd.toggle':
        s.update('modes', (m) => ({ ...m, dnd: !m.dnd }));
        return;
      case 'mode.run': {
        const mode = req.params.mode;
        s.update('light', (l) => ({ ...l, ...MODE_LIGHT[mode] }));
        s.set('modes', { dnd: mode !== 'goodnight', active: mode });
        if (mode === 'gaming') s.update('obs', (o) => ({ ...o, scene: 'Game' }));
        return;
      }

      case 'app.launch': {
        const { app } = req.params;
        if (!s.get().apps.some((a) => a.id === app)) throw new ActionError(`App "${app}" is not in apps.json`);
        s.update('apps', (apps) => apps.map((a) => (a.id === app ? { ...a, running: true } : a)));
        return;
      }
    }
  }

  async adjust(adjustId: AdjustId, value: number): Promise<void> {
    this.log.info({ adjustId, value }, '[mock] adjust');
    if (adjustId === 'volume.level') {
      this.store.update('volume', (v) => (v ? { level: value, muted: value === 0 ? v.muted : false } : v));
    } else {
      this.store.update('light', (l) => ({ ...l, on: value > 0, brightness: value }));
    }
  }
}
