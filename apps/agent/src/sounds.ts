import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger';

/** Audio types the tablet can play, by file extension. */
const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

const MAX_BYTES = 2 * 1024 * 1024; // a ringtone is a few hundred KB at most

/**
 * Your own ringtone for incoming Discord calls: put a file named ringtone.mp3
 * (or .wav / .ogg / .m4a) in %APPDATA%\DeskDeck\sounds\. It stays on your PC;
 * the agent only sends it to your paired tablet. Returns a data: URL, or null.
 */
export function loadRingtone(dataDir: string, log: Logger): string | null {
  const folder = path.join(dataDir, 'sounds');
  for (const [ext, type] of Object.entries(TYPES)) {
    const file = path.join(folder, `ringtone${ext}`);
    if (!fs.existsSync(file)) continue;
    const size = fs.statSync(file).size;
    if (size > MAX_BYTES) {
      log.warn({ file, size }, 'Ringtone file is too big (max 2 MB); using the built-in chime');
      return null;
    }
    log.info({ file }, 'Using custom ringtone');
    return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  }
  return null;
}
