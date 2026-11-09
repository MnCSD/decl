import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT } from '@deck/protocol';

export const AGENT_VERSION = '0.1.0';

export interface AgentConfig {
  mock: boolean;
  host: string;
  port: number;
  dataDir: string;
  logLevel: string;
}

/** %APPDATA%\DeskDeck on Windows (e.g. C:\Users\you\AppData\Roaming\DeskDeck). */
export function defaultDataDir(): string {
  const base = process.env.APPDATA ?? path.join(os.homedir(), '.config');
  return path.join(base, 'DeskDeck');
}

export function loadConfig(argv: string[]): AgentConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      mock: { type: 'boolean', default: false },
      host: { type: 'string', default: '0.0.0.0' },
      port: { type: 'string', default: String(DEFAULT_PORT) },
      'data-dir': { type: 'string' },
      'log-level': { type: 'string', default: 'info' },
    },
  });

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${values.port}"`);
  }

  return {
    mock: values.mock ?? false,
    host: values.host ?? '0.0.0.0',
    port,
    dataDir: values['data-dir'] ?? defaultDataDir(),
    logLevel: values['log-level'] ?? 'info',
  };
}
