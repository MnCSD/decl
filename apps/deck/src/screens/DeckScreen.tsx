import type { DeckKey, DeckLayout } from '@deck/protocol';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyGrid } from '../components/KeyGrid';
import { TopBar } from '../components/TopBar';
import { previewPress } from '../state/preview-actions';
import { SAMPLE_APP_ICONS, SAMPLE_LOCAL, SAMPLE_STATE } from '../state/sample-state';
import { CANVAS, colors } from '../theme';

/** The main deck: top bar + 8×4 key grid. Laid out at the 1340×800 design size. */
export function DeckScreen({ layout }: { layout: DeckLayout }) {
  const profile = layout.profiles.find((p) => p.id === SAMPLE_STATE.profile.id) ?? layout.profiles[0]!;
  const pages = profile.pages;

  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [state, setState] = useState(SAMPLE_STATE);
  const [local, setLocal] = useState(SAMPLE_LOCAL);

  // M2 preview: tick the recording and focus timers so the keys look alive.
  useEffect(() => {
    const timer = setInterval(() => {
      setState((s) => (s.obs.recording ? { ...s, obs: { ...s.obs, recordingSec: s.obs.recordingSec + 1 } } : s));
      setLocal((l) =>
        l.focus.running && l.focus.remainingSec > 0
          ? { focus: { ...l.focus, remainingSec: l.focus.remainingSec - 1 } }
          : l,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const goToPage = (index: number) => {
    if (index < 0 || index >= pages.length || index === pageIndex) return;
    setDirection(index > pageIndex ? 1 : -1);
    setPageIndex(index);
  };

  const onKeyPress = (key: DeckKey) => {
    // M3 will send `runAction` to the agent here; for now we preview the result locally.
    setState((s) => previewPress(key, s));
  };

  return (
    <View style={styles.canvas}>
      <TopBar
        profile={profile}
        pages={pages}
        pageIndex={pageIndex}
        onSelectPage={goToPage}
        state={state}
        pcOnline
      />
      <View style={styles.gridArea}>
        <KeyGrid
          page={pages[pageIndex]!}
          direction={direction}
          state={state}
          local={local}
          appIcons={SAMPLE_APP_ICONS}
          onKeyPress={onKeyPress}
          onSwipe={(delta) => goToPage(pageIndex + delta)}
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
  gridArea: { marginTop: 34 },
});
