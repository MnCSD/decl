# Desk Deck — notes for AI agents

Read these first:
1. [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md): the original prompt (requirements, design spec, milestones, rules).
2. [docs/PROGRESS.md](docs/PROGRESS.md): what's done, decisions + reasons, design deviations, gotchas, next milestone plan.
3. `apps/deck/AGENTS.md`: Expo-specific guidance (fetch versioned Expo docs; use `npx expo install`).

## Working agreement with the user
- Work milestone by milestone. After each one: stop, explain exactly how to run and verify it, and wait for the go-ahead.
- Ask before big architectural decisions not covered by the brief.
- The user is learning: briefly explain anything non-obvious when introducing it.
- Update `docs/PROGRESS.md` when a milestone finishes or a decision is made.

## Rules
- Agent is Windows-only; keep logic platform-separated (`apps/agent/src/platform/{windows,mock}`).
- Validate every incoming message with zod. Never run commands from the network: only known action ids, and app ids from `apps.json` (never paths).
- Never log tokens. LAN only.
- Clear, boring code. Short comments where Windows APIs are involved.
- Until M4 the tablet app must stay Expo Go–compatible (no extra native modules).

## Commands
- `npm run typecheck` and `npm test` before calling anything done.
- `npm run agent:mock`, `npm run client -- …`, `npm run deck` (see README).
- Shell is Windows PowerShell 5.1: it strips inner double quotes when calling programs (escape JSON as `'{\"k\":\"v\"}'`), and for some programs (e.g. `claude mcp add`) a bare `--` (quote it: `'--'`). `npm run x -- args` works as is.
- Background `npm run` processes may leave a `node` child alive; stop by port.
- UI checks: run `npm run deck -- --web` and use the Playwright MCP (viewport 1340×800).
