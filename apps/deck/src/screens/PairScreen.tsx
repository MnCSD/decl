import { DEFAULT_PORT } from '@deck/protocol';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { loadLastAddress, type PcAddress } from '../connection/storage';
import { CANVAS, ROOM_PURPLE, categoryColors, colors, fonts, shadows } from '../theme';

interface PairScreenProps {
  /** Resolves with an error message, or null when paired. */
  onPair: (pc: PcAddress, code: string) => Promise<string | null>;
  /** Why we're here again (e.g. the PC forgot this tablet). */
  notice: string | null;
}

/** "192.168.2.8" or "192.168.2.8:4343" -> { host, port }. IPv4 addresses and plain host names only. */
export function parseAddress(text: string): PcAddress | null {
  const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(text.trim());
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return null;
  return { host: match[1]!, port };
}

/** First run (or after "Forget PC"): enter the PC's address and the code shown by the agent. */
export function PairScreen({ onPair, notice }: PairScreenProps) {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<ComponentRef<typeof TextInput>>(null);

  // Prefill the last address used (or, in the browser preview, the dev machine).
  useEffect(() => {
    void loadLastAddress().then((last) => {
      if (last) setAddress(last.port === DEFAULT_PORT ? last.host : `${last.host}:${last.port}`);
      else if (Platform.OS === 'web' && typeof window !== 'undefined') setAddress(window.location.hostname);
    });
  }, []);

  const pc = parseAddress(address);
  const canSubmit = !busy && pc !== null && /^\d{6}$/.test(code);

  const submit = async () => {
    if (!canSubmit || !pc) return;
    setBusy(true);
    setError(null);
    const err = await onPair(pc, code);
    setBusy(false); // on success this screen is replaced by the deck
    if (err) {
      setError(err);
      setCode(''); // codes are single-use after a wrong try anyway
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <View style={styles.canvas}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Icon name="monitor" size={30} strokeWidth={2.1} color={colors.ink} />
        </View>
        <Text style={styles.title}>Pair with your PC</Text>
        <Text style={styles.subtitle}>
          Start the Desk Deck agent on your PC. It shows its address and a 6-digit code.
        </Text>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>PC ADDRESS</Text>
          <TextInput
            value={address}
            onChangeText={(t) => {
              setAddress(t);
              setError(null);
            }}
            placeholder="192.168.2.8"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url" // has dots, ":" for a port, and letters for host names
            returnKeyType="next"
            onSubmitEditing={() => codeInput.current?.focus()}
            style={[styles.input, address.length > 0 && !pc && styles.inputInvalid]}
            accessibilityLabel="PC address"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>PAIRING CODE</Text>
          <TextInput
            ref={codeInput}
            value={code}
            onChangeText={(t) => {
              setCode(t.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="000000"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            style={[styles.input, styles.codeInput]}
            accessibilityLabel="Pairing code"
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pair"
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          onPressIn={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.button, !canSubmit && styles.buttonDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{busy ? 'Pairing…' : 'Pair'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.error, !error && styles.hidden]}>{error ?? ' '}</Text>
      <Text style={styles.hint}>Tablet and PC must be on the same Wi-Fi. Codes expire after 5 minutes.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: CANVAS.width,
    height: CANVAS.height,
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingTop: 70,
  },
  header: { alignItems: 'center', gap: 12 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: ROOM_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glow(ROOM_PURPLE, 34, 0.5),
    marginBottom: 6,
  },
  title: { fontFamily: fonts.ui700, fontSize: 32, letterSpacing: -0.8, color: colors.text },
  subtitle: { fontFamily: fonts.ui500, fontSize: 16, color: colors.textMuted },
  notice: {
    marginTop: 22,
    fontFamily: fonts.ui600,
    fontSize: 14,
    color: categoryColors.home,
  },
  form: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginTop: 44 },
  field: { gap: 8 },
  label: { fontFamily: fonts.mono500, fontSize: 11, letterSpacing: 1, color: colors.textMuted },
  input: {
    width: 300,
    height: 64,
    borderRadius: 18,
    paddingHorizontal: 20,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: colors.capBorder,
    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.8)',
    color: colors.text,
    fontFamily: fonts.mono500,
    fontSize: 22,
  },
  inputInvalid: { borderColor: categoryColors.stream },
  codeInput: { width: 230, letterSpacing: 8, textAlign: 'center' },
  button: {
    height: 64,
    minWidth: 150,
    paddingHorizontal: 28,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ROOM_PURPLE,
    borderBottomWidth: 4,
    borderBottomColor: '#000000',
    boxShadow: shadows.capLit(ROOM_PURPLE),
  },
  buttonDisabled: { opacity: 0.35, boxShadow: shadows.capOff },
  pressed: { transform: [{ translateY: 3 }] },
  buttonText: { fontFamily: fonts.ui700, fontSize: 18, color: colors.ink },
  error: { marginTop: 24, fontFamily: fonts.ui600, fontSize: 15, color: categoryColors.stream },
  hidden: { opacity: 0 },
  hint: { position: 'absolute', bottom: 40, fontFamily: fonts.ui500, fontSize: 13, color: colors.textFaint },
});
