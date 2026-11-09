import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { KEY, colors, shadows } from '../theme';
import { pressesBlocked } from './press-guard';

interface KeycapProps {
  /** Lit = face filled with `color`, glow around the cap. */
  lit: boolean;
  /** Glow around the cap without filling the face (app keys while the app is running). */
  glow?: boolean;
  color: string;
  /** Face color when not lit (app keys use the app's brand color). Default: dark face. */
  faceColor?: string;
  accessibilityLabel: string;
  onPress?: () => void;
  /** Extra layers drawn inside the face behind the content (fills, album art). */
  background?: ReactNode;
  children?: ReactNode;
  /** Cap size; 2×2 keys (Wake PC, M4) pass a bigger size. */
  width?: number;
  height?: number;
  style?: ViewStyle;
}

const PRESS_DEPTH = 3; // px the cap moves down while pressed

/**
 * A physical-looking key: dark outer cap with a thick black bottom edge,
 * and an inner "LCD" face that lights up in the key's category color.
 */
export function Keycap({
  lit,
  glow = false,
  color,
  faceColor = colors.face,
  accessibilityLabel,
  onPress,
  background,
  children,
  width = KEY.size,
  height = KEY.size,
  style,
}: KeycapProps) {
  // Animated.Value drives the press-down movement on the native UI thread (useNativeDriver).
  const offset = useRef(new Animated.Value(0)).current;

  const animateTo = (toValue: number) =>
    Animated.timing(offset, { toValue, duration: 80, useNativeDriver: true }).start();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: lit }}
      onPressIn={() => {
        animateTo(PRESS_DEPTH);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPressOut={() => animateTo(0)}
      onPress={() => {
        if (!pressesBlocked()) onPress?.(); // the touch was a swipe, not a tap
      }}
      style={style}
    >
      <Animated.View
        style={[
          styles.cap,
          { width, height, boxShadow: lit || glow ? shadows.capLit(color) : shadows.capOff },
          { transform: [{ translateY: offset }] },
        ]}
      >
        <View style={[styles.face, { backgroundColor: lit ? color : faceColor }]}>
          {background}
          {children}
          {/* Soft highlight across the top, like light on the glass over an LCD key. */}
          <View pointerEvents="none" style={styles.gloss} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** An unused grid slot: a blank, dimmed cap. */
export function EmptyKey() {
  return (
    <View style={[styles.cap, styles.empty, { boxShadow: shadows.capOff }]}>
      <View style={[styles.face, { backgroundColor: colors.face }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  cap: {
    width: KEY.size,
    height: KEY.size,
    padding: KEY.padding, // React Native sizes are border-box like the design: 140 includes border + padding
    borderRadius: KEY.radius,
    backgroundColor: colors.cap,
    borderWidth: 1,
    borderColor: colors.capBorder,
    borderBottomWidth: 4,
    borderBottomColor: '#000000',
  },
  face: {
    flex: 1,
    borderRadius: KEY.faceRadius,
    overflow: 'hidden',
    boxShadow: shadows.faceRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: KEY.faceRadius,
    boxShadow: shadows.faceGloss,
  },
  empty: {
    opacity: 0.35,
  },
});
