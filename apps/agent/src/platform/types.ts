import type { ActionRequest, AdjustId } from '@deck/protocol';
import type { StateStore } from '../state-store';

/**
 * A platform executes actions and keeps the StateStore up to date.
 * - WindowsPlatform: the real PC.
 * - MockPlatform: simulated, so the tablet app can be built without the PC.
 * The server only talks to this interface, so adding actions never touches networking code.
 */
export interface Platform {
  readonly name: string;
  start(store: StateStore): Promise<void>;
  stop(): void;
  /** Throw an ActionError with a user-friendly message if the action fails. */
  runAction(request: ActionRequest): Promise<void>;
  adjust(adjustId: AdjustId, value: number): Promise<void>;
  /** appId -> PNG data URL. Resolves once icons are extracted (cached after the first call). */
  getAppIcons(): Promise<Record<string, string>>;
}

/** An expected failure whose message is safe to show on the tablet. */
export class ActionError extends Error {}
