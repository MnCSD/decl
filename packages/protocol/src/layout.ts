import { z } from 'zod';
import { ACTION_PARAMS, ActionIdSchema, AdjustIdSchema, AppIdSchema } from './actions';

/**
 * Deck layouts: profiles -> pages -> keys.
 * Stored as JSON so they can be edited without code changes. Keys only ever
 * reference known action ids and a fixed list of state fields.
 */

export const GRID_COLUMNS = 8;
export const GRID_ROWS = 4;
export const KEYS_PER_PAGE = GRID_COLUMNS * GRID_ROWS;

export const CATEGORIES = ['comms', 'media', 'stream', 'system', 'home', 'modes'] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** State fields that can make a key "lit". */
export const LIT_SOURCES = [
  'voice.micMuted',
  'voice.deafened',
  'volume.muted',
  'obs.scene',
  'obs.recording',
  'obs.streaming',
  'light.on',
  'modes.dnd',
  'modes.active',
] as const;
export type LitSource = (typeof LIT_SOURCES)[number];

/** "always" = permanently lit; otherwise lit when the state field is true (or equals `equals`). */
export const LitSchema = z.union([
  z.literal('always'),
  z.object({ source: z.enum(LIT_SOURCES), equals: z.string().optional() }).strict(),
]);
export type Lit = z.infer<typeof LitSchema>;

export const VALUE_SOURCES = ['volume.level', 'light.brightness'] as const;
export const RING_SOURCES = ['system.cpuTempC', 'system.gpuTempC', 'focus'] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// Fields every key has.
const common = {
  id: z.string().min(1).max(40),
  label: z.string().max(24),
  category: CategorySchema,
  /** false for keys that still work while the PC sleeps (e.g. room light, focus timer) */
  needsPc: z.boolean().default(true),
  /** what a tap does; omitted = the key does nothing yet */
  actionId: ActionIdSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
};

/** Icon + label. Lit state can swap icon and label (e.g. Mic -> Muted). */
const ButtonKeySchema = z
  .object({
    ...common,
    type: z.literal('button'),
    icon: z.string(),
    onIcon: z.string().optional(),
    onLabel: z.string().max(24).optional(),
    lit: LitSchema.optional(),
  })
  .strict();

/** Big number with the face filling from the bottom (volume, brightness). Swipe adjusts. */
const ValueKeySchema = z
  .object({ ...common, type: z.literal('value'), source: z.enum(VALUE_SOURCES), adjustId: AdjustIdSchema })
  .strict();

/** Small progress ring with a value in the middle (temperatures, focus timer). */
const RingKeySchema = z.object({ ...common, type: z.literal('ring'), source: z.enum(RING_SOURCES) }).strict();

/** Album art + play/pause button. */
const NowPlayingKeySchema = z.object({ ...common, type: z.literal('nowPlaying') }).strict();

/** OBS recording: lit red with a running timer while recording. */
const RecordingKeySchema = z
  .object({ ...common, type: z.literal('recording'), onLabel: z.string().max(24).optional() })
  .strict();

/** Opens a sub-page (wired up in M6). */
const FolderKeySchema = z
  .object({ ...common, type: z.literal('folder'), icon: z.string(), folder: z.string() })
  .strict();

/** Voice channel members as overlapping avatars. */
const SquadKeySchema = z.object({ ...common, type: z.literal('squad'), lit: LitSchema.optional() }).strict();

/** A row of color dots (LED strip presets). */
const SwatchesKeySchema = z
  .object({
    ...common,
    type: z.literal('swatches'),
    colors: z.array(hexColor).min(1).max(4),
    lit: LitSchema.optional(),
  })
  .strict();

/**
 * Launches/focuses an app from the agent's allow-list and shows its real icon.
 * Glows in the category color while the app is running. Tap = `app.launch`.
 */
const AppKeySchema = z.object({ ...common, type: z.literal('app'), app: AppIdSchema }).strict();

export const KeySchema = z.discriminatedUnion('type', [
  AppKeySchema,
  ButtonKeySchema,
  ValueKeySchema,
  RingKeySchema,
  NowPlayingKeySchema,
  RecordingKeySchema,
  FolderKeySchema,
  SquadKeySchema,
  SwatchesKeySchema,
]);
export type DeckKey = z.infer<typeof KeySchema>;
export type DeckKeyType = DeckKey['type'];

export const PageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(16),
  /** Up to 32 slots, left-to-right, top-to-bottom. null = empty slot. */
  keys: z.array(KeySchema.nullable()).max(KEYS_PER_PAGE),
});
export type DeckPage = z.infer<typeof PageSchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(16),
  icon: z.string(),
  pages: z.array(PageSchema).min(1).max(6),
  /** Sub-pages opened by folder keys. */
  folders: z.array(PageSchema).default([]),
});
export type DeckProfile = z.infer<typeof ProfileSchema>;

export const LayoutSchema = z
  .object({
    version: z.literal(1),
    profiles: z.array(ProfileSchema).min(1),
  })
  .superRefine((layout, ctx) => {
    // Check every key's params against its action, so a typo in the JSON is caught at load time.
    layout.profiles.forEach((profile, pi) => {
      [...profile.pages, ...profile.folders].forEach((page) => {
        page.keys.forEach((key, ki) => {
          if (!key?.actionId) return;
          const result = ACTION_PARAMS[key.actionId].safeParse(key.params ?? {});
          if (!result.success) {
            ctx.addIssue({
              code: 'custom',
              path: ['profiles', pi, page.id, ki, 'params'],
              message: `Key "${key.id}": invalid params for ${key.actionId}: ${result.error.issues[0]?.message}`,
            });
          }
        });
      });
    });
  });
export type DeckLayout = z.infer<typeof LayoutSchema>;

export function parseLayout(json: unknown): { ok: true; layout: DeckLayout } | { ok: false; error: string } {
  const result = LayoutSchema.safeParse(json);
  if (result.success) return { ok: true, layout: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid layout'}` };
}
