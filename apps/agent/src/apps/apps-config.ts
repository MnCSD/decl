import fs from 'node:fs';
import path from 'node:path';
import { AppIdSchema } from '@deck/protocol';
import { z } from 'zod';
import type { Logger } from '../logger';

/**
 * The app allow-list: %APPDATA%\DeskDeck\apps.json.
 * Keys on the tablet refer to apps by id only; paths and arguments live here,
 * on the PC, and are never sent over the network.
 *
 * Paths may use environment variables like %LOCALAPPDATA%.
 */
const AppEntrySchema = z
  .object({
    id: AppIdSchema,
    name: z.string().min(1).max(24),
    /** Program to start. */
    path: z.string().min(1),
    args: z.array(z.string()).default([]),
    /** File to take the icon from, if different from `path` (exe, ico or lnk). */
    icon: z.string().optional(),
    /** Process name used to detect "running" (default: the file name of `path`). */
    process: z
      .string()
      .regex(/^[\w .()-]+\.exe$/i)
      .optional(),
    /** Set false for apps that are always running (e.g. Explorer). */
    trackRunning: z.boolean().default(true),
    /**
     * What a tap does when the app is already running:
     *  focus      = bring its window to front, or start it again if that fails (most apps handle that)
     *  focus-only = bring to front, never start a second copy (e.g. OBS complains about that)
     *  launch     = always start a new one (e.g. a new Explorer window)
     */
    whenRunning: z.enum(['focus', 'focus-only', 'launch']).default('focus'),
  })
  .strict();

const AppsFileSchema = z.object({ apps: z.array(AppEntrySchema) });

type AppEntryInput = z.input<typeof AppEntrySchema>;

export interface AppEntry {
  id: string;
  name: string;
  path: string;
  args: string[];
  iconPath: string;
  /** lowercase process name, or null when not tracked */
  process: string | null;
  whenRunning: 'focus' | 'focus-only' | 'launch';
}

/** Common apps, added to apps.json on first run if they are installed. */
const KNOWN_APPS: AppEntryInput[] = [
  { id: 'explorer', name: 'Explorer', path: '%WINDIR%\\explorer.exe', trackRunning: false, whenRunning: 'launch' },
  {
    id: 'discord',
    name: 'Discord',
    // Discord's Update.exe starts (or shows) the current Discord version.
    path: '%LOCALAPPDATA%\\Discord\\Update.exe',
    args: ['--processStart', 'Discord.exe'],
    icon: '%LOCALAPPDATA%\\Discord\\app.ico',
    process: 'Discord.exe',
  },
  { id: 'spotify', name: 'Spotify', path: '%APPDATA%\\Spotify\\Spotify.exe' },
  { id: 'obs', name: 'OBS', path: '%ProgramFiles%\\obs-studio\\bin\\64bit\\obs64.exe', whenRunning: 'focus-only' },
  {
    id: 'league',
    name: 'League',
    path: 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
    args: ['--launch-product=league_of_legends', '--launch-patchline=live'],
    icon: 'C:\\Riot Games\\League of Legends\\LeagueClient.exe',
    process: 'LeagueClient.exe',
  },
  { id: 'steam', name: 'Steam', path: '%ProgramFiles(x86)%\\Steam\\steam.exe' },
  { id: 'chrome', name: 'Chrome', path: '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe' },
  { id: 'edge', name: 'Edge', path: '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe' },
  { id: 'vscode', name: 'VS Code', path: '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe' },
];

/** Replaces %VAR% with environment variable values (left as-is if unknown). */
export function expandEnv(p: string): string {
  return p.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match);
}

export function loadAppsConfig(filePath: string, log: Logger): AppEntry[] {
  if (!fs.existsSync(filePath)) {
    const found = KNOWN_APPS.filter((a) => fs.existsSync(expandEnv(a.path)));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ apps: found }, null, 2));
    log.info({ file: filePath, apps: found.map((a) => a.id) }, 'Created apps.json from installed apps (edit it to add more)');
  }

  let parsed: z.infer<typeof AppsFileSchema>;
  try {
    parsed = AppsFileSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    log.error({ err, file: filePath }, 'apps.json is invalid; no apps available until it is fixed');
    return [];
  }

  const seen = new Set<string>();
  const apps: AppEntry[] = [];
  for (const a of parsed.apps) {
    if (seen.has(a.id)) {
      log.warn({ id: a.id }, 'apps.json: duplicate id ignored');
      continue;
    }
    seen.add(a.id);
    const exe = expandEnv(a.path);
    if (!fs.existsSync(exe)) log.warn({ id: a.id, path: exe }, 'apps.json: program not found (key will fail until fixed)');
    const icon = a.icon ? expandEnv(a.icon) : null;
    apps.push({
      id: a.id,
      name: a.name,
      path: exe,
      args: a.args,
      iconPath: icon && fs.existsSync(icon) ? icon : exe,
      process: a.trackRunning ? (a.process ?? path.win32.basename(exe)).toLowerCase() : null,
      whenRunning: a.whenRunning,
    });
  }
  return apps;
}
