# Progress, decisions and gotchas

Last updated: 2026-11-09. Original requirements: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Status

| Milestone | Status |
|---|---|
| M1 — Monorepo + protocol + agent skeleton | ✅ Done |
| M2 — Tablet app shell (Deck D UI) | ✅ Done (+ real app icons, pulled forward on request) |
| M3 — Connect + core actions | ⏭ Next |
| M4 — Wake-on-LAN + asleep state | Not started |
| M5 — Discord, OBS, Yeelight, Modes, Focus timer | Not started |
| M6 — Interactions & profiles | Not started |
| M7 — Polish | Not started |

The user approves each milestone before the next one starts.

## What exists

### M1 — agent + protocol
- `packages/protocol`: zod schemas shared by agent and app. Action ids + per-action params (`actions.ts`), `DeckState` (`state.ts`), client/server messages with a `v: 1` version field (`messages.ts`), layout schema (`layout.ts`). Used as TypeScript source (no build step): the agent runs it via `tsx`, Metro bundles it for the app.
- `apps/agent`: WebSocket server on 4343 (`server.ts`), pairing (`security/pairing.ts`), paired devices with hashed tokens (`security/device-store.ts`), LAN-only filter (`security/net.ts`), state store, platform split (`platform/windows`, `platform/mock`), CLI test client (`cli/client.ts`).
- Real Windows status: uptime, CPU % (from `os.cpus()`), CPU temp via WMI (often unavailable without admin), GPU temp via `nvidia-smi`.
- Windows **actions are not implemented yet** except `app.launch`. Everything else throws "not implemented on Windows yet" (M3/M5).

### M2 — tablet app (`apps/deck`)
- Expo SDK 58, React Native 0.88, New Architecture, runs in **Expo Go** for now.
- Deck D UI drawn at 1340×800 and uniformly scaled to the screen (`App.tsx` `ScaleToFit`).
- Layout from `src/config/default-layout.json`, validated at startup (error screen if invalid) and in `npm test`.
- Key types: `button`, `value` (liquid fill), `ring`, `nowPlaying`, `recording`, `folder`, `squad`, `swatches`, `app`.
- Top bar (profile keycap, centered page track, mic/PC chips, clock, edit button), page switching by tap and swipe, press animation, haptics, keep-awake, hidden status/nav bars, landscape lock.
- **Static data**: `src/state/sample-state.ts`. Taps only change local preview state (`src/state/preview-actions.ts`, M2-only, to be replaced by real `runAction` in M3).

### Real app icons (added during M2 at the user's request)
- Agent allow-list `%APPDATA%\DeskDeck\apps.json`, auto-created on first run from installed apps (`apps/apps-config.ts`). User can edit it.
- Icons extracted at startup via the Windows Shell API (`IShellItemImageFactory`) in a PowerShell + C# snippet (`platform/windows/icons.ts`), sent to clients as an `appIcons` message (PNG data URLs).
- Running detection via `tasklist` every 3 s (`platform/windows/apps.ts`), exposed as `state.apps`.
- `app.launch { app }` launches or focuses (`whenRunning: focus | focus-only | launch`).
- App keys show the full-color icon on the dark face and glow in the category color + small dot while running.
- M2 preview uses icons extracted on the dev laptop: `apps/deck/src/state/sample-app-icons.json` (regenerate with `npm run client -- icons <dir>` and copy `icons.json` over it).

## Decisions (and why)

| Decision | Why |
|---|---|
| **Expo Go for M2–M3, Android dev build from M4** | See the tablet early without installing Android Studio. Wake-on-LAN needs `react-native-udp` (and direct Yeelight needs a TCP module), which Expo Go can't load. Keep code Expo Go-compatible until M4. |
| Local build (`npx expo run:android`, needs Android Studio) as the default when the dev build is needed; EAS cloud build is the alternative | Faster iteration, works offline. Not installed on the dev laptop yet. |
| zod 4, vitest 5 | Older majors had security advisories at install time. |
| Token stored as SHA-256 hash | Tokens are 32 random bytes; slow hashes (bcrypt) are only needed for human passwords. Compared with `timingSafeEqual`. |
| Pairing code: 6 digits, single use, 5 min, 60 s lockout after 5 wrong tries | Prevents brute force on the LAN. Code printed to console only (never logged). |
| Auth by first message (`hello { token }`), not URL | Keeps the token out of URLs. Unauthenticated sockets close after 15 s. |
| Full state snapshots, throttled to 100 ms | "Keep it simple first" per brief. |
| Layout `lit` / `value` / `ring` bindings use a **fixed list** of state fields | Layout JSON can't reach arbitrary data. |
| Network sends **app ids only**; paths/args live in `apps.json` on the PC | "Never run arbitrary commands sent from the network." Tested. |
| **Full-color app icons** with category-color glow while running | User's choice over tinted glyphs. |
| Shut down / Restart get **no key** until the M6 long-press menu | Avoid turning the PC off by accident. Tap on Sleep = sleep. |
| Fonts imported per weight (`@expo-google-fonts/inter/600SemiBold`) | Importing the package root bundles all 36 font files (~12 MB). |
| Browser preview (`react-dom`, `react-native-web`) installed | Lets the agent screenshot/verify the UI with Playwright. Not used on the tablet. |
| **Stream Deck-style LCD keys: artwork only, no text labels** (all key types) | User's choice (2026-11-09), from a hardware stream-deck photo. Big full-face artwork + glossy top highlight. Labels remain as `accessibilityLabel`. |
| App keys use an optional brand `color` (layout JSON) as the tile color, falling back to the category color | Windows icons have transparent backgrounds; the tile color makes them read like full-bleed app tiles. |

