import type { DeckKey, DeckState } from '@deck/protocol';
import { Image, StyleSheet, Text, View } from 'react-native';
import { formatTimer, isLit, readRing, readValue } from '../state/bindings';
import type { LocalState } from '../state/sample-state';
import { categoryColors, colors, fonts, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Keycap } from './Keycap';
import { Ring } from './Ring';

interface KeyViewProps {
  keyDef: DeckKey;
  state: DeckState;
  local: LocalState;
  /** appId -> PNG data URL (real icons extracted on the PC) */
  appIcons: Record<string, string>;
  onPress: (key: DeckKey) => void;
}

/** Size of the main artwork on a key face (the face itself is ~124 px). */
const ART = 64;

/** Short captions drawn inside rings, so CPU and GPU can be told apart without labels. */
const RING_CAPTIONS: Record<string, string> = { 'system.cpuTempC': 'CPU', 'system.gpuTempC': 'GPU' };
/** Small icon above the number on value keys. */
const VALUE_ICONS: Record<string, string> = { 'volume.level': 'volume', 'light.brightness': 'bulb' };

/**
 * Renders one key from the layout JSON, picking the look from its `type`.
 * Keys are artwork only (no text labels), like LCD keys; the label is still
 * used for accessibility.
 */
export function KeyView({ keyDef: k, state, local, appIcons, onPress }: KeyViewProps) {
  const color = categoryColors[k.category];
  const press = () => onPress(k);

  switch (k.type) {
    case 'app': {
      // Real app icon, big, on a tile in the app's brand color; the cap glows while the app runs.
      const running = state.apps.find((a) => a.id === k.app)?.running ?? false;
      const icon = appIcons[k.app];
      return (
        <Keycap
          lit={false}
          glow={running}
          color={color}
          faceColor={k.color ?? color}
          accessibilityLabel={`${k.label}${running ? ', running' : ''}`}
          onPress={press}
        >
          {icon ? (
            <Image source={{ uri: icon }} style={styles.appIcon} />
          ) : (
            // Not in apps.json on the PC, or no icon yet.
            <Icon name="help" size={ART} color="rgba(255,255,255,0.85)" />
          )}
          {running ? <View style={styles.runningDot} /> : null}
        </Keycap>
      );
    }

    case 'button': {
      const lit = isLit(k.lit, state);
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={lit && k.onLabel ? k.onLabel : k.label} onPress={press}>
          <Icon name={lit && k.onIcon ? k.onIcon : k.icon} size={ART} strokeWidth={1.8} color={lit ? colors.ink : color} />
        </Keycap>
      );
    }

    case 'value': {
      // Big number; the face fills from the bottom like liquid.
      const data = readValue(k.source, state);
      const on = data?.on ?? false;
      const fill = on && data ? data.value : 0;
      return (
        <Keycap
          lit={false}
          color={color}
          accessibilityLabel={`${k.label} ${data ? data.value : 'unavailable'}${on ? '' : ', off'}`}
          onPress={press}
          background={
            fill > 0 ? (
              <View
                style={[
                  styles.fill,
                  { height: `${fill}%`, backgroundColor: withAlpha(color, 0.32), borderTopColor: color },
                ]}
              />
            ) : null
          }
        >
          <Icon name={VALUE_ICONS[k.source] ?? 'help'} size={22} strokeWidth={2.2} color={on ? color : colors.textFaint} />
          <Text style={[styles.bigNumber, { color: on ? colors.text : colors.textFaint }]}>{data ? data.value : '–'}</Text>
        </Keycap>
      );
    }

    case 'ring': {
      const data = readRing(k.source, state, local);
      return (
        <Keycap lit color={color} accessibilityLabel={`${k.label} ${data?.text ?? 'unavailable'}`} onPress={press}>
          <Ring
            size={88}
            progress={data?.progress ?? 0}
            text={data?.text ?? '–'}
            caption={RING_CAPTIONS[k.source]}
            color={colors.ink}
            trackColor={withAlpha(colors.ink, 0.18)}
            textColor={colors.ink}
            fontSize={k.source === 'focus' ? 18 : 20}
          />
        </Keycap>
      );
    }

    case 'nowPlaying': {
      const media = state.media;
      if (!media) {
        return (
          <Keycap lit={false} color={color} accessibilityLabel="Nothing playing" onPress={press}>
            <Icon name="play" size={ART} color={color} />
          </Keycap>
        );
      }
      return (
        <Keycap
          lit={false}
          color={color}
          accessibilityLabel={`${media.playing ? 'Pause' : 'Play'}, now playing ${media.title}`}
          onPress={press}
          background={<AlbumArt uri={media.artUrl} />}
        >
          <View style={styles.playButton}>
            <Icon name={media.playing ? 'pause' : 'play'} size={26} strokeWidth={2.6} color={colors.ink} />
          </View>
        </Keycap>
      );
    }

    case 'recording': {
      const lit = state.obs.recording;
      return (
        <Keycap
          lit={lit}
          color={color}
          accessibilityLabel={lit ? `Recording ${formatTimer(state.obs.recordingSec)}, tap to stop` : k.label}
          onPress={press}
        >
          {lit ? (
            <View style={styles.timerRow}>
              <View style={styles.recDot} />
              <Text style={[styles.timer, { color: colors.ink }]}>{formatTimer(state.obs.recordingSec)}</Text>
            </View>
          ) : (
            <Icon name="record" size={ART} color={color} />
          )}
        </Keycap>
      );
    }

    case 'folder':
      return (
        <Keycap lit color={color} accessibilityLabel={`${k.label} folder`} onPress={press}>
          <Icon name={k.icon} size={ART} strokeWidth={1.8} color={colors.ink} />
        </Keycap>
      );

    case 'squad': {
      const lit = isLit(k.lit, state);
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={k.label} onPress={press}>
          <View style={styles.avatars}>
            {AVATAR_COLORS.map((c, i) => (
              <View
                key={c}
                style={[
                  styles.avatar,
                  { backgroundColor: c, marginLeft: i === 0 ? 0 : -14 },
                  i === 0 && { boxShadow: `0 0 0 2px ${color}` },
                ]}
              />
            ))}
          </View>
        </Keycap>
      );
    }

    case 'swatches': {
      const lit = isLit(k.lit, state);
      // A single color fills the whole face; several colors show as a row of dots.
      if (k.colors.length === 1) {
        return <Keycap lit={false} color={color} faceColor={k.colors[0]} accessibilityLabel={k.label} onPress={press} />;
      }
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={k.label} onPress={press}>
          <View style={styles.swatches}>
            {k.colors.map((c, i) => (
              <View
                key={`${c}-${i}`}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  i === 0 && { boxShadow: `0 0 0 2px ${colors.face}, 0 0 0 4px #FFFFFF` },
                ]}
              />
            ))}
          </View>
        </Keycap>
      );
    }
  }
}

