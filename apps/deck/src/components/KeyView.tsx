import type { AdjustId, DeckKey, DeckState } from '@deck/protocol';
import { Image, StyleSheet, Text, View } from 'react-native';
import { formatTimer, isLit, readRing } from '../state/bindings';
import type { LocalState } from '../state/local-state';
import { categoryColors, colors, fonts, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Keycap } from './Keycap';
import { NowPlayingKey } from './NowPlayingKey';
import { Ring } from './Ring';
import { SquadKey } from './SquadKey';
import { ValueKey } from './ValueKey';

interface KeyViewProps {
  keyDef: DeckKey;
  state: DeckState;
  local: LocalState;
  /** appId -> PNG data URL (real icons extracted on the PC) */
  appIcons: Record<string, string>;
  onPress: (key: DeckKey) => void;
  /** Value keys: a swipe set a new 0–100 value. */
  onAdjust: (adjustId: AdjustId, value: number) => void;
}

/** Size of the main artwork on a key face (the face itself is ~124 px). */
const ART = 64;

/** Short captions drawn inside rings, so CPU and GPU can be told apart without labels. */
const RING_CAPTIONS: Record<string, string> = { 'system.cpuTempC': 'CPU', 'system.gpuTempC': 'GPU' };

/**
 * Renders one key from the layout JSON, picking the look from its `type`.
 * Keys are artwork only (no text labels), like LCD keys; the label is still
 * used for accessibility.
 */
export function KeyView({ keyDef: k, state, local, appIcons, onPress, onAdjust }: KeyViewProps) {
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

    case 'value':
      // Own component: it has drag state (swipe up/down to adjust).
      return <ValueKey keyDef={k} state={state} onPress={onPress} onAdjust={onAdjust} />;

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
      return <NowPlayingKey keyDef={k} media={media} onPress={onPress} />;
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

    case 'squad':
      return <SquadKey keyDef={k} voice={state.voice} onPress={onPress} />;

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
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ink },
  timer: { fontFamily: fonts.mono500, fontSize: 30, letterSpacing: -1, includeFontPadding: false },
  swatches: { flexDirection: 'row', gap: 10 },
  swatch: { width: 22, height: 22, borderRadius: 11 },
});
