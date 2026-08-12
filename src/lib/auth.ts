import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { prisma } from '@/lib/db';
import { DUMMY_HASH, hashPassword, verifyPassword } from '@/lib/password';

export { hashPassword, verifyPassword };

export type Role = 'OWNER' | 'COACH' | 'MEMBER';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const COOKIE = 'gym_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // members should not have to log in weekly

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * The signed-in user, or null.
 *
 * The role is read from the database on every request rather than trusted from
 * the token, so revoking a coach's access takes effect immediately instead of
 * whenever their month-old session happens to expire.
 *
 * `cache` dedupes this within a single render pass.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user || !user.active) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

export async function authenticate(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  // Verify against a throwaway hash when the user is missing, so a wrong email
  // and a wrong password take about the same time to answer.
  if (!user || !user.active) {
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
