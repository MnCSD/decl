import type { Category } from '@deck/protocol';

/** Design canvas size (Deck D). The whole UI is laid out at this size and scaled to fit the screen. */
export const CANVAS = { width: 1340, height: 800 };

export const KEY = { size: 140, gap: 18, radius: 26, padding: 7, faceRadius: 19 };

export const colors = {
  background: '#050507',
  cap: '#0B0B0E',
  capBorder: '#1C1C22',
  face: '#111116',
  text: '#ECECF1',
  textMuted: '#8E8E99',
  textSoft: '#A9A9B3',
  textFaint: '#6E6E78',
  chipText: '#C9C9D1',
  ink: '#0A0A0C', // dark text/icons on lit faces
  live: '#3DD68C', // green status dot
  ringTrack: '#26262E',
};

/** One color per category (strict). */
export const categoryColors: Record<Category, string> = {
  comms: '#8B7BFF',
  media: '#2FD39A',
  stream: '#FF5466',
  system: '#4CC3FF',
  home: '#FFB547',
  modes: '#A78BFA', // "room purple"
};

export const ROOM_PURPLE = categoryColors.modes;

/** Font family names exported by @expo-google-fonts (on Android the family name selects the weight). */
export const fonts = {
  ui500: 'Inter_500Medium',
  ui600: 'Inter_600SemiBold',
  ui700: 'Inter_700Bold',
  mono400: 'JetBrainsMono_400Regular',
  mono500: 'JetBrainsMono_500Medium',
};

/** '#RRGGBB' + alpha (0–1) -> 'rgba(r,g,b,a)'. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Shadows (React Native's CSS-like boxShadow; needs the New Architecture, which Expo uses). */
export const shadows = {
  capOff: '0 10px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)',
  capLit: (color: string) =>
    `0 0 34px ${withAlpha(color, 0.45)}, 0 10px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.10)`,
  faceRing: 'inset 0 0 0 1px rgba(0,0,0,0.6)',
  glow: (color: string, blur: number, alpha: number) => `0 0 ${blur}px ${withAlpha(color, alpha)}`,
};
