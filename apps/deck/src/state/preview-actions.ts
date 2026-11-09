import { ModeIdSchema, type DeckKey, type DeckState } from '@deck/protocol';

/**
 * M2 ONLY: fakes the result of a key press locally so on/off states can be
 * checked on the tablet before it talks to the agent. Replaced by the real
 * agent connection in M3.
 */
export function previewPress(key: DeckKey, s: DeckState): DeckState {
  if (key.type === 'app') {
    return { ...s, apps: s.apps.map((a) => (a.id === key.app ? { ...a, running: !a.running } : a)) };
  }

  const scene = typeof key.params?.scene === 'string' ? key.params.scene : null;

  switch (key.actionId) {
    case 'discord.toggleMute':
      return { ...s, voice: { ...s.voice, micMuted: !s.voice.micMuted } };
    case 'discord.toggleDeafen':
      return { ...s, voice: { ...s.voice, deafened: !s.voice.deafened } };
    case 'dnd.toggle':
      return { ...s, modes: { ...s.modes, dnd: !s.modes.dnd } };
    case 'obs.setScene':
      return scene ? { ...s, obs: { ...s.obs, scene } } : s;
    case 'obs.toggleRecord':
      return { ...s, obs: { ...s.obs, recording: !s.obs.recording, recordingSec: 0 } };
    case 'obs.toggleStream':
      return { ...s, obs: { ...s.obs, streaming: !s.obs.streaming } };
    case 'media.playPause':
      return s.media ? { ...s, media: { ...s.media, playing: !s.media.playing } } : s;
    case 'volume.toggleMute':
      return s.volume ? { ...s, volume: { ...s.volume, muted: !s.volume.muted } } : s;
    case 'light.toggle':
      return { ...s, light: { ...s.light, on: !s.light.on } };
    case 'light.off':
      return { ...s, light: { ...s.light, on: false } };
    case 'light.setColor':
      return { ...s, light: { ...s.light, on: true, rgb: String(key.params?.rgb ?? s.light.rgb) } };
    case 'mode.run': {
      const parsed = ModeIdSchema.safeParse(key.params?.mode);
      if (!parsed.success) return s;
      return { ...s, modes: { ...s.modes, active: s.modes.active === parsed.data ? null : parsed.data } };
    }
    default:
      return s;
  }
}
