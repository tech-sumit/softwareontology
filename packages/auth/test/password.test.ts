import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('s3cret', stored)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a unique salt per hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
