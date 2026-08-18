import type { PrismaClient, Prisma, ScalingLevel, ScoreType, WodType } from '@prisma/client';
import { hashPassword } from '@/lib/password';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The gym's starting content, in one place so the first-run setup page and the
 * development seed can never drift apart.
 */

export interface TemplateShape {
  name: string;
  dayOfWeek: number;
  startTimeLocal: string;
  durationMinutes: number;
  capacity: number;
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal: string | null;
  cancelRelativeHours: number | null;
  notes: string | null;
  payg: boolean;
}

/** Every class runs 42 minutes — the 42 in B42. */
export const CLASS_DURATION_MINUTES = 42;

/**
 * B42's timetable, by day. Sunday is day 7; there are no Saturday classes.
 *
 * Capacity belongs to the class type rather than the time of day, because the
 * format decides how many people fit: BUILD42 is a lifting session on twenty
 * racks, BLITZ42 packs thirty in.
 *
 * This is only the starting point — every one of these becomes an editable
 * class template, so times, capacities, coaches, durations and rules can all
 * be changed in the Schedule page without touching code.
 */
const TIMETABLE: Array<{
  dayOfWeek: number;
  name: string;
  times: string[];
  capacity: number;
  /** Overrides the usual time-of-day cancellation rule for this class type. */
  cancelPolicy?: 'NONE';
  notes?: string;
  /** Outside every membership — anyone may book and pays for the class itself. */
  payg?: boolean;
}> = [
  {
    dayOfWeek: 1,
    name: 'BLITZ42',
    times: ['06:00', '07:00', '09:30', '17:30', '18:30'],
    capacity: 30,
  },
  {
    dayOfWeek: 2,
    name: 'ATHELERIX42',
    times: ['06:00', '07:00', '09:30', '17:30', '18:30'],
    capacity: 24,
  },
  {
    dayOfWeek: 2,
    name: 'Run Club',
    times: ['18:30'],
    capacity: 30,
    notes: 'Every pace welcome — free to book for all members.',
  },
  { dayOfWeek: 3, name: 'HYROX', times: ['06:00', '07:00', '18:30'], capacity: 24 },
  { dayOfWeek: 3, name: 'CALIBRATE42', times: ['17:30'], capacity: 30 },
  {
    dayOfWeek: 4,
    name: 'BUILD42',
    times: ['06:00', '07:00', '09:30', '16:30', '17:30'],
    capacity: 20,
    // BUILD42 is free to cancel whatever the hour, so it opts out of the
    // 9pm-the-night-before rule that the other early classes carry.
    cancelPolicy: 'NONE',
  },
  { dayOfWeek: 5, name: 'HYROX', times: ['06:00', '07:00', '09:30', '17:30'], capacity: 30 },
  {
    dayOfWeek: 7,
    name: 'HYROX',
    times: ['09:30'],
    capacity: 30,
    payg: true,
    notes: 'Pay-as-you-go £5 — open to everyone. We’ll send you a payment link when you book.',
  },
];

/**
 * Cancellation rules are set by class time rather than by class type, which is
 * how the gym actually runs them: early mornings need committing to the night
 * before, the mid-morning class is come-as-you-are, and afternoons and
 * evenings give two hours' notice.
 */
function ruleForTime(startTimeLocal: string): {
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal: string | null;
  cancelRelativeHours: number | null;
} {
  if (startTimeLocal === '06:00' || startTimeLocal === '07:00') {
    return {
      cancelPolicyType: 'ABSOLUTE',
      cancelAbsoluteTimeLocal: '21:00',
      cancelRelativeHours: null,
    };
  }
  if (startTimeLocal === '09:30') {
    return { cancelPolicyType: 'NONE', cancelAbsoluteTimeLocal: null, cancelRelativeHours: null };
  }
  // Everything from lunchtime onwards, including the 4:30pm on Thursdays.
  return { cancelPolicyType: 'RELATIVE', cancelAbsoluteTimeLocal: null, cancelRelativeHours: 2 };
}

const FREE_TO_CANCEL = {
  cancelPolicyType: 'NONE' as const,
  cancelAbsoluteTimeLocal: null,
  cancelRelativeHours: null,
};

export const DEFAULT_TEMPLATE_SHAPES: TemplateShape[] = TIMETABLE.flatMap((entry) =>
  entry.times.map((startTimeLocal) => ({
    name: entry.name,
    dayOfWeek: entry.dayOfWeek,
    startTimeLocal,
    durationMinutes: CLASS_DURATION_MINUTES,
    capacity: entry.capacity,
    notes: entry.notes ?? null,
    payg: entry.payg ?? false,
    ...(entry.cancelPolicy === 'NONE' ? FREE_TO_CANCEL : ruleForTime(startTimeLocal)),
  })),
);

export const MOVEMENTS: Array<[string, boolean]> = [
  ['Back Squat', true],
  ['Front Squat', true],
  ['Overhead Squat', true],
  ['Deadlift', true],
  ['Bench Press', true],
  ['Shoulder Press', true],
  ['Push Press', true],
  ['Clean', true],
  ['Snatch', true],
  ['Clean & Jerk', true],
  ['Thruster', true],
  ['Pull-up', false],
];

export interface BenchmarkShape {
  name: string;
  type: WodType;
  scoreType: ScoreType;
  cap?: number;
  description: string;
  scaled: string;
  rxPlus?: string;
}

