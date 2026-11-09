import { randomInt, timingSafeEqual } from 'node:crypto';

export type PairAttempt = { result: 'ok' } | { result: 'wrong' } | { result: 'locked'; retryAfterSec: number };

export interface PairingOptions {
  /** How long a code stays valid. */
  ttlMs?: number;
  /** Wrong guesses allowed before pairing is locked. */
  maxFailures?: number;
  /** How long pairing stays locked after too many wrong guesses. */
  lockoutMs?: number;
  /** Called whenever a new code is generated (to show it in the console). */
  onNewCode: (code: string, expiresAt: Date) => void;
  now?: () => number;
}

/**
 * Holds the current 6-digit pairing code.
 * A code is single-use, expires after a few minutes, and pairing locks for a
 * minute after 5 wrong guesses so the code can't be brute-forced.
 */
export class PairingManager {
  private code = '';
  private expiresAt = 0;
  private failures = 0;
  private lockedUntil = 0;
  private readonly ttlMs: number;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: PairingOptions) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxFailures = opts.maxFailures ?? 5;
    this.lockoutMs = opts.lockoutMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Makes sure a valid code exists; call it periodically to rotate expired codes. */
  tick(): void {
    if (this.now() >= this.expiresAt) this.rotate();
  }

  currentCode(): string {
    this.tick();
    return this.code;
  }

  attempt(code: string): PairAttempt {
    const now = this.now();
    if (now < this.lockedUntil) {
      return { result: 'locked', retryAfterSec: Math.ceil((this.lockedUntil - now) / 1000) };
    }
    this.tick();

    const ok = code.length === this.code.length && timingSafeEqual(Buffer.from(code), Buffer.from(this.code));
    if (ok) {
      this.failures = 0;
      this.rotate(); // single use
      return { result: 'ok' };
    }

    this.failures += 1;
    if (this.failures >= this.maxFailures) {
      this.failures = 0;
      this.lockedUntil = now + this.lockoutMs;
      this.rotate();
    }
    return { result: 'wrong' };
  }

  private rotate(): void {
    this.code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.expiresAt = this.now() + this.ttlMs;
    this.opts.onNewCode(this.code, new Date(this.expiresAt));
  }
}
