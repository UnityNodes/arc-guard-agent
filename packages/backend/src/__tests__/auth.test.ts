import jwt from 'jsonwebtoken';

// Set JWT_SECRET before importing anything that reads it at module level
process.env.JWT_SECRET = 'test-secret-key-for-jest';

describe('Auth. JWT token generation and verification', () => {
  const secret = process.env.JWT_SECRET!;

  it('generates a valid JWT with userId and walletAddress', () => {
    const payload = { userId: 'user-123', walletAddress: '0xabc' };
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies a token and returns correct payload', () => {
    const payload = { userId: 'user-456', walletAddress: '0xdef' };
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    const decoded = jwt.verify(token, secret) as { userId: string; walletAddress: string };
    expect(decoded.userId).toBe('user-456');
    expect(decoded.walletAddress).toBe('0xdef');
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 'user-789' }, 'wrong-secret', { expiresIn: '7d' });

    expect(() => jwt.verify(token, secret)).toThrow();
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ userId: 'user-expired' }, secret, { expiresIn: '-1s' });

    expect(() => jwt.verify(token, secret)).toThrow(jwt.TokenExpiredError);
  });

  it('rejects a malformed token', () => {
    expect(() => jwt.verify('not.a.token', secret)).toThrow(jwt.JsonWebTokenError);
  });
});

describe('Auth. Nonce generation', () => {
  it('generates a hex nonce of expected length', () => {
    const crypto = require('crypto');
    const nonce = crypto.randomBytes(16).toString('hex');

    expect(nonce).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(/^[a-f0-9]+$/.test(nonce)).toBe(true);
  });

  it('generates unique nonces', () => {
    const crypto = require('crypto');
    const nonces = new Set(Array.from({ length: 100 }, () => crypto.randomBytes(16).toString('hex')));
    expect(nonces.size).toBe(100);
  });
});
