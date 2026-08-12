import bcrypt from 'bcryptjs';

// Kept separate from auth.ts so scripts (seed, admin CLI) can hash a password
// without pulling in `server-only` and the Next request context.

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Constant-ish work factor for the "user not found" path, so a wrong email
 *  and a wrong password take about the same time to answer. */
export const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
