import type { DeckState } from '@deck/protocol';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { categoryColors, colors, fonts } from '../theme';
import { Icon } from './Icon';

interface IncomingCallProps {
  call: NonNullable<DeckState['voice']['incomingCall']>;
  /** Your own ringtone from the PC (data: URL), or null = the built-in chime. */
  ringtone: string | null;
  onAnswer: () => void;
  onDismiss: () => void;
}

const CHIME = require('../../assets/sounds/ring-chime.wav') as number; // original chime made for this app
const RING_VOLUME = 0.6; // a bit quieter than Discord ringing on the PC at the same time

const ANSWER = '#3DD68C';
const DECLINE = '#3A3A44';
const BUZZ_EVERY_MS = 1500; // the tablet buzzes like a ringing phone

/**
 * Banner that slides down over the top bar while someone calls on Discord.
 * Answer = join the call on the PC. Ignore = hide it here (Discord keeps ringing on the PC).
 */
export function IncomingCall({ call, ringtone, onAnswer, onDismiss }: IncomingCallProps) {
  const slide = useRef(new Animated.Value(-140)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Ring (looping) for as long as this banner is on screen.
  useEffect(() => {
    let player: AudioPlayer | null = null;
    try {
      void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
      player = createAudioPlayer(ringtone ? { uri: ringtone } : CHIME);
      player.loop = true;
      player.volume = RING_VOLUME;
      player.play();
    } catch {
      // No sound (e.g. the browser blocks audio before the first tap): the buzz and animation still show it.
    }
    return () => player?.remove();
  }, [ringtone]);

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
    // A ring that grows and fades around the avatar, over and over.
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const buzz = setInterval(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BUZZ_EVERY_MS);
    return () => {
      loop.stop();
      clearInterval(buzz);
    };
  }, [slide, pulse]);

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slide }] }]} accessibilityLiveRegion="assertive">
      <View style={styles.avatarWrap}>
        <Animated.View
          style={[
            styles.pulse,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
            },
          ]}
        />
        {call.avatarUrl ? (
          <Image source={{ uri: call.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.initials]}>
            <Text style={styles.initialsText}>{(call.name.trim()[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {call.name}
        </Text>
        <Text style={styles.sub}>INCOMING DISCORD CALL</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ignore call from ${call.name}`}
        onPress={onDismiss}
        style={({ pressed }) => [styles.button, { backgroundColor: DECLINE }, pressed && styles.pressed]}
      >
        <Icon name="close" size={28} strokeWidth={2.4} color={colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Answer call from ${call.name}`}
        onPress={onAnswer}
        style={({ pressed }) => [styles.button, styles.answer, pressed && styles.pressed]}
      >
        <Icon name="phone" size={28} strokeWidth={2.2} color={colors.ink} />
      </Pressable>
    </Animated.View>
  );
}

const AVATAR = 60;

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 14,
    left: 320,
    right: 320,
    height: 92,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: '#15151B',
    borderWidth: 1,
    borderColor: '#2A2A33',
    boxShadow: `0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px ${categoryColors.comms}55, 0 0 30px ${categoryColors.comms}40`,
  },
  avatarWrap: { width: AVATAR, height: AVATAR, alignItems: 'center', justifyContent: 'center' },
  pulse: {
    position: 'absolute',
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 3,
    borderColor: ANSWER,
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  initials: { backgroundColor: categoryColors.comms, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: fonts.ui700, fontSize: 24, color: colors.ink },
  text: { flex: 1 },
  name: { fontFamily: fonts.ui700, fontSize: 24, color: colors.text },
  sub: { fontFamily: fonts.mono500, fontSize: 12, letterSpacing: 1, color: categoryColors.comms, marginTop: 2 },
  button: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  answer: { backgroundColor: ANSWER, boxShadow: `0 0 18px ${ANSWER}80` },
  pressed: { transform: [{ scale: 0.93 }] },
});
