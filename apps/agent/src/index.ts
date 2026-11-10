import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '@deck/protocol';
import { loadAppsConfig } from './apps/apps-config';
import { AGENT_VERSION, loadConfig } from './config';
import { createLogger } from './logger';
import { MockPlatform } from './platform/mock/mock-platform';
import type { Platform } from './platform/types';
import { WindowsPlatform } from './platform/windows/windows-platform';
import { DeviceStore } from './security/device-store';
import { PairingManager } from './security/pairing';
import { DeckServer } from './server';
import { loadRingtone } from './sounds';
import { StateStore } from './state-store';

/** IPv4 addresses of this PC's network adapters, to show where the tablet should connect. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

function printPairingBanner(code: string, expiresAt: Date): void {
  // Printed directly (not through the logger) so the code never ends up in log files.
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}`;
  console.log(`\n  ┌──────────────────────────────┐`);
  console.log(`  │  Pairing code:  ${code.slice(0, 3)} ${code.slice(3)}      │`);
  console.log(`  │  valid until ${time}           │`);
  console.log(`  └──────────────────────────────┘\n`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));
  const log = createLogger(config.logLevel);

  if (process.platform !== 'win32' && !config.mock) {
    log.error('The real agent only runs on Windows. Use --mock on other systems.');
    process.exit(1);
  }

  const devices = new DeviceStore(path.join(config.dataDir, 'devices.json'));
  const pairing = new PairingManager({ onNewCode: printPairingBanner });
  const store = new StateStore(
    createInitialState({ version: AGENT_VERSION, mock: config.mock, hostname: os.hostname() }),
  );
  const apps = loadAppsConfig(path.join(config.dataDir, 'apps.json'), log);
  const platform: Platform = config.mock ? new MockPlatform(log, apps) : new WindowsPlatform(log, apps, config.dataDir);

  log.info({ platform: platform.name, dataDir: config.dataDir, pairedDevices: devices.list().length }, 'Starting Desk Deck agent');

  // Claim the port first, so a second copy fails fast instead of starting pollers.
  const ringtone = loadRingtone(config.dataDir, log);
  const server = new DeckServer({ host: config.host, port: config.port, store, devices, pairing, platform, log, ringtone });
  try {
    await server.start();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`✖ Port ${config.port} is already in use. Is another Desk Deck agent running?`);
      process.exit(1);
    }
    throw err;
  }
  await platform.start(store);

  for (const ip of lanAddresses()) log.info(`Listening on ws://${ip}:${server.port}`);
  pairing.tick(); // shows the first code
  const pairingTimer = setInterval(() => pairing.tick(), 5000); // rotates expired codes

  const shutdown = async () => {
    log.info('Shutting down');
    clearInterval(pairingTimer);
    platform.stop();
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
