import { PrismaClient, type CancelPolicyType, type Role } from '@prisma/client';
import { classCancelDeadline } from '@/lib/domain/cancellation';
import { localToUtc, toLocalDate } from '@/lib/time';
import type { SessionUser } from '@/lib/auth';

export const prisma = new PrismaClient();

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

/**
 * Wipe everything between tests. These run serially against one database, so a
 * clean slate per test is cheaper to reason about than shared fixtures.
 */
export async function resetDb(): Promise<void> {
  await prisma.membershipOverride.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.liftResult.deleteMany();
  await prisma.result.deleteMany();
  await prisma.scheduledWodClass.deleteMany();
  await prisma.scheduledWod.deleteMany();
  await prisma.wodScalingOption.deleteMany();
  await prisma.wodDefinition.deleteMany();
  await prisma.movement.deleteMany();
  await prisma.strikeEvent.deleteMany();
  await prisma.suspensionOverride.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.classInstance.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Booking is gated on membership, so test users are paid-up by default —
 * otherwise every booking test would be testing the membership gate rather
 * than the thing it means to. Pass `paying: false` to get someone without one.
 */
export async function createUser(
  role: Role = 'MEMBER',
  name = `User ${unique()}`,
  options: { paying?: boolean } = {},
): Promise<SessionUser> {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${unique()}@test.local`,
      name,
      role,
      passwordHash: 'not-used-in-these-tests',
      ...(options.paying === false
        ? {}
        : {
            membership: {
              create: {
                status: 'ACTIVE',
                currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
              },
            },
          }),
    },
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export interface ClassOptions {
  /** Local date, defaults to a fixed future day. */
  date?: string;
  startTimeLocal?: string;
  capacity?: number;
  policy?: CancelPolicyType;
  absoluteTimeLocal?: string;
  relativeHours?: number;
  coachId?: string | null;
}

export async function createClass(options: ClassOptions = {}) {
  const date = options.date ?? toLocalDate(new Date(Date.now() + 3 * 86_400_000));
  const startTimeLocal = options.startTimeLocal ?? '17:30';
  const startsAt = localToUtc(date, startTimeLocal);
  const policy = options.policy ?? 'RELATIVE';

  return prisma.classInstance.create({
    data: {
      name: `${startTimeLocal} WOD`,
      date,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: options.capacity ?? 2,
      coachId: options.coachId ?? null,
      cancelPolicyType: policy,
      cancelAbsoluteTimeLocal: policy === 'ABSOLUTE' ? options.absoluteTimeLocal ?? '21:00' : null,
      cancelRelativeHours: policy === 'RELATIVE' ? options.relativeHours ?? 2 : null,
      cancelDeadlineAt: classCancelDeadline(date, startsAt, {
        type: policy,
        absoluteTimeLocal: options.absoluteTimeLocal ?? '21:00',
        relativeHours: options.relativeHours ?? 2,
      }),
    },
  });
}

/** Bookings ordered the way the waitlist is: oldest first. */
export async function waitlistOrder(classInstanceId: string): Promise<string[]> {
  const bookings = await prisma.booking.findMany({
    where: { classInstanceId, status: 'WAITLISTED' },
    orderBy: [{ waitlistedAt: 'asc' }, { id: 'asc' }],
  });
  return bookings.map((b) => b.memberId);
}

export async function bookedMemberIds(classInstanceId: string): Promise<string[]> {
  const bookings = await prisma.booking.findMany({
    where: { classInstanceId, status: 'BOOKED' },
    orderBy: { bookedAt: 'asc' },
  });
  return bookings.map((b) => b.memberId);
}
