import { z } from 'zod';
import { AppIdSchema, ModeIdSchema } from './actions';

const percent = z.number().min(0).max(100);

/**
 * Everything the tablet needs to draw live keys.
 * The agent sends the whole object (a "snapshot") on connect and on every change.
 * `null` means "not available" (e.g. no NVIDIA GPU, OBS not running).
 */
export const DeckStateSchema = z.object({
  agent: z.object({
    version: z.string(),
    mock: z.boolean(),
    hostname: z.string(),
  }),
  system: z.object({
    uptimeSec: z.number().nonnegative(),
    cpuPercent: percent.nullable(),
    cpuTempC: z.number().nullable(),
    gpuTempC: z.number().nullable(),
  }),
  volume: z
    .object({
      level: percent,
      muted: z.boolean(),
    })
    .nullable(),
  media: z
    .object({
      playing: z.boolean(),
      title: z.string(),
      artist: z.string(),
      /** data: URL or null when there is no album art */
      artUrl: z.string().nullable(),
    })
    .nullable(),
  voice: z.object({
    micMuted: z.boolean(),
    deafened: z.boolean(),
  }),
  obs: z.object({
    connected: z.boolean(),
    scene: z.string().nullable(),
    scenes: z.array(z.string()),
    recording: z.boolean(),
    /** Seconds since recording started (agent clock), 0 when not recording */
    recordingSec: z.number().nonnegative(),
    streaming: z.boolean(),
  }),
  light: z.object({
    reachable: z.boolean(),
    on: z.boolean(),
    brightness: percent,
    rgb: z.string(),
  }),
  modes: z.object({
    dnd: z.boolean(),
    active: ModeIdSchema.nullable(),
  }),
  /** Apps from the agent's allow-list (icons arrive separately in an `appIcons` message). */
  apps: z.array(
    z.object({
      id: AppIdSchema,
      name: z.string(),
      running: z.boolean(),
    }),
  ),
  profile: z.object({
    id: z.string(),
    /** true when the agent picked it from running processes */
    auto: z.boolean(),
    /** short reason shown under the profile name, e.g. "LEAGUE OPEN" */
    reason: z.string().nullable(),
  }),
});

export type DeckState = z.infer<typeof DeckStateSchema>;

export function createInitialState(agent: DeckState['agent']): DeckState {
  return {
    agent,
    system: { uptimeSec: 0, cpuPercent: null, cpuTempC: null, gpuTempC: null },
    volume: null,
    media: null,
    voice: { micMuted: false, deafened: false },
    obs: { connected: false, scene: null, scenes: [], recording: false, recordingSec: 0, streaming: false },
    light: { reachable: false, on: false, brightness: 0, rgb: '#FFFFFF' },
    modes: { dnd: false, active: null },
    apps: [],
    profile: { id: 'main', auto: false, reason: null },
  };
}
