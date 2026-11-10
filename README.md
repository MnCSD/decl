# Desk Deck

A Stream Deck–style controller: an Android tablet on the desk shows a grid of glowing keycaps
and controls a Windows PC (system, media, volume, apps, later Discord, OBS, Yeelight and Wake-on-LAN).

- **What we set out to build:** [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) (original prompt)
- **What's done, decisions, gotchas, next steps:** [docs/PROGRESS.md](docs/PROGRESS.md)

## Status

M1 ✅ agent + protocol · M2 ✅ tablet UI (+ real app icons) · M3 ✅ pairing, live connection, System/Media/Volume actions · Discord ✅ (voice, squad, incoming calls; pulled forward from M5) · **M4 next**: Wake-on-LAN + asleep state.

## Project layout

```
packages/protocol   shared zod schemas: actions, live state, messages, key layouts
apps/agent          Windows PC agent (Node + TypeScript, WebSocket server on port 4343)
apps/deck           tablet app (Expo SDK 58; runs in Expo Go until M4)
docs/               project brief and progress log
```

## Agent (PC side)

```sh
npm install
npm run agent:mock      # simulated PC: fake stats/state, nothing real happens
npm run agent           # real Windows agent
npm run agent -- --port 4400 --log-level debug
```

The console shows a 6-digit pairing code (single use, valid 5 minutes, locks for 60 s after 5 wrong tries).
Data lives in `%APPDATA%\DeskDeck\`:
- `devices.json`: paired devices (token hashes only)
- `apps.json`: apps the deck may launch (created on first run from installed apps; edit to add more)
- `discord.json`: Discord app id/secret + login tokens (keep private)
- `sounds\ringtone.mp3` (or `.wav`/`.ogg`/`.m4a`, max 2 MB, optional): ringtone the tablet plays for incoming Discord calls. Without it the tablet plays its built-in chime. Restart the agent after changing it.

### Discord (one-time link)

The deck reads your real mute/deafen state and voice channel through Discord's local RPC.

1. https://discord.com/developers/applications → **New Application** → name it "Desk Deck".
2. **OAuth2** page → Redirects → **Add Redirect** → `http://localhost` → **Save Changes**.
   Copy the **Client ID**, then **Reset Secret** and copy the **Client Secret**.
3. With Discord open on the PC: `npm run discord:setup`, paste both, then click **Authorize** in the Discord popup.

The running agent picks it up within a few seconds and renews the login by itself.
If the popup says the app isn't allowed, add yourself under **App Testers** in the developer portal.
The agent contacts discord.com only for this login (and its weekly renewal) and to download voice-channel avatars.

## Test client (pretends to be the tablet)

```powershell
npm run client -- pair 123456            # once
npm run client -- watch                  # live state, one line per update
npm run client -- run media.playPause
npm run client -- run obs.setScene '{\"scene\":\"Chat\"}'   # \" needed in Windows PowerShell
npm run client -- adjust volume.level 40
npm run client -- icons C:\temp\deck-icons   # save the app icons the agent sends
npm run client -- actions                # list all action ids
npm run client -- --host 192.168.2.8 watch   # from another machine
```

## Tablet app

```sh
npm run deck                 # dev server + QR code; scan with Expo Go on the tablet
npm run deck -- --tunnel     # if the tablet is on a different network than this computer
npm run deck -- --web        # browser preview (no haptics/fullscreen); best at 1340×800
```

Key layout: `apps/deck/src/config/default-layout.json` (profiles → pages → up to 32 keys).
It's validated when the app starts and by `npm test`.
**First run:** the app shows a pairing screen. Enter the PC's address (printed by the agent as `ws://<address>:4343`;
only the address part, e.g. `192.168.2.8`) and the 6-digit code from the agent window.
The app remembers the PC and reconnects by itself. To pair with another PC: **long-press the PC chip** in the
top bar, then tap **FORGET PC?**.

In the browser preview the address `localhost` works when the agent runs on the same computer.
Careful: with the real agent (`npm run agent`), keys do real things (Lock, Sleep, Screens off…).

## Checks

```sh
npm run typecheck
npm test
```
