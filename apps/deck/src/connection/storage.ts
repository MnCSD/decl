import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

/**
 * What the tablet remembers between launches:
 * - the PC's address + the device token (token in the Android keystore via SecureStore),
 * - the last app icons the agent sent, so app keys keep their icons while the PC is off.
 */

const TOKEN_KEY = 'deskdeck.token';
const PC_KEY = 'deskdeck.pc';
const ICONS_KEY = 'deskdeck.appIcons';

export interface PcAddress {
  host: string;
  port: number;
}

export interface Pairing extends PcAddress {
  token: string;
}

// SecureStore only exists on Android/iOS. The browser preview (development only)
// falls back to plain storage there.
const secure = {
  get: (key: string) => (Platform.OS === 'web' ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) =>
    Platform.OS === 'web' ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value),
  remove: (key: string) => (Platform.OS === 'web' ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

const PcSchema = z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) });
const IconsSchema = z.record(z.string(), z.string().startsWith('data:image/png;base64,'));

/** Stored values are checked too: a corrupt entry is treated as "not paired". */
function parseJson<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function loadPairing(): Promise<Pairing | null> {
  const [token, pcRaw] = await Promise.all([secure.get(TOKEN_KEY), AsyncStorage.getItem(PC_KEY)]);
  const pc = parseJson(pcRaw, PcSchema);
  return token && pc ? { ...pc, token } : null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await secure.set(TOKEN_KEY, pairing.token);
  await AsyncStorage.setItem(PC_KEY, JSON.stringify({ host: pairing.host, port: pairing.port }));
}

/** Forgets the PC (token + address). Cached icons are kept; they're harmless. */
export async function clearPairing(): Promise<void> {
  await Promise.all([secure.remove(TOKEN_KEY), AsyncStorage.removeItem(PC_KEY)]);
}

/** The last address used, to prefill the pairing screen. */
export async function loadLastAddress(): Promise<PcAddress | null> {
  return parseJson(await AsyncStorage.getItem(`${PC_KEY}.last`), PcSchema);
}

export async function saveLastAddress(pc: PcAddress): Promise<void> {
  await AsyncStorage.setItem(`${PC_KEY}.last`, JSON.stringify(pc));
}

export async function loadIcons(): Promise<Record<string, string>> {
  return parseJson(await AsyncStorage.getItem(ICONS_KEY), IconsSchema) ?? {};
}

export async function saveIcons(icons: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(ICONS_KEY, JSON.stringify(icons));
}
