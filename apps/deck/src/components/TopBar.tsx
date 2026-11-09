import type { DeckPage, DeckProfile, DeckState } from '@deck/protocol';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClock } from '../hooks/useClock';
import { ROOM_PURPLE, categoryColors, colors, fonts, shadows } from '../theme';
import { Icon } from './Icon';

interface TopBarProps {
  profile: DeckProfile;
  pages: DeckPage[];
  pageIndex: number;
  onSelectPage: (index: number) => void;
  state: DeckState;
  pcOnline: boolean;
}

export function TopBar({ profile, pages, pageIndex, onSelectPage, state, pcOnline }: TopBarProps) {
  return (
    <View style={styles.bar}>
      <ProfileButton profile={profile} state={state} />
      <StatusArea state={state} pcOnline={pcOnline} />
      {/* Absolutely centered, so it doesn't shift when the chips change width. */}
      <View style={styles.trackCenter} pointerEvents="box-none">
        <PageTrack pages={pages} pageIndex={pageIndex} onSelect={onSelectPage} />
      </View>
    </View>
  );
}

/** Left: keycap-style profile button (opens the profile menu in M6). */
function ProfileButton({ profile, state }: { profile: DeckProfile; state: DeckState }) {
  const meta = state.profile.auto && state.profile.reason ? `AUTO · ${state.profile.reason}` : 'MANUAL';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Profile: ${profile.name}`}
      onPressIn={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
      style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
    >
      <View style={styles.profileIcon}>
        <Icon name={profile.icon} size={19} strokeWidth={2.2} color={colors.ink} />
      </View>
      <View style={styles.profileText}>
        <Text style={styles.profileName}>{profile.name}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
      <View style={{ marginLeft: 4 }}>
        <Icon name="chevronDown" size={16} strokeWidth={2} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

/** Center: recessed track with one button per page. */
function PageTrack({
  pages,
  pageIndex,
  onSelect,
}: {
  pages: DeckPage[];
  pageIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {pages.map((page, i) => {
        const active = i === pageIndex;
        return (
          <Pressable
            key={page.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void Haptics.selectionAsync();
              onSelect(i);
            }}
            style={[styles.pageButton, active && styles.pageButtonActive]}
          >
            <Text style={[styles.pageNumber, { color: active ? colors.ink : colors.textFaint }]}>
              {String(i + 1).padStart(2, '0')}
            </Text>
            <Text style={[styles.pageName, active ? styles.pageNameActive : null]}>{page.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Right: mic chip, PC chip, clock, edit button. */
function StatusArea({ state, pcOnline }: { state: DeckState; pcOnline: boolean }) {
  const { time, date } = useClock();
  const muted = state.voice.micMuted;
  const temp = state.system.cpuTempC ?? state.system.gpuTempC;

  return (
    <View style={styles.status}>
      <Chip dot={muted ? categoryColors.stream : colors.live} text={muted ? 'MIC MUTED' : 'MIC LIVE'} />
      {pcOnline ? (
        <Chip dot={colors.live} text={temp === null ? 'PC' : `PC · ${Math.round(temp)}°`} />
      ) : (
        <Chip dot={colors.textFaint} text="PC ASLEEP" glow={false} />
      )}
      <View style={styles.clock}>
        <Text style={styles.time}>{time}</Text>
        <Text style={styles.meta}>{date}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit layout"
        onPressIn={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
      >
        <Icon name="gear" size={18} strokeWidth={2} color={colors.text} />
      </Pressable>
    </View>
  );
}

function Chip({ dot, text, glow = true }: { dot: string; text: string; glow?: boolean }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: dot }, glow && { boxShadow: `0 0 8px ${dot}` }]} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

const keycapEdge = {
  borderWidth: 1,
  borderColor: colors.capBorder,
  borderBottomWidth: 3,
  borderBottomColor: '#000000',
  backgroundColor: colors.cap,
} as const;

const styles = StyleSheet.create({
  bar: {
    width: '100%',
    height: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trackCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ translateY: 2 }] },

  profileButton: {
    ...keycapEdge,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 18,
  },
  profileIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: ROOM_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glow(ROOM_PURPLE, 18, 0.5),
  },
  profileText: { gap: 2, alignItems: 'flex-start' },
  profileName: { fontFamily: fonts.ui700, fontSize: 16, letterSpacing: -0.16, color: colors.text },
  meta: { fontFamily: fonts.mono400, fontSize: 10, color: colors.textMuted },

  track: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 5,
    borderRadius: 18,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: colors.capBorder,
    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.8)',
  },
  pageButton: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 13,
  },
  pageButtonActive: { backgroundColor: ROOM_PURPLE, boxShadow: shadows.glow(ROOM_PURPLE, 22, 0.55) },
  pageNumber: { fontFamily: fonts.mono500, fontSize: 11 },
  pageName: { fontFamily: fonts.ui600, fontSize: 14, color: colors.textSoft },
  pageNameActive: { fontFamily: fonts.ui700, color: colors.ink },

  status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.cap,
    borderWidth: 1,
    borderColor: colors.capBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: fonts.mono400, fontSize: 11, color: colors.chipText },
  clock: { alignItems: 'flex-end', gap: 1, paddingLeft: 8, paddingRight: 6 },
  time: {
    fontFamily: fonts.ui700,
    fontSize: 24,
    letterSpacing: -0.72,
    lineHeight: 26,
    color: colors.text,
    includeFontPadding: false,
  },
  editButton: {
    ...keycapEdge,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
