import type { DeckKey, DeckState } from '@deck/protocol';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { categoryColors } from '../theme';
import { Keycap } from './Keycap';

interface NowPlayingKeyProps {
  keyDef: DeckKey;
  media: NonNullable<DeckState['media']>;
  onPress: (key: DeckKey) => void;
}

/**
 * Album art edge to edge, like a cover on a shelf. Tap = play/pause.
 * Playing: bright art, glowing cap, little animated equalizer in the corner.
 * Paused: art dimmed with a big play triangle.
 */
export function NowPlayingKey({ keyDef: k, media, onPress }: NowPlayingKeyProps) {
  const color = categoryColors[k.category];
  return (
    <Keycap
      lit={false}
      glow={media.playing}
      color={color}
      accessibilityLabel={`${media.playing ? 'Pause' : 'Play'}, now playing ${media.title}${media.artist ? ` by ${media.artist}` : ''}`}
      onPress={() => onPress(k)}
      background={
        media.artUrl ? (
          <Image source={{ uri: media.artUrl }} style={styles.fill} resizeMode="cover" />
        ) : (
          // No art (some players don't share it): abstract placeholder from the design.
          <View style={[styles.fill, styles.placeholder]}>
            <View style={styles.artBlob} />
            <View style={styles.artDot} />
          </View>
        )
      }
    >
      {media.playing ? (
        <View style={styles.eqPill}>
          <Equalizer />
        </View>
      ) : (
        <>
          <View style={[styles.fill, styles.dim]} />
          <PlayTriangle />
        </>
      )}
    </Keycap>
  );
}

/** Filled, slightly rounded play triangle with a soft shadow so it reads on any cover. */
function PlayTriangle() {
  return (
    <View style={styles.playShadow}>
      <Svg width={46} height={46} viewBox="0 0 24 24">
        <Path d="M8 4.8c0-.8.9-1.3 1.6-.9l10 6.4c.6.4.6 1.3 0 1.7l-10 6.4c-.7.4-1.6-.1-1.6-.9z" fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

const BAR_TIMINGS = [420, 300, 520]; // ms per up/down; different so the bars don't move in sync

/** Three bouncing bars: "this is playing right now". Runs on the native UI thread. */
function Equalizer() {
  const bars = useRef(BAR_TIMINGS.map(() => new Animated.Value(0.4))).current;

  useEffect(() => {
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: BAR_TIMINGS[i]!, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: BAR_TIMINGS[i]!, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);

  return (
    <View style={styles.eq}>
      {bars.map((v, i) => (
        <Animated.View key={i} style={[styles.eqBar, { transform: [{ scaleY: v }] }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  placeholder: { backgroundColor: '#16112A' },
  playShadow: { filter: 'drop-shadow(0px 2px 6px rgba(0,0,0,0.6))' },
  eqPill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 14 },
  // transformOrigin bottom: bars grow up from the baseline instead of from the middle.
  eqBar: { width: 3, height: 14, borderRadius: 1.5, backgroundColor: '#FFFFFF', transformOrigin: 'bottom' },
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
