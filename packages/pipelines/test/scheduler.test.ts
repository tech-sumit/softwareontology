import { describe, it, expect } from 'vitest';
import { isDue } from '../src/scheduler.js';

describe('isDue', () => {
  const now = new Date('2026-05-30T12:00:30Z');
  it('is due when never run', () => { expect(isDue('* * * * *', null, now)).toBe(true); });
  it('is due when last run was before this minute', () => { expect(isDue('* * * * *', new Date('2026-05-30T11:59:00Z'), now)).toBe(true); });
  it('is not due when already run this minute', () => { expect(isDue('* * * * *', new Date('2026-05-30T12:00:05Z'), now)).toBe(false); });
  it('every-5-min: not due at 12:02 when last ran 12:00', () => { expect(isDue('*/5 * * * *', new Date('2026-05-30T12:00:10Z'), new Date('2026-05-30T12:02:00Z'))).toBe(false); });
  it('every-5-min: due at 12:05 when last ran 12:00', () => { expect(isDue('*/5 * * * *', new Date('2026-05-30T12:00:10Z'), new Date('2026-05-30T12:05:30Z'))).toBe(true); });
});
