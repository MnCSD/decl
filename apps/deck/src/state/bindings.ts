import type { DeckKey, DeckState, Lit, LitSource } from '@deck/protocol';
import type { LocalState } from './local-state';

/**
 * Turns layout bindings ("lit when voice.micMuted") into values from the state.
 * Only the fixed sources listed in the protocol are readable.
 */

function readLitSource(source: LitSource, s: DeckState): boolean | string | null {
  switch (source) {
    case 'voice.micMuted':
      return s.voice.micMuted;
    case 'voice.deafened':
      return s.voice.deafened;
    case 'voice.inCall':
      return s.voice.channel !== null;
    case 'volume.muted':
      return s.volume?.muted ?? null;
    case 'obs.scene':
      return s.obs.scene;
    case 'obs.recording':
      return s.obs.recording;
    case 'obs.streaming':
      return s.obs.streaming;
    case 'light.on':
      return s.light.on;
    case 'modes.dnd':
      return s.modes.dnd;
    case 'modes.active':
      return s.modes.active;
  }
}

export function isLit(lit: Lit | undefined, s: DeckState): boolean {
  if (!lit) return false;
  if (lit === 'always') return true;
  const value = readLitSource(lit.source, s);
  return lit.equals !== undefined ? value === lit.equals : value === true;
}

/** Value keys: 0–100 plus whether the thing is "on" (not muted / light on). */
export function readValue(
  source: Extract<DeckKey, { type: 'value' }>['source'],
  s: DeckState,
): { value: number; on: boolean } | null {
  if (source === 'volume.level') return s.volume ? { value: s.volume.level, on: !s.volume.muted } : null;
  return s.light.reachable ? { value: s.light.brightness, on: s.light.on } : null;
}

/** Ring keys: progress 0–1 and the text in the middle. */
export function readRing(
  source: Extract<DeckKey, { type: 'ring' }>['source'],
  s: DeckState,
  local: LocalState,
): { progress: number; text: string } | null {
  if (source === 'focus') {
    const { remainingSec, totalSec } = local.focus;
    const m = Math.floor(remainingSec / 60);
    const sec = String(remainingSec % 60).padStart(2, '0');
    return { progress: totalSec > 0 ? remainingSec / totalSec : 0, text: `${m}:${sec}` };
  }
  const temp = source === 'system.cpuTempC' ? s.system.cpuTempC : s.system.gpuTempC;
  if (temp === null) return null;
  return { progress: Math.min(1, temp / 100), text: `${Math.round(temp)}°` };
}

/** "12:48" or "1:02:03" */
export function formatTimer(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = String(Math.floor(totalSec % 60)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
