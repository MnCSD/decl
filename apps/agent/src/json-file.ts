import fs from 'node:fs';
import path from 'node:path';

/** Writes JSON to a temp file then renames it, so a crash mid-write can't corrupt the file. */
export function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameWithRetry(tmp, filePath);
}

/**
 * On Windows, antivirus or the search indexer can briefly lock a file right after
 * it's written, making rename fail with EPERM/EBUSY. Waiting a moment and retrying fixes it.
 */
function renameWithRetry(from: string, to: string, attempts = 10): void {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * i); // synchronous sleep
    }
  }
}
