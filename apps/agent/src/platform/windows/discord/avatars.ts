import type { Logger } from '../../../logger';

const MAX_BYTES = 256 * 1024; // a 64 px avatar is a few KB; anything bigger is wrong

/**
 * Downloads Discord avatars and keeps them as data: URLs, so the tablet never
 * has to reach the internet. Each avatar is fetched once per (user, avatar) pair.
 */
export class AvatarCache {
  private cache = new Map<string, string | null>();
  private loading = new Set<string>();

  constructor(
    private readonly log: Logger,
    /** Called when a download finishes, so the state can be re-sent with the image. */
    private readonly onLoaded: () => void,
    private readonly enabled = true,
  ) {}

  /** The data URL if we have it; otherwise starts a download and returns null for now. */
  get(userId: string, avatarHash: string | null): string | null {
    const url = avatarUrl(userId, avatarHash);
    if (!url || !this.enabled) return null;
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (!this.loading.has(url)) {
      this.loading.add(url);
      void this.download(url);
    }
    return null;
  }

  private async download(url: string): Promise<void> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('too big');
      this.cache.set(url, `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`);
    } catch (err) {
      this.log.debug({ err: (err as Error).message }, 'Avatar download failed');
      this.cache.set(url, null); // don't retry every second; initials are shown instead
    } finally {
      this.loading.delete(url);
      this.onLoaded();
    }
  }
}

/**
 * Discord CDN address for a user's avatar. Users without one get one of Discord's
 * default avatars, picked from their user id. The id and hash are checked first,
 * since they end up in a URL.
 */
export function avatarUrl(userId: string, avatarHash: string | null): string | null {
  if (!/^\d{5,25}$/.test(userId)) return null;
  if (avatarHash && /^(a_)?[0-9a-f]{32}$/.test(avatarHash)) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
  }
  // Default avatars: (id >> 22) % 6 for accounts with the new usernames.
  const index = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
