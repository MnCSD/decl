/// <reference types="node" />
// (Node types only for this test; the protocol itself must stay Node-free for the tablet app.)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLayout } from './layout';

const page = (keys: unknown[]) => ({
  version: 1,
  profiles: [{ id: 'p', name: 'P', icon: 'gamepad', pages: [{ id: 'main', name: 'Main', keys }] }],
});

describe('parseLayout', () => {
  it('accepts the app default layout', () => {
    const file = path.resolve(__dirname, '../../../apps/deck/src/config/default-layout.json');
    const result = parseLayout(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!result.ok) throw new Error(result.error);
    expect(result.layout.profiles[0]?.pages[0]?.keys).toHaveLength(32);
  });

  it('defaults needsPc to true', () => {
    const r = parseLayout(page([{ id: 'a', type: 'button', category: 'system', label: 'Lock', icon: 'lock' }]));
    expect(r.ok && r.layout.profiles[0]?.pages[0]?.keys[0]?.needsPc).toBe(true);
  });

  it('rejects unknown action ids', () => {
    const r = parseLayout(
      page([{ id: 'a', type: 'button', category: 'system', label: 'X', icon: 'lock', actionId: 'shell.exec' }]),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects params that do not match the action', () => {
    const r = parseLayout(
      page([{ id: 'a', type: 'button', category: 'stream', label: 'S', icon: 'scene', actionId: 'obs.setScene' }]),
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('obs.setScene');
  });

  it('rejects more than 32 keys on a page', () => {
    expect(parseLayout(page(Array.from({ length: 33 }, () => null))).ok).toBe(false);
  });
});