export const BENCHMARK_WODS: BenchmarkShape[] = [
  {
    name: 'Fran',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 600,
    description: '21-15-9 reps for time:\nThruster 43/30kg\nPull-up',
    scaled: 'Thruster 30/20kg, banded pull-up',
    rxPlus: 'Thruster 43/30kg, chest-to-bar pull-up',
  },
  {
    name: 'Cindy',
    type: 'AMRAP',
    scoreType: 'ROUNDS_REPS',
    description: 'AMRAP 20 minutes:\n5 Pull-ups\n10 Push-ups\n15 Air squats',
    scaled: 'Banded pull-up, knee push-up',
    rxPlus: 'Chest-to-bar pull-up, hand-release push-up',
  },
  {
    name: 'Grace',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 720,
    description: '30 Clean & Jerks for time\n61/43kg',
    scaled: '40/30kg',
    rxPlus: '70/50kg',
  },
  {
    name: 'Helen',
    type: 'RFT',
    scoreType: 'TIME',
    cap: 900,
    description: '3 rounds for time:\n400m Run\n21 Kettlebell swings 24/16kg\n12 Pull-ups',
    scaled: '300m run, 16/12kg, banded pull-up',
  },
  {
    name: 'Diane',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 720,
    description: '21-15-9 reps for time:\nDeadlift 102/70kg\nHandstand push-up',
    scaled: 'Deadlift 70/50kg, box HSPU',
  },
  {
    name: 'Isabel',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 600,
    description: '30 Snatches for time\n61/43kg',
    scaled: '40/30kg',
  },
  {
    name: 'Karen',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 900,
    description: '150 Wall balls for time\n9/6kg to 10/9ft',
    scaled: '100 reps, 6/4kg',
  },
  {
    name: 'Annie',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 600,
    description: '50-40-30-20-10 reps for time:\nDouble-under\nSit-up',
    scaled: 'Single-unders x2',
  },
  {
    name: 'Jackie',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 900,
    description: 'For time:\n1000m Row\n50 Thrusters 20/15kg\n30 Pull-ups',
    scaled: '750m row, 15/10kg, banded pull-up',
  },
  {
    name: 'Murph',
    type: 'FOR_TIME',
    scoreType: 'TIME',
    cap: 3600,
    description:
      'For time:\n1 mile Run\n100 Pull-ups\n200 Push-ups\n300 Air squats\n1 mile Run',
    scaled: 'Half Murph',
    rxPlus: 'Wearing a 9/6kg vest',
  },
];

export async function createMovements(db: Db) {
  return Promise.all(
    MOVEMENTS.map(([name, isBarbellLift]) =>
      db.movement.create({ data: { name, isBarbellLift } }),
    ),
  );
}

export async function createBenchmarkWods(db: Db, createdById: string) {
  const created = [];
  for (const benchmark of BENCHMARK_WODS) {
    created.push(
      await db.wodDefinition.create({
        data: {
          name: benchmark.name,
          isBenchmark: true,
          type: benchmark.type,
          scoreType: benchmark.scoreType,
          timeCapSeconds: benchmark.cap ?? null,
          description: benchmark.description,
          createdById,
          scalingOptions: {
            create: [
              ...(benchmark.rxPlus
                ? [{ level: 'RX_PLUS' as ScalingLevel, description: benchmark.rxPlus }]
                : []),
              { level: 'RX' as ScalingLevel, description: 'As prescribed' },
              { level: 'SCALED' as ScalingLevel, description: benchmark.scaled },
            ],
          },
        },
      }),
    );
  }
  return created;
}

export async function createDefaultTemplates(
  db: Db,
  activeFrom: string,
  coachForIndex?: (index: number) => string | null,
) {
  const created = [];
  for (const [index, shape] of DEFAULT_TEMPLATE_SHAPES.entries()) {
    created.push(
      await db.classTemplate.create({
        data: {
          name: shape.name,
          dayOfWeek: shape.dayOfWeek,
          startTimeLocal: shape.startTimeLocal,
          durationMinutes: shape.durationMinutes,
          capacity: shape.capacity,
          defaultCoachId: coachForIndex?.(index) ?? null,
          cancelPolicyType: shape.cancelPolicyType,
          cancelAbsoluteTimeLocal: shape.cancelAbsoluteTimeLocal,
          cancelRelativeHours: shape.cancelRelativeHours,
          notes: shape.notes,
          payg: shape.payg,
          activeFrom,
        },
      }),
    );
  }
  return created;
}

export interface BootstrapInput {
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  includeSchedule: boolean;
  includeBenchmarks: boolean;
  activeFrom: string;
}

/**
 * Create the very first account and, optionally, the starting schedule and
 * benchmark library.
 *
 * Runs in one transaction and re-checks that the gym is still empty inside it,
 * so two people opening the setup page at once cannot both create an owner.
 */
export async function bootstrapGym(prisma: PrismaClient, input: BootstrapInput) {
  const passwordHash = await hashPassword(input.ownerPassword);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.count();
    if (existing > 0) {
      throw new Error('This gym has already been set up.');
    }

    const owner = await tx.user.create({
      data: {
        email: input.ownerEmail.trim().toLowerCase(),
        name: input.ownerName.trim(),
        role: 'OWNER',
        passwordHash,
      },
    });

    if (input.includeBenchmarks) {
      await createMovements(tx);
      await createBenchmarkWods(tx, owner.id);
    }

    if (input.includeSchedule) {
      await createDefaultTemplates(tx, input.activeFrom);
    }

    return owner;
  });
}
