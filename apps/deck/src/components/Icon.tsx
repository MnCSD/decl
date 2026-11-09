import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Stroke icons (24×24 grid), copied from the Deck D design.
 * Layout JSON refers to them by name, e.g. "icon": "mic".
 */
type Shape =
  | { d: string }
  | { rect: [x: number, y: number, w: number, h: number, r: number] }
  | { circle: [cx: number, cy: number, r: number]; fill?: boolean };

const ICONS: Record<string, Shape[]> = {
  mic: [{ rect: [9, 3, 6, 11, 3] }, { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }],
  micOff: [
    { d: 'M3 3l18 18' },
    { d: 'M9 9v2a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3' },
    { d: 'M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3' },
  ],
  headphones: [{ d: 'M4 15v-3a8 8 0 0 1 16 0v3' }, { rect: [3, 14, 5, 7, 2] }, { rect: [16, 14, 5, 7, 2] }],
  chat: [{ d: 'M4 5h16v11H9l-5 4z' }],
  pause: [{ d: 'M9 5v14M15 5v14' }],
  play: [{ d: 'M8 5l11 7-11 7z' }],
  next: [{ d: 'M6 6v12l9-6z' }, { d: 'M18 6v12' }],
  previous: [{ d: 'M18 6v12l-9-6z' }, { d: 'M6 6v12' }],
  moon: [{ d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' }],
  scene: [{ rect: [3, 4, 18, 13, 2] }, { d: 'M7 21h10' }, { d: 'M3 13l5-4 4 3 3-2 6 4' }],
  record: [{ circle: [12, 12, 8] }, { circle: [12, 12, 3.5], fill: true }],
  clip: [{ d: 'M4 7l3-3h10l3 3v10l-3 3H7l-3-3z' }, { d: 'M10 9l5 3-5 3z' }],
  flag: [{ d: 'M5 21V4' }, { d: 'M5 4h11l-2 4 2 4H5' }],
  broadcast: [
    { circle: [12, 12, 2] },
    { d: 'M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8' },
  ],
  camera: [{ rect: [3, 7, 18, 13, 2] }, { circle: [12, 13.5, 3.5] }, { d: 'M8 7l1.5-3h5L16 7' }],
  monitor: [{ rect: [3, 4, 18, 12, 1.5] }, { d: 'M9 20h6M12 16v4' }],
  eyeOff: [
    { d: 'M3 3l18 18' },
    { d: 'M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.7M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1' },
  ],
  lock: [{ rect: [5, 11, 14, 9, 2] }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  power: [{ d: 'M12 3v8' }, { d: 'M6.3 7.5a8 8 0 1 0 11.4 0' }],
  folder: [{ d: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z' }],
  gamepad: [
    { rect: [3, 7, 18, 11, 4] },
    { d: 'M8 10.5v4M6 12.5h4' },
    { circle: [15.5, 11.5, 1] },
    { circle: [17.5, 13.8, 1] },
  ],
  book: [{ d: 'M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z' }, { d: 'M4 20a2 2 0 0 0 2 2h13v-4' }],
  film: [{ rect: [3, 4, 18, 16, 2] }, { d: 'M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4' }],
  bulb: [
    { d: 'M9 18h6M10 21h4' },
    { d: 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
  ],
  send: [{ d: 'M4 12l16-8-6 16-3-7z' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  gear: [
    { circle: [12, 12, 3] },
    { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' },
  ],
  help: [{ circle: [12, 12, 9] }, { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.5v.01' }],
};

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

interface IconProps {
  name: string;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 42, color, strokeWidth = 1.9 }: IconProps) {
  const shapes = ICONS[name] ?? ICONS.help!; // unknown name in the layout JSON -> "?" icon
  const common = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {shapes.map((s, i) => {
        if ('d' in s) return <Path key={i} d={s.d} {...common} />;
        if ('rect' in s) {
          const [x, y, w, h, r] = s.rect;
          return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} {...common} />;
        }
        const [cx, cy, r] = s.circle;
        return <Circle key={i} cx={cx} cy={cy} r={r} {...common} fill={s.fill ? color : 'none'} />;
      })}
    </Svg>
  );
}
