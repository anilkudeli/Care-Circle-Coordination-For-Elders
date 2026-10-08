import { createHash, randomBytes } from 'node:crypto';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function createPasswordResetToken(now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now + PASSWORD_RESET_TTL_MS),
  };
}

export function hashPasswordResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
