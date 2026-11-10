import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { writeJsonFile } from '../json-file';

const DeviceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

const FileSchema = z.object({ devices: z.array(DeviceRecordSchema) });

/**
 * Tokens are 32 random bytes, so a plain SHA-256 is enough to store them safely.
 * (Slow hashes like bcrypt are for guessable human passwords, not random secrets.)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Paired devices, persisted to a JSON file. Raw tokens are never stored. */
export class DeviceStore {
  private devices: DeviceRecord[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  list(): readonly DeviceRecord[] {
    return this.devices;
  }

  /** Registers a new device and returns its token. This is the only time the raw token exists. */
  add(name: string): { device: DeviceRecord; token: string } {
    const token = randomBytes(32).toString('base64url');
    const device: DeviceRecord = {
      id: randomUUID(),
      name,
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    this.devices.push(device);
    this.save();
    return { device, token };
  }

  findByToken(token: string): DeviceRecord | undefined {
    const candidate = Buffer.from(hashToken(token), 'hex');
    // timingSafeEqual compares in constant time, so response timing leaks nothing about stored hashes.
    return this.devices.find((d) => {
      const stored = Buffer.from(d.tokenHash, 'hex');
      return stored.length === candidate.length && timingSafeEqual(stored, candidate);
    });
  }

  touch(id: string): void {
    const device = this.devices.find((d) => d.id === id);
    if (!device) return;
    device.lastSeenAt = new Date().toISOString();
    this.save();
  }

  remove(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    const parsed = FileSchema.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    this.devices = parsed.devices;
  }

  private save(): void {
    writeJsonFile(this.filePath, { devices: this.devices });
  }
}
