# Desk Deck

A Stream Deck–style controller: an Android tablet on the desk shows a grid of glowing keycaps
and controls a Windows PC (system, media, volume, apps, later Discord, OBS, Yeelight and Wake-on-LAN).

- **What we set out to build:** [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) (original prompt)
- **What's done, decisions, gotchas, next steps:** [docs/PROGRESS.md](docs/PROGRESS.md)

## Status

M1 ✅ agent + protocol · M2 ✅ tablet UI (+ real app icons) · **M3 next:** tablet ↔ agent connection and real System/Media/Volume actions.

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
Until M3 the app shows sample data; taps only change that preview locally.

## Checks

```sh
npm run typecheck
npm test
```
