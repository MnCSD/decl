import type { DeckKey, DeckState } from '@deck/protocol';
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { formatTimer, isLit, readRing, readValue } from '../state/bindings';
import type { LocalState } from '../state/sample-state';
import { categoryColors, colors, fonts, withAlpha } from '../theme';
import { Icon } from './Icon';
import { Keycap } from './Keycap';
import { Ring } from './Ring';

interface KeyViewProps {
  keyDef: DeckKey;
  state: DeckState;
  local: LocalState;
  /** appId -> PNG data URL (real icons extracted on the PC) */
  appIcons: Record<string, string>;
  onPress: (key: DeckKey) => void;
}

/** Renders one key from the layout JSON, picking the look from its `type`. */
export function KeyView({ keyDef: k, state, local, appIcons, onPress }: KeyViewProps) {
  const color = categoryColors[k.category];
  const press = () => onPress(k);

  switch (k.type) {
    case 'app': {
      // Real, full-color app icon on the dark face; the cap glows while the app runs.
      const running = state.apps.find((a) => a.id === k.app)?.running ?? false;
      const icon = appIcons[k.app];
      return (
        <Keycap
          lit={false}
          glow={running}
          color={color}
          accessibilityLabel={`${k.label}${running ? ', running' : ''}`}
          onPress={press}
        >
          {running ? <View style={[styles.runningDot, { backgroundColor: color, boxShadow: `0 0 6px ${color}` }]} /> : null}
          <IconSlot>
            {icon ? (
              <Image source={{ uri: icon }} style={styles.appIcon} />
            ) : (
              // Not in apps.json on the PC, or no icon yet.
              <Icon name="help" color={color} />
            )}
          </IconSlot>
          <Label text={k.label} lit={false} />
        </Keycap>
      );
    }

    case 'button': {
      const lit = isLit(k.lit, state);
      const label = lit && k.onLabel ? k.onLabel : k.label;
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={label} onPress={press}>
          <IconSlot>
            <Icon name={lit && k.onIcon ? k.onIcon : k.icon} color={lit ? colors.ink : color} />
          </IconSlot>
          <Label text={label} lit={lit} />
        </Keycap>
      );
    }

    case 'value': {
      // Big number; the face fills from the bottom like liquid.
      const data = readValue(k.source, state);
      const on = data?.on ?? false;
      const fill = on && data ? data.value : 0;
      return (
        <Keycap
          lit={false}
          color={color}
          accessibilityLabel={`${k.label} ${data ? data.value : 'unavailable'}${on ? '' : ', off'}`}
          onPress={press}
          background={
            fill > 0 ? (
              <View
                style={[
                  styles.fill,
                  { height: `${fill}%`, backgroundColor: withAlpha(color, 0.28), borderTopColor: color },
                ]}
              />
            ) : null
          }
        >
          <IconSlot>
            <Text style={[styles.bigNumber, { color: on ? colors.text : colors.textFaint }]}>
              {data ? data.value : '–'}
            </Text>
          </IconSlot>
          <Label text={on || !data ? k.label : `${k.label} · off`} lit={false} />
        </Keycap>
      );
    }

    case 'ring': {
      const data = readRing(k.source, state, local);
      return (
        <Keycap lit color={color} accessibilityLabel={`${k.label} ${data?.text ?? 'unavailable'}`} onPress={press}>
          <IconSlot>
            <Ring
              progress={data?.progress ?? 0}
              text={data?.text ?? '–'}
              color={colors.ink}
              trackColor={withAlpha(colors.ink, 0.18)}
              textColor={colors.ink}
              fontSize={k.source === 'focus' ? 12 : 13}
            />
          </IconSlot>
          <Label text={k.label} lit />
        </Keycap>
      );
    }

    case 'nowPlaying': {
      const media = state.media;
      if (!media) {
        return (
          <Keycap lit={false} color={color} accessibilityLabel="Nothing playing" onPress={press}>
            <IconSlot>
              <Icon name="play" color={color} />
            </IconSlot>
            <Label text="Nothing playing" lit={false} />
          </Keycap>
        );
      }
      return (
        <Keycap
          lit={false}
          color={color}
          accessibilityLabel={`${media.playing ? 'Pause' : 'Play'}, now playing ${media.title}`}
          onPress={press}
          background={<AlbumArt uri={media.artUrl} />}
        >
          <IconSlot>
            <View style={styles.playButton}>
              <Icon name={media.playing ? 'pause' : 'play'} size={20} strokeWidth={2.6} color={colors.ink} />
            </View>
          </IconSlot>
          <Label text={media.title} lit={false} />
        </Keycap>
      );
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
          <IconSlot>
            {lit ? (
              <View style={styles.timerRow}>
                <View style={styles.recDot} />
                <Text style={[styles.timer, { color: colors.ink }]}>{formatTimer(state.obs.recordingSec)}</Text>
              </View>
            ) : (
              <Icon name="record" color={color} />
            )}
          </IconSlot>
          <Label text={lit ? (k.onLabel ?? 'Recording') : k.label} lit={lit} />
        </Keycap>
      );
    }

    case 'folder':
      return (
        <Keycap lit color={color} accessibilityLabel={`${k.label} folder`} onPress={press}>
          <IconSlot>
            <Icon name={k.icon} color={colors.ink} />
          </IconSlot>
          <Label text={`${k.label} ›`} lit />
        </Keycap>
      );

    case 'squad': {
      const lit = isLit(k.lit, state);
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={k.label} onPress={press}>
          <IconSlot>
            <View style={styles.avatars}>
              {AVATAR_COLORS.map((c, i) => (
                <View
                  key={c}
                  style={[
                    styles.avatar,
                    { backgroundColor: c, marginLeft: i === 0 ? 0 : -10 },
                    i === 0 && { boxShadow: `0 0 0 2px ${color}` },
                  ]}
                />
              ))}
            </View>
          </IconSlot>
          <Label text={k.label} lit={lit} />
        </Keycap>
      );
    }

    case 'swatches': {
      const lit = isLit(k.lit, state);
      const single = k.colors.length === 1;
      return (
        <Keycap lit={lit} color={color} accessibilityLabel={k.label} onPress={press}>
          <IconSlot>
            <View style={styles.swatches}>
              {k.colors.map((c, i) => (
                <View
                  key={`${c}-${i}`}
                  style={[
                    single ? styles.swatchBig : styles.swatch,
                    { backgroundColor: c },
                    i === 0 && { boxShadow: `0 0 0 2px ${colors.face}, 0 0 0 4px #FFFFFF` },
                  ]}
                />
              ))}
            </View>
          </IconSlot>
          <Label text={k.label} lit={lit} />
        </Keycap>
      );
    }
  }
}

