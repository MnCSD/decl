import { z } from 'zod';
import { ActionIdSchema, AdjustIdSchema, AppIdSchema } from './actions';
import { PROTOCOL_VERSION } from './constants';
import { DeckStateSchema } from './state';

const v = z.literal(PROTOCOL_VERSION);
/** Client-chosen id so a `result` can be matched to the request that caused it. */
const requestId = z.string().min(1).max(64);

// ---------------------------------------------------------------------------
// Tablet -> agent
// ---------------------------------------------------------------------------

/** First message on every connection from an already-paired device. */
export const HelloSchema = z.object({
  v,
  type: z.literal('hello'),
  token: z.string().min(20).max(200),
});

/** First message from a new device: exchange the 6-digit code for a token. */
export const PairSchema = z.object({
  v,
  type: z.literal('pair'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  deviceName: z.string().min(1).max(60),
});

export const RunActionSchema = z.object({
  v,
  type: z.literal('runAction'),
  id: requestId,
  actionId: ActionIdSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});

export const AdjustSchema = z.object({
  v,
  type: z.literal('adjust'),
  id: requestId,
  actionId: AdjustIdSchema,
  value: z.number().int().min(0).max(100),
});

export const PingSchema = z.object({ v, type: z.literal('ping') });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  HelloSchema,
  PairSchema,
  RunActionSchema,
  AdjustSchema,
  PingSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Agent -> tablet
// ---------------------------------------------------------------------------

export const WelcomeSchema = z.object({
  v,
  type: z.literal('welcome'),
  deviceId: z.string(),
  deviceName: z.string(),
});

export const PairedSchema = z.object({
  v,
  type: z.literal('paired'),
  deviceId: z.string(),
  /** Long random secret. Store it securely and send it in `hello` from now on. */
  token: z.string(),
});

export const PairFailedSchema = z.object({
  v,
  type: z.literal('pairFailed'),
  reason: z.enum(['wrong-code', 'locked']),
  retryAfterSec: z.number().optional(),
});

export const AuthFailedSchema = z.object({
  v,
  type: z.literal('authFailed'),
  reason: z.enum(['unknown-token', 'not-authenticated', 'timeout']),
});

export const StateMessageSchema = z.object({
  v,
  type: z.literal('state'),
  state: DeckStateSchema,
});

export const ResultSchema = z.object({
  v,
  type: z.literal('result'),
  id: requestId,
  ok: z.boolean(),
  error: z.string().optional(),
});

export const PongSchema = z.object({ v, type: z.literal('pong') });

/**
 * Real app icons extracted on the PC, sent once after `welcome` (and again if apps change).
 * The tablet caches them so they still show while the PC sleeps.
 */
export const AppIconsSchema = z.object({
  v,
  type: z.literal('appIcons'),
  /** appId -> "data:image/png;base64,..." */
  icons: z.record(AppIdSchema, z.string().startsWith('data:image/png;base64,').max(512 * 1024)),
});

/**
 * Custom sounds from the PC's data folder (sounds\ringtone.*), sent once after `welcome`.
 * null = no custom file; the tablet uses its built-in chime.
 */
export const SoundsSchema = z.object({
  v,
  type: z.literal('sounds'),
  ringtone: z
    .string()
    .regex(/^data:audio\/(mpeg|wav|ogg|mp4|x-m4a);base64,/)
    .max(3 * 1024 * 1024)
    .nullable(),
});

export const ErrorMessageSchema = z.object({
  v,
  type: z.literal('error'),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  WelcomeSchema,
  PairedSchema,
  PairFailedSchema,
  AuthFailedSchema,
  StateMessageSchema,
  ResultSchema,
  PongSchema,
  AppIconsSchema,
  SoundsSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------------------------------------------------------------------------
// Parsing helpers (both sides use these so validation is identical)
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON' };
  }

  // Check the version first so an old/new client gets a clear error.
  const envelope = z.object({ v: z.number(), type: z.string() }).safeParse(json);
  if (!envelope.success) {
    return { ok: false, error: 'Message must have numeric "v" and string "type"' };
  }
  if (envelope.data.v !== PROTOCOL_VERSION) {
    return { ok: false, error: `Unsupported protocol version ${envelope.data.v} (expected ${PROTOCOL_VERSION})` };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at "${issue.path.join('.')}"` : '';
    return { ok: false, error: `Invalid "${envelope.data.type}" message${where}: ${issue?.message ?? 'unknown error'}` };
  }
  return { ok: true, message: result.data };
}

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(ClientMessageSchema, raw);
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(ServerMessageSchema, raw);
}
