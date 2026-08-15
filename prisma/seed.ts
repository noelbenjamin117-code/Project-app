/**
 * Development seed: one owner, 3 coaches, 40 members, four weeks of classes
 * (two behind, two ahead), 10 benchmark WODs with real results on the board,
 * and a few deliberate strike situations so every penalty state is visible in
 * the UI without having to manufacture one by hand.
 */
import { PrismaClient, type ScalingLevel, type ScoreType } from '@prisma/client';
import { DateTime } from 'luxon';
import { gymConfig } from '../gym.config';
import { hashPassword } from '../src/lib/password';
import {
  createBenchmarkWods,
  createDefaultTemplates,
  createMovements,
} from '../src/lib/bootstrap';

const prisma = new PrismaClient();
const TZ = gymConfig.timezone;

/** Deterministic PRNG so reseeding produces the same gym every time. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(20260812);

const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

function localToUtc(date: string, time: string): Date {
  return DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toUTC().toJSDate();
}
function localDate(d: DateTime): string {
  return d.toFormat('yyyy-MM-dd');
}

const FIRST_NAMES = [
  'Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Isla', 'Mason', 'Nora', 'Kai',
  'Ruby', 'Owen', 'Lena', 'Theo', 'Iris', 'Felix', 'Sana', 'Jonah', 'Elle', 'Rhys',
  'Priya', 'Milo', 'Aria', 'Dane', 'Cleo', 'Arlo', 'Sage', 'Beau', 'Wren', 'Otis',
  'Nell', 'Finn', 'Tess', 'Hugo', 'Juno', 'Levi', 'Esme', 'Cruz', 'Vera', 'Dex',
];
const LAST_NAMES = [
  'Okafor', 'Lindqvist', 'Moreau', 'Bianchi', 'Nakamura', 'Delgado', 'Haddad', 'Novak',
  'Fitzgerald', 'Kowalski', 'Mbeki', 'Sørensen', 'Rossi', 'Fernandes', 'Petrov', 'Yilmaz',
  'Brennan', 'Castillo', 'Nguyen', 'Ashford',
];

async function main() {
  console.log('Resetting…');
  // Order matters: children first, since some relations are Restrict by default.
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

  const password = await hashPassword('password123');

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------
  const owner = await prisma.user.create({
    data: { email: 'owner@ironside.gym', name: 'Dana Reyes', role: 'OWNER', passwordHash: password },
  });

  const coaches = await Promise.all(
    [
      ['coach.sam@ironside.gym', 'Sam Whitfield'],
      ['coach.tara@ironside.gym', 'Tara Osei'],
      ['coach.nik@ironside.gym', 'Nik Petrov'],
    ].map(([email, name]) =>
      prisma.user.create({ data: { email, name, role: 'COACH', passwordHash: password } }),
    ),
  );

  const members = [];
  for (let i = 0; i < 40; i++) {
    const name = `${FIRST_NAMES[i]} ${LAST_NAMES[i % LAST_NAMES.length]}`;
    members.push(
      await prisma.user.create({
        data: {
          email: `member${i + 1}@example.com`,
          name,
          role: 'MEMBER',
          passwordHash: password,
        },
      }),
    );
  }
  // Booking is gated on membership, so the demo gym needs paid-up members.
  // A couple are deliberately left lapsed or failing so those states are
  // visible without having to fake a Stripe event.
  for (const [index, member] of members.entries()) {
    const status =
      index === 3 ? 'CANCELED' : index === 4 ? 'PAST_DUE' : ('ACTIVE' as const);
    await prisma.membership.create({
      data: {
        userId: member.id,
        status,
        currentPeriodEnd: new Date(Date.now() + between(3, 28) * 86_400_000),
        pastDueSince: status === 'PAST_DUE' ? new Date(Date.now() - 86_400_000) : null,
      },
    });
  }
  for (const staff of [owner, ...coaches]) {
    await prisma.membership.create({
      data: {
        userId: staff.id,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });
  }

  console.log(`Created ${members.length} members, ${coaches.length} coaches, 1 owner.`);

  // -------------------------------------------------------------------------
  // Class templates — the gym's real timetable. Each template carries its own
  // cancellation rule.
  // -------------------------------------------------------------------------
  const today = DateTime.now().setZone(TZ).startOf('day');
  const activeFrom = localDate(today.minus({ days: 30 }));

  // Same shapes the first-run setup page creates, so the demo gym and a real
  // one start from an identical schedule.
  const templates = await createDefaultTemplates(
    prisma,
    activeFrom,
    (index) => coaches[index % coaches.length].id,
  );
  console.log(`Created ${templates.length} class templates.`);

  // -------------------------------------------------------------------------
  // Four weeks of classes: two behind (so the leaderboard has history) and two
  // ahead (so there is something to book).
  // -------------------------------------------------------------------------
  const rangeStart = today.minus({ days: 14 });
  const rangeEnd = today.plus({ days: 14 });

  const instances = [];
  for (let d = rangeStart; d <= rangeEnd; d = d.plus({ days: 1 })) {
    const date = localDate(d);
    for (const template of templates) {
      if (template.dayOfWeek !== d.weekday) continue;

      const startsAt = localToUtc(date, template.startTimeLocal);
      const endsAt = new Date(startsAt.getTime() + template.durationMinutes * 60_000);

      // Deadline is derived per date, in local time — this is what keeps a
      // 21:00 rule at 21:00 across the DST boundary.
      const cancelDeadlineAt =
        template.cancelPolicyType === 'ABSOLUTE'
          ? localToUtc(localDate(d.minus({ days: 1 })), template.cancelAbsoluteTimeLocal!)
          : template.cancelPolicyType === 'RELATIVE'
            ? new Date(startsAt.getTime() - template.cancelRelativeHours! * 3_600_000)
            : startsAt;

      instances.push(
        await prisma.classInstance.create({
          data: {
            templateId: template.id,
            name: template.name,
            notes: template.notes,
            date,
            startsAt,
            endsAt,
            capacity: template.capacity,
            coachId: template.defaultCoachId,
            cancelPolicyType: template.cancelPolicyType,
            cancelAbsoluteTimeLocal: template.cancelAbsoluteTimeLocal,
            cancelRelativeHours: template.cancelRelativeHours,
            cancelDeadlineAt,
          },
        }),
      );
    }
  }
  console.log(`Created ${instances.length} class instances.`);

  // One cancelled class in the future, so the "gym cancelled, no strike" path
  // is visible in the UI.
  const toCancel = instances.find(
    (i) => i.startsAt > new Date() && i.startsAt.getTime() > Date.now() + 2 * 86_400_000,
  );
  if (toCancel) {
    await prisma.classInstance.update({
      where: { id: toCancel.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledReason: 'Coach out sick',
        cancelledById: owner.id,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Movements & benchmark WODs
  // -------------------------------------------------------------------------
  const movements = await createMovements(prisma);
  const wodDefinitions = await createBenchmarkWods(prisma, coaches[0].id);

  // A strength day, so the lift-PR path has data too.
  const strengthWod = await prisma.wodDefinition.create({
    data: {
      name: 'Back Squat 5x3',
      isBenchmark: false,
      type: 'STRENGTH',
      scoreType: 'LOAD',
      description: 'Back Squat\n5 sets of 3, building to a heavy triple.',
      createdById: coaches[1].id,
      scalingOptions: {
        create: [
          { level: 'RX', description: 'Building to a heavy 3' },
          { level: 'SCALED', description: 'Technique focus at 60-70%' },
        ],
      },
    },
  });
  console.log(`Created ${wodDefinitions.length} benchmark WODs + 1 strength session.`);

  // -------------------------------------------------------------------------
  // Bookings across the whole range
  // -------------------------------------------------------------------------
  const now = new Date();
  let bookingCount = 0;

  for (const instance of instances) {
    if (instance.id === toCancel?.id) continue;

    const isPast = instance.startsAt < now;
    // Evenings are busier than mid-morning; 6am has a small loyal crew.
    const fillTarget = instance.name.startsWith('9:30')
      ? between(3, 8)
      : instance.name.includes('pm')
        ? between(10, instance.capacity + 3)
        : between(6, 14);

    const shuffled = members.slice().sort(() => random() - 0.5);
    const attendees = shuffled.slice(0, Math.min(fillTarget, shuffled.length));

    let booked = 0;
    for (const member of attendees) {
      const full = booked >= instance.capacity;
      const bookedAt = new Date(instance.startsAt.getTime() - between(1, 6) * 86_400_000);

      const booking = await prisma.booking.create({
        data: {
          classInstanceId: instance.id,
          memberId: member.id,
          status: full ? 'WAITLISTED' : 'BOOKED',
          bookedAt,
          waitlistedAt: full ? bookedAt : null,
          // Past classes: most people showed up.
          checkedInAt: !full && isPast && random() < 0.85 ? instance.startsAt : null,
        },
      });
      if (!full) booked++;
      bookingCount++;
      void booking;
    }
  }
  console.log(`Created ${bookingCount} bookings.`);

  // -------------------------------------------------------------------------
  // Programme the benchmarks onto past dates and log results, so the
  // leaderboard and PR history have something real in them.
  // -------------------------------------------------------------------------
  const pastDates: string[] = [];
  for (let d = rangeStart; d < today; d = d.plus({ days: 1 })) {
    if (d.weekday <= 5) pastDates.push(localDate(d));
  }

  const scalingLevels: ScalingLevel[] = ['RX_PLUS', 'RX', 'SCALED'];
  let resultCount = 0;

  for (let i = 0; i < pastDates.length; i++) {
    const date = pastDates[i];
    const definition = i % 4 === 3 ? strengthWod : wodDefinitions[i % wodDefinitions.length];

    const scheduled = await prisma.scheduledWod.create({
      data: { wodDefinitionId: definition.id, date },
    });

    const dayClasses = instances.filter((c) => c.date === date);
    const checkedIn = await prisma.booking.findMany({
      where: {
        classInstanceId: { in: dayClasses.map((c) => c.id) },
        checkedInAt: { not: null },
      },
    });

    // A member can be checked into more than one class on the same day, but
    // they only score the day's WOD once — same rule the app enforces.
    const scored = new Set<string>();

    for (const booking of checkedIn) {
      if (scored.has(booking.memberId)) continue;
      if (random() < 0.25) continue; // not everyone writes their score on the board
      scored.add(booking.memberId);

      const level = random() < 0.15 ? 'RX_PLUS' : random() < 0.6 ? 'RX' : 'SCALED';
      const score = generateScore(definition.scoreType, definition.timeCapSeconds);

      await prisma.result.create({
        data: {
          memberId: booking.memberId,
          wodDefinitionId: definition.id,
          scheduledWodId: scheduled.id,
          classInstanceId: booking.classInstanceId,
          scalingLevel: level as ScalingLevel,
          performedOn: date,
          ...score,
          ...(definition.id === strengthWod.id
            ? {
                liftResults: {
                  create: {
                    memberId: booking.memberId,
                    movementId: movements[0].id,
                    reps: 3,
                    loadKg: score.loadKg ?? 80,
                    performedOn: date,
                  },
                },
              }
            : {}),
        },
      });
      resultCount++;
    }
  }
  console.log(`Created ${resultCount} results across ${pastDates.length} programmed days.`);

  // Programme today and the week ahead as well, so the whiteboard has a WOD on
  // it the moment you open the app and members have something to log against.
  const upcomingDates: string[] = [];
  for (let d = today; d <= today.plus({ days: 7 }); d = d.plus({ days: 1 })) {
    if (d.weekday <= 5) upcomingDates.push(localDate(d));
  }

  for (let i = 0; i < upcomingDates.length; i++) {
    const definition = i % 4 === 3 ? strengthWod : wodDefinitions[(i + 3) % wodDefinitions.length];
    await prisma.scheduledWod.create({
      data: {
        wodDefinitionId: definition.id,
        date: upcomingDates[i],
        notes: i === 0 ? 'Scale to keep it under 10 minutes.' : null,
      },
    });
  }

  // Give today's WOD a few scores so the leaderboard on the TV is not empty.
  const todaysWod = await prisma.scheduledWod.findFirstOrThrow({
    where: { date: localDate(today) },
    include: { wodDefinition: true },
  });
  const todaysClasses = instances.filter(
    (c) => c.date === localDate(today) && c.startsAt < now,
  );
  const todaysAttendees = await prisma.booking.findMany({
    where: {
      classInstanceId: { in: todaysClasses.map((c) => c.id) },
      status: 'BOOKED',
    },
    take: 12,
  });

  const scoredToday = new Set<string>();
  for (const booking of todaysAttendees) {
    if (scoredToday.has(booking.memberId)) continue;
    scoredToday.add(booking.memberId);

    await prisma.result.create({
      data: {
        memberId: booking.memberId,
        wodDefinitionId: todaysWod.wodDefinitionId,
        scheduledWodId: todaysWod.id,
        classInstanceId: booking.classInstanceId,
        scalingLevel: (random() < 0.2 ? 'RX_PLUS' : random() < 0.65 ? 'RX' : 'SCALED') as ScalingLevel,
        performedOn: localDate(today),
        ...generateScore(todaysWod.wodDefinition.scoreType, todaysWod.wodDefinition.timeCapSeconds),
      },
    });
  }
  console.log(
    `Programmed ${upcomingDates.length} upcoming days; ${scoredToday.size} scores already on today's board.`,
  );

  // -------------------------------------------------------------------------
  // Deliberate strike situations, so every penalty state is reachable in the UI
  // -------------------------------------------------------------------------
  const [nearThreshold, suspended, forgiven] = [members[0], members[1], members[2]];

  const pastBookingsFor = async (memberId: string, count: number) =>
    prisma.booking.findMany({
      where: { memberId, classInstance: { startsAt: { lt: now } } },
      take: count,
      orderBy: { bookedAt: 'desc' },
      include: { classInstance: true },
    });

  // 3 of 4 strikes — the "one more and you're paused" banner.
  const nearBookings = await pastBookingsFor(nearThreshold.id, 3);
  for (let i = 0; i < Math.min(3, nearBookings.length); i++) {
    await prisma.strikeEvent.create({
      data: {
        memberId: nearThreshold.id,
        bookingId: nearBookings[i].id,
        type: 'LATE_CANCEL',
        weight: gymConfig.strikes.lateCancelWeight,
        occurredAt: new Date(now.getTime() - (i + 2) * 86_400_000),
      },
    });
    await prisma.booking.update({
      where: { id: nearBookings[i].id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), lateCancel: true, checkedInAt: null },
    });
  }

  // Over the threshold, mid-suspension.
  const suspendedBookings = await pastBookingsFor(suspended.id, 3);
  const strikeShapes = [
    { type: 'NO_SHOW' as const, weight: gymConfig.strikes.noShowWeight, daysAgo: 6 },
    { type: 'LATE_CANCEL' as const, weight: gymConfig.strikes.lateCancelWeight, daysAgo: 4 },
    { type: 'LATE_CANCEL' as const, weight: gymConfig.strikes.lateCancelWeight, daysAgo: 2 },
  ];
  for (let i = 0; i < Math.min(strikeShapes.length, suspendedBookings.length); i++) {
    await prisma.strikeEvent.create({
      data: {
        memberId: suspended.id,
        bookingId: suspendedBookings[i].id,
        type: strikeShapes[i].type,
        weight: strikeShapes[i].weight,
        occurredAt: new Date(now.getTime() - strikeShapes[i].daysAgo * 86_400_000),
      },
    });
    await prisma.booking.update({
      where: { id: suspendedBookings[i].id },
      data:
        strikeShapes[i].type === 'NO_SHOW'
          ? { noShow: true, checkedInAt: null }
          : { status: 'CANCELLED', cancelledAt: new Date(), lateCancel: true, checkedInAt: null },
    });
  }

  // Two strikes, one already forgiven — shows the audit trail.
  const forgivenBookings = await pastBookingsFor(forgiven.id, 2);
  for (let i = 0; i < Math.min(2, forgivenBookings.length); i++) {
    await prisma.strikeEvent.create({
      data: {
        memberId: forgiven.id,
        bookingId: forgivenBookings[i].id,
        type: 'LATE_CANCEL',
        weight: gymConfig.strikes.lateCancelWeight,
        occurredAt: new Date(now.getTime() - (i + 3) * 86_400_000),
        ...(i === 0
          ? {
              forgivenAt: new Date(now.getTime() - 86_400_000),
              forgivenById: coaches[0].id,
              forgivenReason: 'Sick kid, called ahead',
            }
          : {}),
      },
    });
    await prisma.booking.update({
      where: { id: forgivenBookings[i].id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), lateCancel: true, checkedInAt: null },
    });
  }

  console.log('\nSeeded. Sign in with:');
  console.log(`  owner     owner@ironside.gym        / password123`);
  console.log(`  coach     coach.sam@ironside.gym    / password123`);
  console.log(`  member    member1@example.com       / password123  (3 strikes — warning banner)`);
  console.log(`  member    member2@example.com       / password123  (suspended)`);
  console.log(`  member    member3@example.com       / password123  (one strike forgiven)`);
  console.log(`  member    member4..40@example.com   / password123`);
}

function generateScore(scoreType: ScoreType, cap: number | null) {
  switch (scoreType) {
    case 'TIME': {
      const capped = cap ? random() < 0.12 : false;
      if (capped) return { cappedOut: true, capReps: between(5, 40) };
      const base = cap ? Math.floor(cap * 0.45) : 300;
      return { timeSeconds: between(base, cap ? Math.floor(cap * 0.95) : 600) };
    }
    case 'ROUNDS_REPS':
      return { rounds: between(8, 24), reps: between(0, 29) };
    case 'REPS':
      return { reps: between(60, 200) };
    case 'LOAD':
      return { loadKg: between(40, 180) };
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
