import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { parseActionRequest } from '@deck/protocol';
import { expandEnv, loadAppsConfig } from './apps-config';

const log = pino({ level: 'silent' });

function withTempFile(content: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-apps-'));
  const file = path.join(dir, 'apps.json');
  if (content !== undefined) fs.writeFileSync(file, JSON.stringify(content));
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('apps config', () => {
  it('expands %VAR% environment variables', () => {
    process.env.DECK_TEST_DIR = 'C:\\Test';
    expect(expandEnv('%DECK_TEST_DIR%\\app.exe')).toBe('C:\\Test\\app.exe');
    expect(expandEnv('%NOT_A_REAL_VAR_123%\\x')).toBe('%NOT_A_REAL_VAR_123%\\x');
  });

  it('applies defaults and lowercases the process name', () => {
    const { file, cleanup } = withTempFile({ apps: [{ id: 'notepad', name: 'Notepad', path: 'C:\\Windows\\notepad.exe' }] });
    const [app] = loadAppsConfig(file, log);
    expect(app).toMatchObject({ id: 'notepad', args: [], process: 'notepad.exe', whenRunning: 'focus' });
    cleanup();
  });

  it('returns no apps (instead of crashing) when the file is invalid', () => {
    const { file, cleanup } = withTempFile({ apps: [{ id: 'Bad Id!', name: 'x', path: 'x' }] });
    expect(loadAppsConfig(file, log)).toEqual([]);
    cleanup();
  });

  it('creates the file from installed apps on first run', () => {
    const { file, cleanup } = withTempFile(undefined);
    loadAppsConfig(file, log);
    expect(fs.existsSync(file)).toBe(true);
    cleanup();
  });

  it('never accepts a path as an app id over the network', () => {
    expect(parseActionRequest('app.launch', { app: 'C:\\Windows\\System32\\cmd.exe' }).ok).toBe(false);
    expect(parseActionRequest('app.launch', { app: 'discord', args: ['/c'] }).ok).toBe(false);
    expect(parseActionRequest('app.launch', { app: 'discord' }).ok).toBe(true);
  });
});
