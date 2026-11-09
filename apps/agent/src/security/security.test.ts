import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeviceStore, hashToken } from './device-store';
import { isPrivateAddress } from './net';
import { PairingManager } from './pairing';

describe('isPrivateAddress', () => {
  it.each([
    ['192.168.2.20', true],
    ['::ffff:192.168.2.20', true],
    ['10.0.0.5', true],
    ['172.20.1.1', true],
    ['127.0.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
    ['::ffff:8.8.8.8', false],
    ['2001:4860::8888', false],
    [undefined, false],
  ])('%s -> %s', (addr, expected) => {
    expect(isPrivateAddress(addr)).toBe(expected);
  });
});

describe('PairingManager', () => {
  function setup() {
    let now = 1_000_000;
    const codes: string[] = [];
    const pm = new PairingManager({ onNewCode: (c) => codes.push(c), now: () => now });
    return { pm, codes, advance: (ms: number) => (now += ms) };
  }

  it('accepts the current code once', () => {
    const { pm } = setup();
    const code = pm.currentCode();
    expect(pm.attempt(code).result).toBe('ok');
    expect(pm.attempt(code).result).toBe('wrong'); // single use
  });

  it('rotates the code after it expires', () => {
    const { pm, codes, advance } = setup();
    pm.currentCode();
    expect(codes).toHaveLength(1);
    advance(5 * 60_000 + 1);
    pm.tick();
    expect(codes).toHaveLength(2);
    expect(pm.currentCode()).toBe(codes[1]);
  });

  it('locks after 5 wrong guesses', () => {
    const { pm, advance } = setup();
    const wrong = pm.currentCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) pm.attempt(wrong);
    const locked = pm.attempt(pm.currentCode());
    expect(locked.result).toBe('locked');
    advance(61_000);
    expect(pm.attempt(pm.currentCode()).result).toBe('ok');
  });
});

describe('DeviceStore', () => {
  it('stores only token hashes and finds devices by token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-test-'));
    const file = path.join(dir, 'devices.json');
    const store = new DeviceStore(file);
    const { device, token } = store.add('Tablet');

    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(token);
    expect(onDisk).toContain(hashToken(token));

    const reloaded = new DeviceStore(file);
    expect(reloaded.findByToken(token)?.id).toBe(device.id);
    expect(reloaded.findByToken('x'.repeat(43))).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