// Placeholder voice-channel avatars (real members come with Discord in M5).
const AVATAR_COLORS = ['#3A2F6B', '#22394D', '#4A2A3A'];

/** Fixed-height slot so labels line up across keys. */
function IconSlot({ children }: { children: ReactNode }) {
  return <View style={styles.iconSlot}>{children}</View>;
}

function Label({ text, lit }: { text: string; lit: boolean }) {
  return (
    <Text numberOfLines={1} style={[styles.label, { color: lit ? colors.ink : colors.text }]}>
      {text}
    </Text>
  );
}

/** Album art filling the face, dimmed so the play button and label stay readable. */
function AlbumArt({ uri }: { uri: string | null }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        // No art yet: abstract placeholder from the design.
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#16112A' }]}>
          <View style={styles.artBlob} />
          <View style={styles.artDot} />
        </View>
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  iconSlot: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  appIcon: { width: 44, height: 44 }, // same height as the icon slot, so labels line up with other keys
  runningDot: { position: 'absolute', top: 10, right: 10, width: 7, height: 7, borderRadius: 4 },
  label: {
    fontFamily: fonts.ui600,
    fontSize: 12,
    letterSpacing: 0.12,
    maxWidth: 112,
    includeFontPadding: false,
  },
  bigNumber: {
    fontFamily: fonts.mono500,
    fontSize: 34,
    letterSpacing: -1,
    lineHeight: 36,
    includeFontPadding: false,
  },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 2 },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.ink },
  timer: { fontFamily: fonts.mono500, fontSize: 28, letterSpacing: -0.84, includeFontPadding: false },
  avatars: { flexDirection: 'row' },
  avatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.face },
  swatches: { flexDirection: 'row', gap: 7 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  swatchBig: { width: 30, height: 30, borderRadius: 15 },
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
