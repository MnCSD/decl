import { KEYS_PER_PAGE, type AdjustId, type DeckKey, type DeckPage, type DeckState } from '@deck/protocol';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import type { LocalState } from '../state/local-state';
import { KEY } from '../theme';
import { EmptyKey } from './Keycap';
import { blockPresses } from './press-guard';
import { KeyView } from './KeyView';

const SWIPE_START = 24; // px of horizontal movement before we treat it as a swipe
const SWIPE_COMMIT = 70; // px needed on release to change page

interface KeyGridProps {
  page: DeckPage;
  /** +1 when moving to a later page, -1 to an earlier one (drives the slide direction). */
  direction: number;
  state: DeckState;
  local: LocalState;
  appIcons: Record<string, string>;
  onKeyPress: (key: DeckKey) => void;
  onAdjust: (adjustId: AdjustId, value: number) => void;
  onSwipe: (delta: 1 | -1) => void;
}

/** 8×4 grid of keys. Horizontal swipes anywhere on it change page. */
export function KeyGrid({ page, direction, state, local, appIcons, onKeyPress, onAdjust, onSwipe }: KeyGridProps) {
  const enter = useRef(new Animated.Value(1)).current;

  // Short slide + fade whenever the page changes.
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [page.id, enter]);

  // PanResponder is React Native's built-in gesture system. The "Capture" handler
  // lets the grid take over a horizontal drag even if it started on a key,
  // which cancels that key's press.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dx) > SWIPE_START && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => blockPresses(),
        onPanResponderMove: () => blockPresses(),
        onPanResponderRelease: (_, g) => {
          blockPresses();
          if (g.dx <= -SWIPE_COMMIT) onSwipeRef.current(1);
          else if (g.dx >= SWIPE_COMMIT) onSwipeRef.current(-1);
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  const slots = Array.from({ length: KEYS_PER_PAGE }, (_, i) => page.keys[i] ?? null);

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.grid,
        {
          opacity: enter,
          transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [direction * 28, 0] }) }],
        },
      ]}
    >
      {slots.map((key, i) =>
        key ? (
          <KeyView key={key.id} keyDef={key} state={state} local={local} appIcons={appIcons} onPress={onKeyPress} onAdjust={onAdjust} />
        ) : (
          <EmptyKey key={`empty-${i}`} />
        ),
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: KEY.size * 8 + KEY.gap * 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: KEY.gap,
  },
});
