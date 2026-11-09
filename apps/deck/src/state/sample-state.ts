import type { DeckState } from '@deck/protocol';
import sampleAppIcons from './sample-app-icons.json';

/**
 * Static data matching the Deck D design, used until the app connects to the
 * agent (M3). Same shape as the live state the agent sends.
 */
export const SAMPLE_STATE: DeckState = {
  agent: { version: 'sample', mock: true, hostname: 'DESKTOP' },
  system: { uptimeSec: 3 * 3600 + 12 * 60, cpuPercent: 14, cpuTempC: 38, gpuTempC: 52 },
  volume: { level: 72, muted: false },
  media: { playing: true, title: 'Midnight Drive', artist: 'Sample', artUrl: null },
  voice: { micMuted: true, deafened: false },
  obs: {
    connected: true,
    scene: 'Game',
    scenes: ['Game', 'Chat', 'BRB'],
    recording: true,
    recordingSec: 12 * 60 + 48,
    streaming: false,
  },
  light: { reachable: true, on: true, brightness: 60, rgb: '#A78BFA' },
  modes: { dnd: true, active: 'gaming' },
  apps: [
    { id: 'explorer', name: 'Explorer', running: false },
    { id: 'discord', name: 'Discord', running: true },
    { id: 'spotify', name: 'Spotify', running: true },
    { id: 'obs', name: 'OBS', running: false },
    { id: 'league', name: 'League', running: true },
    { id: 'chrome', name: 'Chrome', running: false },
    { id: 'edge', name: 'Edge', running: false },
    { id: 'vscode', name: 'VS Code', running: true },
  ],
  profile: { id: 'game', auto: true, reason: 'LEAGUE OPEN' },
};

/**
 * Real icons extracted by the agent on the dev laptop (`npm run client -- icons <dir>`),
 * used until the app receives them live from the agent in M3.
 */
export const SAMPLE_APP_ICONS: Record<string, string> = sampleAppIcons;

/** State that lives only on the tablet (the focus timer runs here, not on the PC). */
export interface LocalState {
  focus: { remainingSec: number; totalSec: number; running: boolean };
}

export const SAMPLE_LOCAL: LocalState = {
  focus: { remainingSec: 15 * 60 + 32, totalSec: 25 * 60, running: true },
};