// Placeholder voice-channel avatars (real members come with Discord in M5).
const AVATAR_COLORS = ['#3A2F6B', '#22394D', '#4A2A3A'];

/** Album art filling the face, slightly dimmed so the play button stands out. */
function AlbumArt({ uri }: { uri: string | null }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        // No art yet: abstract placeholder from the design.
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#16112A' }]}>
          <View style={styles.artBlob} />
          <View style={styles.artDot} />
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  appIcon: { width: 76, height: 76 },
  runningDot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 0 0 2px rgba(0,0,0,0.45), 0 0 8px rgba(255,255,255,0.8)',
  },
  bigNumber: {
    fontFamily: fonts.mono500,
    fontSize: 44,
    letterSpacing: -1.5,
    lineHeight: 48,
    marginTop: 2,
    includeFontPadding: false,
  },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 2 },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ink },
  timer: { fontFamily: fonts.mono500, fontSize: 30, letterSpacing: -1, includeFontPadding: false },
  avatars: { flexDirection: 'row' },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.face },
  swatches: { flexDirection: 'row', gap: 10 },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  artBlob: {
    position: 'absolute',
    left: -24,
    bottom: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#A78BFA',
  },
  artDot: {
    position: 'absolute',
    right: 18,
    top: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2FD39A',
  },
});
