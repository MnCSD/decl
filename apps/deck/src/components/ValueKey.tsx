import type { AdjustId, DeckKey, DeckState } from '@deck/protocol';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { readValue } from '../state/bindings';
import { CANVAS, categoryColors, colors, fonts, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Keycap } from './Keycap';
import { blockPresses } from './press-guard';

type ValueKeyDef = Extract<DeckKey, { type: 'value' }>;

interface ValueKeyProps {
  keyDef: ValueKeyDef;
  state: DeckState;
  onPress: (key: DeckKey) => void;
  onAdjust: (adjustId: AdjustId, value: number) => void;
}

const VALUE_ICONS: Record<string, string> = { 'volume.level': 'volume', 'light.brightness': 'bulb' };

const DRAG_START = 8; // px of vertical movement before a touch becomes a drag (smaller = a tap)
const FULL_RANGE_PX = 180; // dragging this far (design px) goes from 0 to 100
const SEND_EVERY_MS = 80; // throttle: at most ~12 updates/second to the PC
const HOLD_AFTER_MS = 1200; // keep showing our value until the PC's state catches up

/**
 * Big number with the face filling from the bottom like liquid (volume, brightness).
 * Tap = the key's action (mute / light toggle). Drag up/down = set the value.
 */
export function ValueKey({ keyDef: k, state, onPress, onAdjust }: ValueKeyProps) {
  const color = categoryColors[k.category];
  const data = readValue(k.source, state);

  // While dragging (and briefly after), show the value under the finger instead of the
  // PC's, so the key doesn't jump back while the PC is still applying it.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  // The whole UI is scaled to fit the screen; finger movement is in screen pixels.
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width / CANVAS.width, height / CANVAS.height);

  // Latest values for the gesture handlers (they're created once).
  const live = useRef({ data, scale, onAdjust, adjustId: k.adjustId });
  live.current = { data, scale, onAdjust, adjustId: k.adjustId };

  const pan = useMemo(() => {
    let start = 0;
    let current = 0;
    let lastSent = 0;
    let lastSentValue = -1;

    const send = (value: number, force = false) => {
      const now = Date.now();
      if (value === lastSentValue || (!force && now - lastSent < SEND_EVERY_MS)) return;
      lastSent = now;
      lastSentValue = value;
      live.current.onAdjust(live.current.adjustId, value);
    };

    return PanResponder.create({
      // Claim clearly vertical drags (the grid claims horizontal ones for page swipes).
      // "Capture" lets us take over even though the touch started on the key's Pressable,
      // which cancels the tap.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        live.current.data !== null && Math.abs(g.dy) > DRAG_START && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        // Start from the real level even when muted/off, so the number doesn't jump.
        blockPresses();
        start = live.current.data?.value ?? 0;
        current = start;
        lastSentValue = -1;
        setDragValue(start);
      },
      onPanResponderMove: (_, g) => {
        blockPresses();
        const dy = g.dy / live.current.scale; // screen px -> design px
        const next = Math.round(Math.min(100, Math.max(0, start - (dy / FULL_RANGE_PX) * 100)));
        if (next === current) return;
        if (Math.floor(next / 10) !== Math.floor(current / 10)) void Haptics.selectionAsync(); // tick every 10%
        current = next;
        setDragValue(next);
        send(next);
      },
      onPanResponderRelease: () => {
        blockPresses();
        send(current, true); // always deliver the final value
        holdTimer.current = setTimeout(() => setDragValue(null), HOLD_AFTER_MS);
      },
      onPanResponderTerminate: () => {
        blockPresses();
        send(current, true);
        holdTimer.current = setTimeout(() => setDragValue(null), HOLD_AFTER_MS);
      },
      // Don't let the grid steal an adjust that's already going.
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  const dragging = dragValue !== null;
  const value = dragging ? dragValue : (data?.value ?? null);
  // Dragging above 0 turns the thing on (the agent unmutes / switches the light on).
  const on = dragging ? dragValue > 0 : (data?.on ?? false);
  const fill = on && value !== null ? value : 0;

  return (
    <View {...pan.panHandlers}>
      <Keycap
        lit={false}
        glow={dragging}
        color={color}
        accessibilityLabel={`${k.label} ${value ?? 'unavailable'}${on ? '' : ', off'}. Swipe up or down to adjust`}
        onPress={() => onPress(k)}
        background={
          fill > 0 ? (
            <View
              style={[
                styles.fill,
                { height: `${fill}%`, backgroundColor: withAlpha(color, dragging ? 0.45 : 0.32), borderTopColor: color },
              ]}
            />
          ) : null
        }
      >
        <Icon name={VALUE_ICONS[k.source] ?? 'help'} size={22} strokeWidth={2.2} color={on ? color : colors.textFaint} />
        <Text style={[styles.bigNumber, { color: on ? colors.text : colors.textFaint }]}>{value ?? '–'}</Text>
      </Keycap>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 2 },
  bigNumber: {
    fontFamily: fonts.mono500,
    fontSize: 44,
    letterSpacing: -1.5,
    lineHeight: 48,
    marginTop: 2,
    includeFontPadding: false,
  },
});