## Design deviations from Deck D (intentional)
- Ring keys (CPU/GPU/Focus) and the Stream folder key: the design draws the arc/icon in the same color as the lit face (invisible). They use dark ink `#0A0A0C` instead.
- Pages 02 Voice, 03 Apps, 04 Lights were not specified: Voice and Lights got example keys, Apps holds app keys. Edit the JSON freely.
- Keys with no action yet: Squad (Discord voice members, M5), Layout, To phone. They press but do nothing.
- Page track is absolutely centered so it doesn't shift when the mic chip changes width.
- **No text labels on keys** (Deck D has a label under every icon). To keep similar keys distinguishable: ring keys show a tiny "CPU"/"GPU" caption inside the ring, value keys show a small icon (speaker/bulb) above the number, and the OBS scene keys use distinct icons (gamepad / chat / coffee). Single-color swatch keys fill the whole face with that color.

## Gotchas (learned the hard way)
- **Windows PowerShell 5.1** strips inner double quotes when calling programs: write JSON as `'{\"scene\":\"Chat\"}'`. For some programs (seen with `claude mcp add`) it also swallows a bare `--`: quote it as `'--'`. `npm run x -- args` is fine.
- Stopping a background `npm run …` on Windows can leave the `node` child running. Kill by port (`Get-NetTCPConnection -LocalPort 4343`).
- Windows Defender/indexer can briefly lock a just-written file (`EPERM` on rename). `device-store.ts` retries.
- Unhandled promise rejections crash Node: `server.ts` catches all message-handler errors.
- `create-expo-app` creates a nested `.git` (removed).
- In the browser preview, orientation lock and the native animation driver aren't available (harmless warnings).
- Playwright MCP on Windows: register as `claude mcp add playwright '--' cmd /c npx -y @playwright/mcp@latest` (without `-y` it hangs on npx's install prompt).

## Environment notes
- Development currently happens on a **work laptop**, not the gaming PC: no NVIDIA GPU, no Android SDK, network `192.168.102.x` (home network is `192.168.2.x`). Use the mock agent here; PC-specific checks (sleep, GPU temp, Discord, Steam, WoL) happen at home.
- Git repo initialized; first commit `M1-M2`. Now also being developed on the home PC (`192.168.2.x`), where Discord and League are installed.
- Agent data folder: `%APPDATA%\DeskDeck\` → `devices.json` (paired devices), `apps.json` (app allow-list), `cli-client.json` (CLI test client's token).

## Design source
Design canvas: https://claude.ai/code/artifact/57205ff3-fc75-47a7-8fae-22bec1d271c5 (read with the Artifact tool, not a web fetch).
Relevant boards (files under `project/`): `TabletDeckD.dc.html` (main deck, M2), `DeckAsleep.dc.html` (M4), `DeckKeyOptions.dc.html`, `DeckProfiles.dc.html`, `DeckStream.dc.html`, `DeckPage2.dc.html` (M6), `DeckEdit.dc.html` (M7).

## Next: M3 plan
- Tablet: pairing screen (PC IP + code), token in secure storage, live connection replacing sample data, taps send `runAction`, received `appIcons` cached, basic reconnect.
- Agent (Windows): lock, sleep (S3 via `SetSuspendState('Suspend', $false, $false)`), screens off, screenshot to a folder, media play/pause/next/previous + now playing via SMTC, master volume get/set/mute. Shut down/restart implemented but not on any key until M6.
- Test on the laptop with the mock agent (and safe real actions: volume, media, lock, screenshot, screens off); final check on the gaming PC.
