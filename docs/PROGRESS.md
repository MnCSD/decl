# Progress, decisions and gotchas

Last updated: 2026-11-09. Original requirements: [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Status

| Milestone | Status |
|---|---|
| M1 — Monorepo + protocol + agent skeleton | ✅ Done |
| M2 — Tablet app shell (Deck D UI) | ✅ Done (+ real app icons, pulled forward on request) |
| M3 — Connect + core actions | ✅ Done |
| Discord (pulled forward from M5, user's choice) | 🔍 Built, waiting for the user's check |
| M4 — Wake-on-LAN + asleep state | Not started |
| M5 — OBS, Yeelight, Modes, Focus timer (Discord done early) | Not started |
| M6 — Interactions & profiles | Not started (swipe-to-adjust already done in M3) |
| M7 — Polish | Not started |

The user approves each milestone before the next one starts.

## What exists

### M1 — agent + protocol
- `packages/protocol`: zod schemas shared by agent and app. Action ids + per-action params (`actions.ts`), `DeckState` (`state.ts`), client/server messages with a `v: 1` version field (`messages.ts`), layout schema (`layout.ts`). Used as TypeScript source (no build step): the agent runs it via `tsx`, Metro bundles it for the app.
- `apps/agent`: WebSocket server on 4343 (`server.ts`), pairing (`security/pairing.ts`), paired devices with hashed tokens (`security/device-store.ts`), LAN-only filter (`security/net.ts`), state store, platform split (`platform/windows`, `platform/mock`), CLI test client (`cli/client.ts`).
- Real Windows status: uptime, CPU % (from `os.cpus()`), CPU temp via WMI (often unavailable without admin), GPU temp via `nvidia-smi`.
- Windows actions: see M3 and Discord below. OBS/light/modes still throw "not implemented on Windows yet" (M5).

### M2 — tablet app (`apps/deck`)
- Expo SDK 58, React Native 0.88, New Architecture, runs in **Expo Go** for now.
- Deck D UI drawn at 1340×800 and uniformly scaled to the screen (`App.tsx` `ScaleToFit`).
- Layout from `src/config/default-layout.json`, validated at startup (error screen if invalid) and in `npm test`.
- Key types: `button`, `value` (liquid fill), `ring`, `nowPlaying`, `recording`, `folder`, `squad`, `swatches`, `app`.
- Top bar (profile keycap, centered page track, mic/PC chips, clock, edit button), page switching by tap and swipe, press animation, haptics, keep-awake, hidden status/nav bars, landscape lock.
- (M2 used static sample data; removed in M3.)

### Real app icons (added during M2 at the user's request)
- Agent allow-list `%APPDATA%\DeskDeck\apps.json`, auto-created on first run from installed apps (`apps/apps-config.ts`). User can edit it.
- Icons extracted at startup via the Windows Shell API (`IShellItemImageFactory`) in a PowerShell + C# snippet (`platform/windows/icons.ts`), sent to clients as an `appIcons` message (PNG data URLs).
- Running detection via `tasklist` every 3 s (`platform/windows/apps.ts`), exposed as `state.apps`.
- `app.launch { app }` launches or focuses (`whenRunning: focus | focus-only | launch`).
- App keys show the full-color icon on a brand-color tile; glow + white dot while running.
- The tablet caches the last icons it received (AsyncStorage), so they still show while the PC is off.

### M3 — connection + core actions
**Agent (Windows)**
- **Persistent helper process** (`platform/windows/helper.ts` + `helper/helper-host.ps1` + `helper/DeckHelper.cs`): one PowerShell started at agent startup, C# compiled once, then one-line JSON commands over stdin → JSON replies on stdout. ~1 s startup, milliseconds per call. Fixed command list; restarts with backoff if it dies; exits by itself when the agent dies (stdin closes).
- Volume get/set/mute: Core Audio `IAudioEndpointVolume` on the default playback device (looked up per call, so switching devices works).
- Now playing + play/pause/next/previous: SMTC (`GlobalSystemMediaTransportControlsSessionManager`, the API behind the Windows media flyout). Falls back to media keys (`keybd_event`) when no app has a media session. Album art: 240 px JPEG data URL (~10 KB), read once per track. The now-playing key (`NowPlayingKey.tsx`) shows the art edge to edge: playing = bright art + glowing cap + animated equalizer badge; paused = dimmed art + play triangle.
- `MediaVolumePoller` (`media-volume.ts`) polls volume + media every 1 s (so changes made on the PC show up) and right after media/volume actions. Helper output is validated with zod.
- Lock: `LockWorkStation`. Screens off: `PostMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2)`. Sleep: `Application.SetSuspendState(Suspend)` (helper replies first, then sleeps after 500 ms). Screenshot: all monitors (DPI-aware) → `Pictures\Screenshots\DeskDeck_<local time>.png` (Pictures path from Windows, follows OneDrive). Shutdown/restart: `shutdown.exe /s|/r /t 0` (no key yet).
- Test: `helper.test.ts` starts the real helper on Windows (read-only commands only).

**Tablet**
- `connection/storage.ts`: token in **expo-secure-store** (Android keystore); PC address + icon cache in **AsyncStorage**. Browser preview stores the token in AsyncStorage too (SecureStore has no web support).
- `connection/deck-client.ts` (plain TS): `pairWithPc()` one-shot pairing; `DeckClient` does `hello` auth, zod-validates every message, reconnects with backoff 1/2/4/8/10 s, app-level ping every 10 s and treats 25 s of silence as a dead connection, `runAction`/`adjust` with 8 s timeout. `unknown-token` → back to pairing screen with a notice.
- `connection/useDeck.ts`: React hook gluing storage + client to the screens; reconnects immediately when the app returns to the foreground.
- `screens/PairScreen.tsx`: PC address (`host` or `host:port`) + 6-digit code. `screens/DeckScreen.tsx` now gets live state via props.
- Offline: PC chip shows CONNECTING… / PC OFFLINE and the keys dim (asleep layout comes in M4). Long-press the PC chip → FORGET PC? (inline confirm, no dialog).
- Failed action: error haptic + console warning (red key flash is M7).
- **Swipe-to-adjust on value keys** (pulled forward from M6 at the user's request): `components/ValueKey.tsx`. Vertical drag (claimed when |dy| > 8 px and more vertical than horizontal; the grid keeps horizontal page swipes) sets 0–100, 180 design-px = full range, corrected for the screen scale. Shows the finger value immediately, sends `adjust` at most every 80 ms plus the final value, holds the local value 1.2 s after release so it doesn't jump back. Haptic tick every 10 %. Tap still = the key's action (mute / light toggle). Volume > 0 unmutes (agent side).
- `components/press-guard.ts`: drags (value adjust, page swipe) block key presses until 350 ms after they end, so releasing a drag never also counts as a tap.

### Discord (pulled forward from M5)
**Agent** (`platform/windows/discord/`)
- `ipc.ts`: client for Discord's local RPC on the named pipe `\\?\pipe\discord-ipc-0..9`. Frames = int32 LE opcode + int32 LE length + JSON. Handshake `{v:1, client_id}` → READY; commands matched by random `nonce`; PING answered with PONG; replies with `evt: "ERROR"` become `DiscordRpcError` (with Discord's code).
- `credentials.ts`: `discord.json` in the data dir (clientId, clientSecret, accessToken, refreshToken, expiresAt), validated with zod. Token exchange/refresh: form-encoded POST to `https://discord.com/api/oauth2/token`, redirect URI `http://localhost`. Scopes `rpc rpc.voice.read rpc.voice.write`. Errors only include Discord's short error code, never bodies/tokens.
- `discord-voice.ts`: retries every 5 s (finds Discord when it starts, picks up a fresh setup without restarting the agent; logs each new problem once). AUTHENTICATE with the saved token (refreshes a day before expiry, or once when Discord rejects it; if that fails → `notSetUp`). Subscribes `VOICE_SETTINGS_UPDATE` + `VOICE_CHANNEL_SELECT`; for the current channel `VOICE_STATE_CREATE/UPDATE/DELETE` + `SPEAKING_START/STOP` (unsubscribes when switching channels). Mute/deafen = `SET_VOICE_SETTINGS {mute|deaf: !current}`. `micMuted` = mute OR deaf (Discord mutes while deafened).
- `avatars.ts`: downloads `cdn.discordapp.com` avatars (64 px; default avatar `(id >> 22) % 6` when none) once per user+avatar, as data URLs. id/hash are regex-checked before going into a URL; 256 KB cap.
- `cli/discord-setup.ts` (`npm run discord:setup`): asks Client ID/Secret, AUTHORIZE (popup in Discord, 2 min), exchanges the code, AUTHENTICATEs, saves.
- Tests: `discord.test.ts` runs a fake Discord on a test pipe (split frames, concurrent requests, errors, events; full DiscordVoice flow without internet).

- **Incoming calls** (user asked; found by experiment): Discord has no call event, but a ringing call produces a `NOTIFICATION_CREATE` (scope `rpc.notifications.read`) whose `message.type` is **3 (CALL)** with the call's `channel_id`. Ringing ends when we join that channel (`VOICE_CHANNEL_SELECT`), the caller leaves (`GET_CHANNEL` every 2 s; "empty" only trusted after the caller was seen), on dismiss, or after 60 s. `discord.answerCall` = `SELECT_VOICE_CHANNEL {channel_id, force: true}` (the channel id never comes from the tablet). `discord.dismissCall` only hides it on the deck. Notification text is never read or logged.
- `discord.json` is watched: re-running setup reconnects with the new login (own token refreshes are ignored by comparing the refresh token).

**Protocol**: `voice` now has `link` (`notSetUp | offline | connected`), `channel` (`{name, memberCount}` or null) and `members` (max 6: others first, us last; `avatarUrl`, `speaking`, `muted`, `deafened`). New lit source `voice.inCall`. `voice.incomingCall` (`{name, avatarUrl}` or null). Actions `discord.answerCall`, `discord.dismissCall`.

**Incoming call banner** (`components/IncomingCall.tsx`): slides down over the top bar on any page; caller avatar with a pulsing green ring, Ignore (X) and Answer (phone) buttons; tablet buzzes every 1.5 s while ringing. The **squad key** also turns into a ringing key (caller avatar, two green ripples clipped by the face, wiggling phone badge, green glow); tapping it answers (`useDeck.pressKey` maps a squad press to `discord.answerCall` while ringing).

**Ringtone**: the banner plays a looping ringtone (expo-audio, Expo Go-compatible) at 60 % volume. Default: `assets/sounds/ring-chime.wav`, an original two-note chime generated in code for this app. Custom: the user puts `ringtone.mp3|wav|ogg|m4a` (max 2 MB) in `%APPDATA%\DeskDeck\sounds\`; the agent reads it at startup (`sounds.ts`) and sends it to paired tablets in a `sounds` message (data URL). Third-party sounds are never stored in the repo, only on the user's PC. The mock rings 10 s after start for 30 s, every 2 minutes.

**Tablet**: `components/SquadKey.tsx`: up to 3 overlapping avatars (initials on a stable color if no image), green ring while talking, dimmed if deafened, "+N" badge; lit while in a call; three dashed empty seats when not in a call. The mic chip says DISCORD OFF / DISCORD NOT LINKED when the agent has no Discord link. The mock agent has a fake 4-person channel with random talking.

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
| **Persistent PowerShell helper** for Windows APIs (user's choice, M3) | Spawning PowerShell + compiling C# costs ~0.5–1 s per call; too slow for keys and 1 s polling. No native Node modules needed. |
| **Discord via local RPC, not hotkeys** (user's choice; brief said hotkeys) | Hotkeys can't read real mute/deafen state or who's in the call. Costs a one-time Discord developer app + `npm run discord:setup`. |
| **Exception to "LAN only" for Discord** (user approved) | The *agent* makes outgoing HTTPS calls to discord.com: OAuth token exchange/refresh and avatar downloads. Nothing listens on the internet; the tablet stays LAN only (avatars are forwarded as data URLs). |
| Discord was done before M4 (user's choice) | Keeps Expo Go working a bit longer; M4 needs the Android dev build. |
| expo-secure-store (token) + AsyncStorage (address, icon cache) | Both in Expo Go. SecureStore isn't meant for big values (~2 KB historically on iOS), icons are ~100s of KB. |
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
- **Windows PowerShell 5.1 + WinRT streams**: PowerShell can't cast a WinRT stream to `IInputStream` (neither `AsStreamForRead` nor `DataReader` accept it). Pass it to C# as `object` and use `CreateStreamOverRandomAccessStream` (shcore.dll) to get a COM `IStream`.
- **react-native-web delivers a click after a PanResponder drag** that started on a Pressable (native cancels the press). Hence `press-guard.ts`. On web, gesture `dy` also seems to count from when the responder was granted, not from touch start.
- **Spotify's SMTC thumbnail has its logo baked in**: a black square with the art (~78% wide, top-centered) and a "Spotify" bar below. `DeckHelper.cs` `SpotifyArtBounds` crops to the art when the session's `SourceAppUserModelId` contains "Spotify" (finds the black side margins; falls back to fixed fractions for very dark covers).
- **Discord RPC is restricted**: scopes `rpc`, `rpc.voice.*` are "approved partners only"; unapproved apps work only for the app owner / up to 50 App Testers. Fine for personal use. Voice settings can be changed by only one RPC app at a time.
- Discord's VOICE_SETTINGS_UPDATE docs example omits `mute`/`deaf`; the code only applies fields that are present and reads GET_VOICE_SETTINGS on connect.
- In PowerShell, `continue`/`break` inside a `switch` act on the switch, not the surrounding loop.
- React Native 0.88 removed `StyleSheet.absoluteFillObject` (use explicit `position/top/left/right/bottom`). TextInput refs are typed `ComponentRef<typeof TextInput>`.
- Some repo files use CRLF line endings: multi-line string replacements from scripts must handle `\r\n` (the Edit tool handles it).
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

## Next: M4 plan (Wake-on-LAN + asleep state)
- Switch from Expo Go to an **Android dev build** (`react-native-udp` for the magic packet). Needs Android Studio locally, or EAS cloud build.
- Agent sends the PC's MAC address (+ broadcast address) so the tablet can store it while the PC is awake.
- Tablet: asleep layout (`DeckAsleep.dc.html`) with a big 2×2 Wake PC key + keys with `needsPc: false`; send the magic packet; reconnect when the agent comes back.
- PC setup the user must do once: enable Wake-on-LAN in BIOS/UEFI and in the network adapter's Windows settings ("Wake on Magic Packet"). Wake from sleep is reliable; wake from full shutdown depends on the board (and Windows Fast Startup may need to be off).
- Agent must be running after the PC wakes: from sleep it keeps running; after a full boot it needs auto-start at login (M7, could be pulled forward).
