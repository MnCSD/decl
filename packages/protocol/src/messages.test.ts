import { describe, expect, it } from 'vitest';
import { parseActionRequest, parseClientMessage } from './index';

describe('parseClientMessage', () => {
  it('accepts a valid runAction', () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: 'runAction', id: 'a1', actionId: 'system.lock' }));
    expect(r.ok).toBe(true);
  });

  it('rejects unknown action ids', () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: 'runAction', id: 'a1', actionId: 'shell.exec' }));
    expect(r.ok).toBe(false);
  });

  it('rejects wrong protocol versions with a clear error', () => {
    const r = parseClientMessage(JSON.stringify({ v: 99, type: 'ping' }));
    expect(r).toEqual({ ok: false, error: 'Unsupported protocol version 99 (expected 1)' });
  });

  it('rejects non-JSON', () => {
    expect(parseClientMessage('not json').ok).toBe(false);
  });

  it('rejects out-of-range adjust values', () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: 'adjust', id: 'x', actionId: 'volume.level', value: 150 }));
    expect(r.ok).toBe(false);
  });

  it('rejects malformed pairing codes', () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: 'pair', code: '12ab56', deviceName: 'Tab' }));
    expect(r.ok).toBe(false);
  });
});

describe('parseActionRequest', () => {
  it('validates per-action params', () => {
    expect(parseActionRequest('obs.setScene', { scene: 'Game' }).ok).toBe(true);
    expect(parseActionRequest('obs.setScene', {}).ok).toBe(false);
    expect(parseActionRequest('light.setColor', { rgb: 'purple' }).ok).toBe(false);
  });

  it('rejects unexpected params on parameterless actions', () => {
    expect(parseActionRequest('system.lock', { command: 'format c:' }).ok).toBe(false);
  });
});
