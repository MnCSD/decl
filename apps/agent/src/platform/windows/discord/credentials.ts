import fs from 'node:fs';
import { z } from 'zod';
import { writeJsonFile } from '../../../json-file';

/**
 * Discord login data, kept in discord.json in the agent's data folder
 * (%APPDATA%\DeskDeck, readable only by your Windows user). Never logged.
 *
 * clientId/clientSecret come from your app on discord.com/developers.
 * The tokens come from the one-time `npm run discord:setup`.
 */

/** Must also be added under OAuth2 → Redirects in the Discord app settings. */
export const REDIRECT_URI = 'http://localhost';

/**
 * rpc = talk to the local app; voice.read = see voice state; voice.write = mute/deafen;
 * notifications.read = Discord's desktop notifications (that's how incoming calls are spotted).
 */
export const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write', 'rpc.notifications.read'];

const TOKEN_URL = 'https://discord.com/api/oauth2/token';

const CredentialsSchema = z.object({
  clientId: z.string().regex(/^\d{5,25}$/, 'Client ID is a long number'),
  clientSecret: z.string().min(1),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  /** ms since 1970 */
  expiresAt: z.number().optional(),
});
export type DiscordCredentials = z.infer<typeof CredentialsSchema>;

export function loadCredentials(filePath: string): DiscordCredentials | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = CredentialsSchema.safeParse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveCredentials(filePath: string, creds: DiscordCredentials): void {
  writeJsonFile(filePath, creds);
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(), // seconds (usually 7 days)
});

/** Turns the code from Discord's "Authorize" popup into tokens. */
export function exchangeCode(creds: DiscordCredentials, code: string): Promise<DiscordCredentials> {
  return requestTokens(creds, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
}

/** Gets a fresh access token with the refresh token (no popup). */
export function refreshTokens(creds: DiscordCredentials): Promise<DiscordCredentials> {
  if (!creds.refreshToken) return Promise.reject(new Error('No refresh token; run discord:setup'));
  return requestTokens(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken });
}

/** The only internet call in the agent besides avatar downloads: Discord's OAuth2 token endpoint. */
async function requestTokens(creds: DiscordCredentials, fields: Record<string, string>): Promise<DiscordCredentials> {
  const body = new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...fields });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body, // Discord only accepts form-encoded here, not JSON
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // Only the short error code (e.g. "invalid_grant", "invalid_client"); never the body.
    const reason = z.object({ error: z.string() }).safeParse(json);
    throw new Error(`Discord refused the login (${res.status}${reason.success ? ` ${reason.data.error}` : ''})`);
  }
  const tokens = TokenResponseSchema.parse(json);
  return {
    ...creds,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
