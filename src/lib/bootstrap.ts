import type { PrismaClient, Prisma, ScalingLevel, ScoreType, WodType } from '@prisma/client';
import { hashPassword } from '@/lib/password';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The gym's starting content, in one place so the first-run setup page and the
 * development seed can never drift apart.
 */

export interface TemplateShape {
  name: string;
  startTimeLocal: string;
  capacity: number;
  cancelPolicyType: 'ABSOLUTE' | 'RELATIVE' | 'NONE';
  cancelAbsoluteTimeLocal: string | null;
  cancelRelativeHours: number | null;
}

/** The schedule this gym actually runs. Editable per template in the coach UI. */
export const DEFAULT_TEMPLATE_SHAPES: TemplateShape[] = [
  {
    name: '6:00am WOD',
    startTimeLocal: '06:00',
    capacity: 16,
    cancelPolicyType: 'ABSOLUTE',
    cancelAbsoluteTimeLocal: '21:00',
    cancelRelativeHours: null,
  },
  {
    name: '7:00am WOD',
    startTimeLocal: '07:00',
    capacity: 16,
    cancelPolicyType: 'ABSOLUTE',
    cancelAbsoluteTimeLocal: '21:00',
    cancelRelativeHours: null,
  },
  {
    name: '9:30am WOD',
    startTimeLocal: '09:30',
    capacity: 12,
    cancelPolicyType: 'NONE',
    cancelAbsoluteTimeLocal: null,
    cancelRelativeHours: null,
  },
  {
    name: '5:30pm WOD',
    startTimeLocal: '17:30',
    capacity: 20,
    cancelPolicyType: 'RELATIVE',
    cancelAbsoluteTimeLocal: null,
    cancelRelativeHours: 2,
  },
  {
    name: '6:30pm WOD',
    startTimeLocal: '18:30',
    capacity: 20,
    cancelPolicyType: 'RELATIVE',
    cancelAbsoluteTimeLocal: null,
    cancelRelativeHours: 2,
  },
];

/** Monday–Friday. Add or remove days in the coach UI once you're running. */
export const DEFAULT_TEMPLATE_DAYS = [1, 2, 3, 4, 5];

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
  coachIdForDay?: (index: number) => string | null,
) {
  const created = [];
  let index = 0;
  for (const dayOfWeek of DEFAULT_TEMPLATE_DAYS) {
    for (const shape of DEFAULT_TEMPLATE_SHAPES) {
      created.push(
        await db.classTemplate.create({
          data: {
            name: shape.name,
            dayOfWeek,
            startTimeLocal: shape.startTimeLocal,
            durationMinutes: 60,
            capacity: shape.capacity,
            defaultCoachId: coachIdForDay?.(index) ?? null,
            cancelPolicyType: shape.cancelPolicyType,
            cancelAbsoluteTimeLocal: shape.cancelAbsoluteTimeLocal,
            cancelRelativeHours: shape.cancelRelativeHours,
            activeFrom,
          },
        }),
      );
      index++;
    }
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
