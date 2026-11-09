import type { Logger } from '../logger';
import { extractIcons } from '../platform/windows/icons';
import type { AppEntry } from './apps-config';

/**
 * Extracts icons for all allow-listed apps once. Used by both the real and the
 * mock platform (reading icons is harmless, and makes mock mode look real).
 * Never throws: apps without an icon just fall back to a placeholder on the tablet.
 */
export async function loadAppIcons(apps: AppEntry[], log: Logger): Promise<Record<string, string>> {
  if (process.platform !== 'win32' || apps.length === 0) return {};
  const started = Date.now();
  try {
    const icons = await extractIcons(apps.map((a) => ({ id: a.id, path: a.iconPath })));
    log.info({ count: Object.keys(icons).length, ms: Date.now() - started }, 'Extracted app icons');
    return icons;
  } catch (err) {
    log.warn({ err }, 'Could not extract app icons');
    return {};
  }
}
