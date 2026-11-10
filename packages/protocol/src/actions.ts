import { z } from 'zod';

const noParams = z.object({}).strict();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a color like #A78BFA');

/**
 * Id of an app in the agent's allow-list (apps.json on the PC), e.g. "discord".
 * The network only ever sends this id, never a path or command line.
 */
export const AppIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/, 'App ids are lowercase letters, digits and dashes');

export const MODE_IDS = ['gaming', 'study', 'movie', 'goodnight'] as const;
export const ModeIdSchema = z.enum(MODE_IDS);
export type ModeId = z.infer<typeof ModeIdSchema>;

/**
 * Every action the agent knows how to run, with the params it accepts.
 * The agent ONLY ever runs actions from this list; anything else is rejected.
 * To add an action: add it here, then handle it in each platform.
 */
export const ACTION_PARAMS = {
  // System
  'system.lock': noParams,
  'system.sleep': noParams,
  'system.shutdown': noParams,
  'system.restart': noParams,
  'system.screensOff': noParams,
  'system.screenshot': noParams,
  // Media
  'media.playPause': noParams,
  'media.next': noParams,
  'media.previous': noParams,
  'volume.toggleMute': noParams,
  // Discord (via its local RPC: the agent talks to the Discord app on the PC)
  'discord.toggleMute': noParams,
  'discord.toggleDeafen': noParams,
  /** Join the call that's ringing (the agent knows which one; the tablet never sends a channel). */
  'discord.answerCall': noParams,
  /** Stop showing the ringing call on the deck (Discord keeps ringing on the PC). */
  'discord.dismissCall': noParams,
  // OBS
  'obs.setScene': z.object({ scene: z.string().min(1).max(100) }).strict(),
  'obs.toggleRecord': noParams,
  'obs.toggleStream': noParams,
  'obs.saveReplay': noParams,
  'obs.addMarker': noParams,
  // Yeelight
  'light.toggle': noParams,
  'light.off': noParams,
  'light.setColor': z.object({ rgb: hexColor }).strict(),
  // Modes
  'dnd.toggle': noParams,
  'mode.run': z.object({ mode: ModeIdSchema }).strict(),
  // Apps: launch, or bring to front if already running
  'app.launch': z.object({ app: AppIdSchema }).strict(),
} as const;

export type ActionId = keyof typeof ACTION_PARAMS;
export const ACTION_IDS = Object.keys(ACTION_PARAMS) as [ActionId, ...ActionId[]];
export const ActionIdSchema = z.enum(ACTION_IDS);

export type ActionParamsMap = { [K in ActionId]: z.infer<(typeof ACTION_PARAMS)[K]> };

/** A validated action: `params` is typed according to `actionId`. */
export type ActionRequest = { [K in ActionId]: { actionId: K; params: ActionParamsMap[K] } }[ActionId];

/** Validates the params for a given action. */
export function parseActionRequest(
  actionId: ActionId,
  params: unknown,
): { ok: true; request: ActionRequest } | { ok: false; error: string } {
  const result = ACTION_PARAMS[actionId].safeParse(params ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `Invalid params for ${actionId}: ${issue?.message ?? 'unknown error'}` };
  }
  return { ok: true, request: { actionId, params: result.data } as ActionRequest };
}

/** Continuous values the tablet can set by swiping (0–100). */
export const ADJUST_IDS = ['volume.level', 'light.brightness'] as const;
export const AdjustIdSchema = z.enum(ADJUST_IDS);
export type AdjustId = z.infer<typeof AdjustIdSchema>;
