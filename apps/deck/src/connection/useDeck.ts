import { createInitialState, type ActionId, type AdjustId, type DeckKey, type DeckState } from '@deck/protocol';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { DeckClient, pairWithPc, type ConnectionStatus } from './deck-client';
import {
  clearPairing,
  loadIcons,
  loadPairing,
  saveIcons,
  saveLastAddress,
  savePairing,
  type Pairing,
  type PcAddress,
} from './storage';

/** Shown before the first state arrives: every value "unavailable". */
const EMPTY_STATE: DeckState = createInitialState({ version: '', mock: false, hostname: '' });

export type DeckPhase = 'loading' | 'unpaired' | 'paired';

/** Name the PC shows for this device (e.g. in logs / devices.json). */
function deviceName(): string {
  if (Platform.OS === 'web') return 'Browser preview';
  const model = (Platform.constants as { Model?: string }).Model;
  return model ? `Desk Deck (${model})` : 'Desk Deck tablet';
}

/** What a tap on a key sends to the agent, or null for keys with no action yet. */
function actionForKey(key: DeckKey) {
  if (key.type === 'app') return { actionId: 'app.launch' as const, params: { app: key.app } };
  return key.actionId ? { actionId: key.actionId, params: key.params } : null;
}

/**
 * Everything the screens need from the connection: pairing state, live deck state,
 * app icons, and functions to pair / forget / press keys.
 */
export function useDeck() {
  const [phase, setPhase] = useState<DeckPhase>('loading');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [state, setState] = useState<DeckState>(EMPTY_STATE);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [unpairedReason, setUnpairedReason] = useState<string | null>(null);
  const [ringtone, setRingtone] = useState<string | null>(null);
  const clientRef = useRef<DeckClient | null>(null);
  // Latest state for callbacks that are created once (pressKey).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Startup: read the saved PC + cached icons.
  useEffect(() => {
    void (async () => {
      const [saved, cachedIcons] = await Promise.all([loadPairing(), loadIcons()]);
      setIcons(cachedIcons);
      setPairing(saved);
      setPhase(saved ? 'paired' : 'unpaired');
    })();
  }, []);

  // While paired: keep a live connection to the agent.
  useEffect(() => {
    if (!pairing) return;
    const client = new DeckClient(pairing, {
      onStatus: setStatus,
      onState: setState,
      onIcons: (next) => {
        setIcons(next);
        void saveIcons(next); // cached so app keys keep their icons while the PC is off
      },
      onRingtone: setRingtone,
      onUnpaired: () => {
        void clearPairing();
        setUnpairedReason('The PC no longer knows this tablet. Pair again with a new code.');
        setPairing(null);
        setPhase('unpaired');
      },
    });
    clientRef.current = client;
    client.start();

    // Coming back to the app (screen was off, app in background): reconnect immediately.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') client.retryNow();
    });
    return () => {
      sub.remove();
      client.stop();
      clientRef.current = null;
    };
  }, [pairing]);

  /** Pairs with the PC. Resolves with an error message, or null on success. */
  const pair = useCallback(async (pc: PcAddress, code: string): Promise<string | null> => {
    await saveLastAddress(pc);
    const outcome = await pairWithPc(pc, code, deviceName());
    if (!outcome.ok) return outcome.error;
    await savePairing(outcome.pairing);
    setUnpairedReason(null);
    setPairing(outcome.pairing);
    setPhase('paired');
    return null;
  }, []);

  const forget = useCallback(async () => {
    await clearPairing();
    setPairing(null);
    setState(EMPTY_STATE);
    setStatus('offline');
    setUnpairedReason(null);
    setPhase('unpaired');
  }, []);

  const pressKey = useCallback(async (key: DeckKey) => {
    // While a Discord call rings, the squad key answers it.
    const ringing = key.type === 'squad' && stateRef.current.voice.incomingCall !== null;
    const action = ringing ? { actionId: 'discord.answerCall' as const, params: {} } : actionForKey(key);
    const client = clientRef.current;
    if (!action || !client) return;
    const result = await client.runAction(action.actionId, action.params);
    if (!result.ok) {
      // M7 adds a red flash on the key; for now a warning buzz + log.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.warn(`"${key.label}" failed: ${result.error ?? 'unknown error'}`);
    }
  }, []);

  /** Actions that don't come from a key (e.g. the incoming-call banner). */
  const runAction = useCallback(async (actionId: ActionId) => {
    const client = clientRef.current;
    if (!client) return;
    const result = await client.runAction(actionId, {});
    if (!result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.warn(`${actionId} failed: ${result.error ?? 'unknown error'}`);
    }
  }, []);

  /** Swipe on a value key. ValueKey already throttles, so this just forwards. */
  const adjust = useCallback(async (adjustId: AdjustId, value: number) => {
    const client = clientRef.current;
    if (!client) return;
    const result = await client.adjust(adjustId, value);
    if (!result.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.warn(`Adjust ${adjustId} failed: ${result.error ?? 'unknown error'}`);
    }
  }, []);

  return { phase, pairing, status, state, icons, ringtone, unpairedReason, pair, forget, pressKey, runAction, adjust };
}
