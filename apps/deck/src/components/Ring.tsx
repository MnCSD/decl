import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { fonts } from '../theme';

const RADIUS = 30;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 188.5, same as the design

interface RingProps {
  progress: number; // 0–1
  text: string;
  color: string;
  trackColor: string;
  textColor: string;
  size?: number;
  fontSize?: number;
}

/** Small circular progress ring with a value in the middle (CPU °, GPU °, focus timer). */
export function Ring({ progress, text, color, trackColor, textColor, size = 46, fontSize = 13 }: RingProps) {
  const filled = Math.max(0, Math.min(1, progress)) * CIRCUMFERENCE;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 72 72" style={StyleSheet.absoluteFill}>
        <Circle cx={36} cy={36} r={RADIUS} fill="none" stroke={trackColor} strokeWidth={7} />
        <Circle
          cx={36}
          cy={36}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform="rotate(-90 36 36)"
        />
      </Svg>
      <Text style={[styles.text, { color: textColor, fontSize }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.mono500, includeFontPadding: false },
});
