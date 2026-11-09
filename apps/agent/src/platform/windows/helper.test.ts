import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WindowsHelper, type HelperCall } from './helper';

// Starts the real helper process (PowerShell + C#), so it only runs on Windows.
// Only read-only commands are used here: nothing changes on the PC.
describe.runIf(process.platform === 'win32')('WindowsHelper (real PowerShell)', () => {
  const helper = new WindowsHelper(pino({ level: 'silent' }));

  beforeAll(() => helper.start(), 60_000);
  afterAll(() => helper.stop());

  it('answers "status" with volume and media in the expected shape', async () => {
    const data = (await helper.call({ cmd: 'status' })) as { volume: unknown; media: unknown };
    expect(data).toHaveProperty('volume');
    expect(data).toHaveProperty('media');
    if (data.volume !== null) {
      expect(data.volume).toMatchObject({ level: expect.any(Number), muted: expect.any(Boolean) });
    }
  });

  it('rejects commands it does not know', async () => {
    const bogus = { cmd: 'format.c' } as unknown as HelperCall;
    await expect(helper.call(bogus)).rejects.toThrow(/Unknown helper command/);
  });

  it('handles several calls at once, matching replies to requests', async () => {
    const results = await Promise.all([1, 2, 3].map(() => helper.call({ cmd: 'paths.pictures' })));
    for (const r of results) expect(typeof r).toBe('string');
  });
});
