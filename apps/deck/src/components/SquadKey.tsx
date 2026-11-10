import type { DeckKey, DeckState, VoiceMember } from '@deck/protocol';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { categoryColors, colors, fonts, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Keycap } from './Keycap';

interface SquadKeyProps {
  keyDef: DeckKey;
  voice: DeckState['voice'];
  onPress: (key: DeckKey) => void;
}

const SHOWN = 3; // avatars that fit on a key; the rest become "+N"
const SIZE = 46;
const SPEAKING = '#3DD68C'; // Discord-style green ring while someone talks

/**
 * Who's in your Discord voice channel: overlapping avatars, a green ring on
 * whoever is talking, "+N" for the rest. Lit while you're in a call.
 */
export function SquadKey({ keyDef: k, voice, onPress }: SquadKeyProps) {
  const color = categoryColors[k.category];
  const channel = voice.channel;

  if (voice.incomingCall) {
    // Tap = answer (useDeck turns a squad press into discord.answerCall while ringing).
    const call = voice.incomingCall;
    return (
      <Keycap
        lit={false}
        glow
        color={SPEAKING}
        faceColor={RINGING_FACE}
        accessibilityLabel={`${call.name} is calling. Tap to answer`}
        onPress={() => onPress(k)}
      >
        <RingingFace name={call.name} avatarUrl={call.avatarUrl} />
      </Keycap>
    );
  }

  if (!channel) {
    // Not in a call (or Discord isn't linked/running): three empty seats.
    const why = voice.link === 'connected' ? 'Not in a voice channel' : voice.link === 'offline' ? 'Discord not running' : 'Discord not linked';
    return (
      <Keycap lit={false} color={color} accessibilityLabel={why} onPress={() => onPress(k)}>
        <View style={styles.row}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.avatar, styles.emptySeat, { borderColor: withAlpha(color, 0.45), marginLeft: i === 0 ? 0 : -12 }]}
            />
          ))}
        </View>
      </Keycap>
    );
  }

  const shown = voice.members.slice(0, SHOWN);
  const extra = channel.memberCount - shown.length;
  const speakingNames = voice.members.filter((m) => m.speaking).map((m) => m.name);
  const label =
    `In ${channel.name} with ${channel.memberCount} ${channel.memberCount === 1 ? 'person' : 'people'}` +
    (speakingNames.length ? `, ${speakingNames.join(' and ')} talking` : '');

  return (
    <Keycap lit color={color} accessibilityLabel={label} onPress={() => onPress(k)}>
      <View style={styles.row}>
        {shown.map((m, i) => (
          <Avatar key={m.id} member={m} ring={color} first={i === 0} />
        ))}
      </View>
      {extra > 0 ? (
        <View style={styles.extra}>
          <Text style={styles.extraText}>+{extra}</Text>
        </View>
      ) : null}
    </Keycap>
  );
}

function Avatar({ member: m, ring, first }: { member: VoiceMember; ring: string; first: boolean }) {
  // A ring in the face color separates overlapping avatars; green while talking.
  const shadow = m.speaking ? `0 0 0 2px ${ring}, 0 0 0 5px ${SPEAKING}` : `0 0 0 2px ${ring}`;
  return (
    <View
      style={[
        styles.avatar,
        { marginLeft: first ? 0 : -14, boxShadow: shadow, zIndex: m.speaking ? 2 : 1 },
        m.deafened && styles.deafened,
      ]}
    >
      {m.avatarUrl ? (
        <Image source={{ uri: m.avatarUrl }} style={styles.avatarImage} />
      ) : (
        <View style={[styles.avatarImage, styles.initials, { backgroundColor: colorFor(m.id) }]}>
          <Text style={styles.initialsText}>{(m.name.trim()[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

const RINGING_FACE = '#0C1F17'; // deep green behind the ripples
const CALLER = 62;
const RIPPLE_MS = 1800;

/**
 * Incoming call on a key: the caller's avatar with green ripples spreading out
 * (clipped by the key face) and a little phone badge that wiggles like a ringer.
 */
function RingingFace({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const wave = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ripples = Animated.loop(
      Animated.timing(wave, { toValue: 1, duration: RIPPLE_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    const ring = Animated.loop(
      Animated.sequence([
        ...[1, -1, 1, -1, 1, -1].map((dir) =>
          Animated.timing(wiggle, { toValue: dir, duration: 70, useNativeDriver: true }),
        ),
        Animated.timing(wiggle, { toValue: 0, duration: 70, useNativeDriver: true }),
        Animated.delay(700),
      ]),
    );
    ripples.start();
    ring.start();
    return () => {
      ripples.stop();
      ring.stop();
    };
  }, [wave, wiggle]);

  // Two ripples half a cycle apart, from one animated value:
  // a ripple grows from the avatar's size to 2.4× while fading out.
  const ripple = (second: boolean) => {
    // First ripple: progress = wave. Second: wave + 0.5, wrapping back to 0 halfway.
    const input = second ? [0, 0.5, 0.5001, 1] : [0, 1];
    const progress = second ? [0.5, 1, 0, 0.5] : [0, 1];
    return {
      opacity: wave.interpolate({ inputRange: input, outputRange: progress.map((p) => 0.65 * (1 - p)) }),
      transform: [{ scale: wave.interpolate({ inputRange: input, outputRange: progress.map((p) => 1 + 1.4 * p) }) }],
    };
  };

  return (
    <View style={styles.ringing}>
      <Animated.View style={[styles.ripple, ripple(false)]} />
      <Animated.View style={[styles.ripple, ripple(true)]} />
      <View style={styles.callerRing}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.caller} />
        ) : (
          <View style={[styles.caller, styles.initials, { backgroundColor: categoryColors.comms }]}>
            <Text style={[styles.initialsText, { fontSize: 26, color: colors.ink }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
      </View>
      <Animated.View
        style={[
          styles.phoneBadge,
          { transform: [{ rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }] },
        ]}
      >
        <Icon name="phone" size={15} strokeWidth={2.6} color={colors.ink} />
      </Animated.View>
    </View>
  );
}

const INITIAL_COLORS =['#3A2F6B', '#22394D', '#4A2A3A', '#2D4A3A', '#4A3A22'];

/** Same member, same color every time. */
function colorFor(id: string): string {
  let sum = 0;
  for (const ch of id) sum = (sum + ch.charCodeAt(0)) % 997;
  return INITIAL_COLORS[sum % INITIAL_COLORS.length]!;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  avatarImage: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden' },
  emptySeat: { borderWidth: 2, borderStyle: 'dashed' },
  deafened: { opacity: 0.45 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: fonts.ui700, fontSize: 18, color: '#FFFFFF' },
  extra: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.ink,
  },
  extraText: { fontFamily: fonts.mono500, fontSize: 12, color: '#FFFFFF' },
  ringing: { width: CALLER, height: CALLER, alignItems: 'center', justifyContent: 'center' },
  ripple: {
    position: 'absolute',
    width: CALLER,
    height: CALLER,
    borderRadius: CALLER / 2,
    borderWidth: 2,
    borderColor: SPEAKING,
    backgroundColor: 'rgba(61,214,140,0.12)',
  },
  callerRing: { borderRadius: CALLER / 2, boxShadow: `0 0 0 3px ${SPEAKING}, 0 0 18px rgba(61,214,140,0.6)` },
  caller: { width: CALLER, height: CALLER, borderRadius: CALLER / 2, overflow: 'hidden' },
  phoneBadge: {
    position: 'absolute',
    right: -8,
    bottom: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: SPEAKING,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 0 3px ${RINGING_FACE}`,
  },
});
