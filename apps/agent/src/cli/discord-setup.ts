import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { loadConfig } from '../config';
import {
  REDIRECT_URI,
  SCOPES,
  exchangeCode,
  loadCredentials,
  saveCredentials,
  type DiscordCredentials,
} from '../platform/windows/discord/credentials';
import { DiscordIpc, DiscordRpcError } from '../platform/windows/discord/ipc';

/**
 * One-time Discord link: npm run discord:setup
 *
 * 1. Asks for your Discord app's Client ID + Client Secret.
 * 2. Asks the Discord app on this PC for permission (a popup appears in Discord).
 * 3. Saves the login to discord.json; the running agent picks it up within a few seconds.
 */
async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Discord setup only works on the Windows PC.');
  const { dataDir } = loadConfig(process.argv.slice(2));
  const file = path.join(dataDir, 'discord.json');
  const existing = loadCredentials(file);

  console.log(`
Desk Deck · Discord setup
─────────────────────────
If you haven't yet, create the Discord app (2 minutes):
  1. Open https://discord.com/developers/applications → "New Application", name it "Desk Deck".
  2. OAuth2 page → Redirects → "Add Redirect" → ${REDIRECT_URI} → Save Changes.
  3. On the same page copy the Client ID, and "Reset Secret" to get the Client Secret.
`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string, current?: string) => {
    const answer = (await rl.question(current ? `${question} [press Enter to keep the saved one]: ` : `${question}: `)).trim();
    return answer || current || '';
  };
  const clientId = await ask('Client ID', existing?.clientId);
  const clientSecret = await ask('Client Secret', existing?.clientSecret);
  rl.close();

  if (!/^\d{5,25}$/.test(clientId)) throw new Error('The Client ID is a long number, e.g. 1234567890123456789.');
  if (!clientSecret) throw new Error('The Client Secret is needed.');
  let creds: DiscordCredentials = { clientId, clientSecret };

  console.log('\nConnecting to Discord on this PC…');
  const ipc = new DiscordIpc();
  try {
    await ipc.connect(clientId);
  } catch (err) {
    if (err instanceof DiscordRpcError) throw new Error(`Discord rejected the Client ID (${err.message}).`);
    throw new Error('Could not reach Discord. Is the Discord app open on this PC?');
  }

  try {
    console.log('→ Look at Discord: click "Authorize" in the popup (waiting up to 2 minutes).');
    let code: string;
    try {
      const reply = await ipc.request('AUTHORIZE', { client_id: clientId, scopes: SCOPES }, undefined, 120_000);
      code = z.object({ code: z.string() }).parse(reply).code;
    } catch (err) {
      throw new Error(
        err instanceof DiscordRpcError
          ? `Discord said no: ${err.message}. If it mentions testers, add yourself under App Testers in the developer portal.`
          : 'No answer from the popup (cancelled or timed out).',
      );
    }

    creds = await exchangeCode(creds, code);
    const auth = await ipc.request('AUTHENTICATE', { access_token: creds.accessToken });
    const user = z.object({ user: z.object({ username: z.string() }) }).parse(auth).user;
    saveCredentials(file, creds);
    console.log(`\n✔ Linked as ${user.username}. The agent picks this up by itself within a few seconds.`);
  } finally {
    ipc.close();
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
