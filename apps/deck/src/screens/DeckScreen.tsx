import type { AdjustId, DeckKey, DeckLayout, DeckState } from '@deck/protocol';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyGrid } from '../components/KeyGrid';
import { TopBar } from '../components/TopBar';
import type { ConnectionStatus } from '../connection/deck-client';
import { INITIAL_LOCAL } from '../state/local-state';
import { CANVAS, colors } from '../theme';

interface DeckScreenProps {
  layout: DeckLayout;
  state: DeckState;
  status: ConnectionStatus;
  appIcons: Record<string, string>;
  onKeyPress: (key: DeckKey) => void;
  onAdjust: (adjustId: AdjustId, value: number) => void;
  onForgetPc: () => void;
}

/** The main deck: top bar + 8×4 key grid. Laid out at the 1340×800 design size. */
export function DeckScreen({ layout, state, status, appIcons, onKeyPress, onAdjust, onForgetPc }: DeckScreenProps) {
  const profile = layout.profiles.find((p) => p.id === state.profile.id) ?? layout.profiles[0]!;
  const pages = profile.pages;

  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [local, setLocal] = useState(INITIAL_LOCAL);

  // Focus timer runs on the tablet (wired to a key in M5).
  useEffect(() => {
    const timer = setInterval(() => {
      setLocal((l) =>
        l.focus.running && l.focus.remainingSec > 0
          ? { focus: { ...l.focus, remainingSec: l.focus.remainingSec - 1 } }
          : l,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // A profile switch can leave us on a page number that doesn't exist.
  const safeIndex = Math.min(pageIndex, pages.length - 1);

  const goToPage = (index: number) => {
    if (index < 0 || index >= pages.length || index === safeIndex) return;
    setDirection(index > safeIndex ? 1 : -1);
    setPageIndex(index);
  };

  return (
    <View style={styles.canvas}>
      <TopBar
        profile={profile}
        pages={pages}
        pageIndex={safeIndex}
        onSelectPage={goToPage}
        state={state}
        status={status}
        onForgetPc={onForgetPc}
      />
      <View style={[styles.gridArea, status !== 'online' && styles.dimmed]}>
        <KeyGrid
          page={pages[safeIndex]!}
          direction={direction}
          state={state}
          local={local}
          appIcons={appIcons}
          onKeyPress={onKeyPress}
          onAdjust={onAdjust}
          onSwipe={(delta) => goToPage(safeIndex + delta)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: CANVAS.width,
    height: CANVAS.height,
    backgroundColor: colors.background,
    paddingTop: 26,
    paddingHorizontal: 47,
    alignItems: 'center',
  },
  // Width decides the key size (8 keys fill 1340), so 4 rows leave spare height:
  // center the grid in the space under the top bar instead of leaving a gap at the bottom.
  gridArea: { flex: 1, justifyContent: 'center', paddingBottom: 12 },
  // Until the asleep layout (M4): keys stay visible but dimmed while the PC is unreachable.
  dimmed: { opacity: 0.45 },
});
