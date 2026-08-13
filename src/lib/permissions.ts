import type { Role, SessionUser } from '@/lib/auth';
import { forbidden } from '@/lib/errors';

/**
 * Roles are hierarchical rather than exclusive: an owner can do anything a
 * coach can, and a coach books classes and logs scores exactly like a member.
 */
export const ROLE_RANK: Record<Role, number> = {
  MEMBER: 1,
  COACH: 2,
  OWNER: 3,
};

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Every capability in the app, resolved from a role in one place.
 *
 * The UI hides what a member cannot do, but hiding is not enforcement — every
 * mutation re-checks these server-side before touching the database.
 */
export const CAPABILITIES = {
  viewRoster: 'COACH',
  markAttendance: 'COACH',
  cancelClass: 'COACH',
  manageTemplates: 'COACH',
  programWod: 'COACH',
  forgiveStrike: 'COACH',
  viewMemberStrikes: 'COACH',
  /** Cutting a suspension short is the owner's call alone. */
  liftSuspension: 'OWNER',
  manageUsers: 'OWNER',
} as const satisfies Record<string, Role>;

export type Capability = keyof typeof CAPABILITIES;

export function can(user: Pick<SessionUser, 'role'> | null, capability: Capability): boolean {
  if (!user) return false;
  return atLeast(user.role, CAPABILITIES[capability]);
}

/** Throws unless the user holds the capability. */
export function assertCan(
  user: Pick<SessionUser, 'role'> | null,
  capability: Capability,
): void {
  if (!can(user, capability)) {
    throw forbidden(`You do not have permission to ${humanise(capability)}.`);
  }
}

/**
 * Members may only ever act on their own records; coaches and owners may act
 * on anyone's.
 */
export function assertSelfOrStaff(
  user: Pick<SessionUser, 'id' | 'role'> | null,
  memberId: string,
): void {
  if (!user) throw forbidden();
  if (user.id === memberId) return;
  if (atLeast(user.role, 'COACH')) return;
  throw forbidden('You can only manage your own bookings.');
}

function humanise(capability: Capability): string {
  return capability.replace(/([A-Z])/g, ' $1').toLowerCase();
}
