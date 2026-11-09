# Project brief (original prompt)

This is the original project prompt, kept verbatim. It is the source of truth for scope and requirements.
Decisions made since then (and the reasons) are in [PROGRESS.md](PROGRESS.md).

---

# Project: Desk Deck — a Stream Deck–style controller on my Android tablet

Build a two-part system that turns my 8.7" Android tablet (landscape, always on my desk) into a hardware-style "Stream Deck" for my Windows PC:

1. **PC agent** (Windows, Node.js + TypeScript): runs in the background, executes actions on the PC, and streams live state to the tablet.
2. **Tablet app** (Expo / React Native, **Android native build**, not Expo Go): a fullscreen 8×4 grid of glowing keycaps that triggers actions and shows live state. Because it's a native Android app, it can also **send Wake-on-LAN packets** to wake my PC.

Work in small, testable milestones. After each one, stop, tell me exactly how to run and verify it, and wait for my go-ahead. Ask me before big architectural decisions not covered here. I'm learning, so briefly explain anything non-obvious when you introduce it.

## My setup (facts you can rely on)
- PC: Windows, ASUS PRIME B360-PLUS, NVIDIA GPU, 3 monitors (vertical left, main, top). Wired Ethernet.
- PC LAN IP: `192.168.2.8` (reserved in router). Ethernet MAC: `04:D9:F5:63:05:81`.
- Wake-on-LAN already works from sleep (tested). Use broadcast `192.168.2.255`, UDP port 9.
- Windows has hibernation enabled, so do NOT use `rundll32 powrprof.dll,SetSuspendState` for sleep (that can hibernate). Use a method that forces real sleep (S3), e.g. PowerShell with `[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)`.
- Router: Vodafone H 300s (no WoL feature). Tablet and PC are on the same home network.
- Smart bulb: Yeelight on the LAN (I'll enable "LAN Control" in the Yeelight app).
- Apps I use: Discord, Spotify, OBS Studio (28+, built-in WebSocket server), League of Legends.

## Tech stack
- npm workspaces monorepo (npm 7+), no pnpm or yarn:
  - `apps/agent`: Node 20 + TypeScript, `ws` WebSocket server, `pino` logging. Runs headless; later starts with Windows.
  - `apps/deck`: Expo (latest SDK) + TypeScript, Android development build, landscape only.
- Tablet app requirements: immersive fullscreen (hide status/nav bars), keep the screen awake while open (expo-keep-awake), haptic feedback on press, works offline with a clear "PC asleep" state.
- Wake-on-LAN from the tablet: use a UDP library that works in a native Expo build (e.g. react-native-udp via a config plugin) to send the magic packet.

## Protocol & security
- Versioned JSON messages over WebSocket on the LAN (default port 4343).
- Agent → tablet: full `state` snapshot on connect, then updates (or full snapshots, keep it simple first).
- Tablet → agent: `runAction { actionId, params }`, `adjust { actionId, value }`.
- Pairing: agent shows a 6-digit code in its console (and later a QR); tablet enters it once, gets a long random device token, uses it on every connection. Agent stores hashed tokens. Reject unauthenticated connections and non-private IPs.
- Never log tokens. Keep everything on the local network.

## The design (match this closely; it's Deck D from my design canvas)
Canvas: tablet landscape ~1340×800 dp. Background `#050507`. Fonts: Inter (UI, 600/700) and JetBrains Mono (numbers, small caps-style meta text).

**Top bar (height 52):**
- Left: profile button styled as a keycap: 36×36 rounded square in room purple `#A78BFA` with a dark icon and soft purple glow, then "Game" (16px bold) and below it "AUTO · LEAGUE OPEN" (mono 10px, `#8E8E99`), then a chevron. Tapping opens a profile menu.
- Center: recessed page track (black, inner shadow, radius 18) with 4 page buttons: `01 Main`, `02 Voice`, `03 Apps`, `04 Lights`. Active page = filled `#A78BFA`, dark text, purple glow. Swipe left/right on the grid also changes page.
- Right: mic chip (dot + "MIC MUTED" red / "MIC LIVE" green), PC chip ("PC · 38°" with green dot, grey "PC ASLEEP" when offline), clock (24px bold) with date below (mono 10px), and an edit button (keycap style).

**Key grid:** 8 columns × 4 rows, keys 140×140, gap 18.

**Keycap anatomy:**
- Outer cap: radius 26, padding 7, background `#0B0B0E`, border `#1C1C22`, 4px black bottom border (pressable look), drop shadow. Pressing moves the cap down 3px.
- Inner face (the "LCD"): radius 19, background `#111116`, thin dark inset ring.
- Content centered: icon ~42px, label 12px semibold below it.
- **Off state:** dark face, icon tinted with its category color, light label.
- **On state (lit):** face fully filled with the category color, icon and label in dark ink `#0A0A0C`, outer glow in the category color.

**Category colors (strict, one per category):**
- Comms `#8B7BFF` · Media `#2FD39A` · Stream `#FF5466` · System `#4CC3FF` · Home `#FFB547` · Modes `#A78BFA` (room purple)

**Special key types:**
- Live value keys: big mono number (Volume "72", Room light "60") with the face **filling from the bottom** like liquid in the category color (28% alpha, 2px solid top edge). Swipe up/down on these keys to adjust; tap toggles mute/off.
- Ring keys: small circular progress ring with value in the middle (CPU °, GPU °, Focus timer).
- Now playing key: album art fills the face, with a dimming overlay and a round white pause/play button on top.
- Recording key: lit red with "● 12:48" timer.
- Long-press any key: opens an options popover above the key (e.g. Sleep → Sleep / Shut down / Sleep in 30 min / Lock / Restart, plus "Edit key").

**PC asleep state:** PC-dependent keys fade to 25% opacity and a 2×2 amber "Wake PC" key appears in the middle (sends WoL). Keys that don't need the PC (Room light, Lights off, Focus timer) stay fully active.

## Page 01 "Main", initial key layout (row by row)
1. Mic (Stream, lit when muted) · Deafen (Comms) · Squad voice (Comms) · Discord (Comms) · Now playing (Media) · Next (Media) · Volume (Media, swipe) · DND (Modes)
2. Scene Game · Scene Chat · Scene BRB (Stream, active scene lit) · Recording (Stream) · Clip 30s · Marker · Go live (Stream) · Screenshot (System)
3. CPU ring · GPU ring · Layout · Screens off · Lock · Sleep (System) · Focus timer (Home) · Stream folder ›
4. Gaming · Study · Movie · Goodnight (Modes) · Room light (Home, swipe) · LED strip (Home) · Lights off (Home) · To phone (System)

Store layouts as JSON config (profiles → pages → keys with `actionId`, `category`, `label`, `icon`, params) so I can edit them later without code changes.

## Actions (how the agent should implement them)
- **System:** lock (`LockWorkStation`), sleep (see note above), shut down, restart, screens off (monitor power-off message), screenshot (save to a folder), CPU % and temperature where available, GPU temp via `nvidia-smi`, uptime.
- **Media:** play/pause, next, previous, and now-playing title/artist/art via the Windows media session (SMTC). Master volume get/set/mute.
- **Discord:** there's no official local control API for mute, so use global hotkeys. The agent sends unused keys (F13–F24) that I bind in Discord to Toggle Mute / Toggle Deafen. Tell me exactly which to bind. Mic-muted state can be tracked from our own toggles for now.
- **OBS:** obs-websocket v5: switch scenes, current scene, start/stop recording + elapsed time, save replay buffer (Clip 30s), start/stop streaming, recording chapter marker if supported by the installed version.
- **Yeelight:** LAN control protocol (TCP 55443): on/off, brightness, color. The agent handles it (browsers can't), and the tablet can also call it directly as a native app when the PC is asleep.
- **Modes:** composite actions (e.g. Gaming = DND on + OBS scene + Yeelight purple; Goodnight = lights off + screens off + PC sleep).
- **Focus timer:** runs on the tablet; dims the Yeelight when it starts and pulses it when it ends.
- **Auto profiles:** the agent watches running processes and tells the tablet to switch profile (e.g. League client → "Game", OBS → "Stream").

## Build order (milestones)
**M1 — Monorepo + protocol + agent skeleton.** WebSocket server, pairing, live status (uptime, CPU, GPU temp), and a `--mock` mode that simulates state and actions so the app can be built without the real PC. Add a CLI test client.

**M2 — Tablet app shell.** Expo Android dev build, landscape immersive fullscreen, keep-awake. Render the full Deck D UI from the JSON layout with static data: top bar, 8×4 keycaps, on/off states, press animation, haptics, page switching. Get the visual design right here before wiring actions.

**M3 — Connect + core actions.** Pairing screen, connect to the agent, live state on keys. Implement System + Media + Volume actions end to end.

**M4 — Wake-on-LAN + asleep state.** Detect agent offline, show the asleep layout with the big Wake PC key, send the magic packet from the tablet, reconnect automatically when the PC wakes.

**M5 — Discord, OBS, Yeelight, Modes, Focus timer.**

**M6 — Interactions & profiles.** Long-press options popover, swipe-to-adjust keys, profile menu, auto profile switching, Stream folder (sub-page with Back).

**M7 — Polish.** Agent auto-starts at Windows login (and tray icon later), reconnect logic, error toasts on keys (key briefly flashes red if an action fails), edit layout mode (drag keys, action library).

## Rules
- Windows only for the agent. Keep agent logic platform-separated so actions are easy to add.
- Validate every incoming message with zod; never run arbitrary commands sent from the network, only the known action IDs.
- Clear, boring code over clever code. Add short comments where Windows APIs are involved.
- Start with M1 now: set up the monorepo, protocol package, and the agent skeleton with mock mode.

Design is here: https://claude.ai/code/artifact/57205ff3-fc75-47a7-8fae-22bec1d271c5

Read the design's files from that link. Match how it looks, using this codebase's own components and conventions.
