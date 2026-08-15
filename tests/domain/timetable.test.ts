import { describe, expect, it } from 'vitest';
import { CLASS_DURATION_MINUTES, DEFAULT_TEMPLATE_SHAPES } from '@/lib/bootstrap';
import { expandTemplates, WEEKDAY_LABEL, type TemplateSpec } from '@/lib/domain/schedule';
import { toLocalTime } from '@/lib/time';

/**
 * B42's timetable, written out as the gym described it. If someone changes the
 * defaults, this is the test that says so.
 */
const EXPECTED: Record<number, Array<[string, string]>> = {
  1: [
    ['06:00', 'BLITZ42'],
    ['07:00', 'BLITZ42'],
    ['09:30', 'BLITZ42'],
    ['17:30', 'BLITZ42'],
    ['18:30', 'BLITZ42'],
  ],
  2: [
    ['06:00', 'ATHELERIX42'],
    ['07:00', 'ATHELERIX42'],
    ['09:30', 'ATHELERIX42'],
    ['17:30', 'ATHELERIX42'],
    ['18:30', 'ATHELERIX42'],
    ['18:30', 'Run Club'],
  ],
  3: [
    ['06:00', 'HYROX'],
    ['07:00', 'HYROX'],
    ['17:30', 'CALIBRATE42'],
    ['18:30', 'HYROX'],
  ],
  4: [
    ['06:00', 'BUILD42'],
    ['07:00', 'BUILD42'],
    ['09:30', 'BUILD42'],
    ['16:30', 'BUILD42'],
    ['17:30', 'BUILD42'],
  ],
  5: [
    ['06:00', 'HYROX'],
    ['07:00', 'HYROX'],
    ['09:30', 'HYROX'],
    ['17:30', 'HYROX'],
  ],
  7: [['09:30', 'HYROX']],
};

const sortKey = (a: [string, string], b: [string, string]) =>
  a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]);

describe('the B42 timetable', () => {
  it('has 25 classes across the week', () => {
    expect(DEFAULT_TEMPLATE_SHAPES).toHaveLength(25);
  });

  it.each(Object.keys(EXPECTED).map(Number))('runs the right classes on %s', (day) => {
    const actual = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.dayOfWeek === day)
      .map((t) => [t.startTimeLocal, t.name] as [string, string])
      .sort(sortKey);

    expect(actual).toEqual([...EXPECTED[day]].sort(sortKey));
  });

  it('runs nothing on Saturday', () => {
    expect(DEFAULT_TEMPLATE_SHAPES.filter((t) => t.dayOfWeek === 6)).toHaveLength(0);
    expect(WEEKDAY_LABEL[6]).toBe('Saturday');
  });

  it('runs two classes at 6:30pm on Tuesday — the WOD and Run Club', () => {
    const tuesdayEvening = DEFAULT_TEMPLATE_SHAPES.filter(
      (t) => t.dayOfWeek === 2 && t.startTimeLocal === '18:30',
    );
    expect(tuesdayEvening.map((t) => t.name).sort()).toEqual(['ATHELERIX42', 'Run Club']);
  });
});

describe('capacity is set by class type', () => {
  it.each([
    ['BLITZ42', 30],
    ['ATHELERIX42', 24],
    ['Run Club', 30],
    ['CALIBRATE42', 30],
    ['BUILD42', 20],
  ])('gives %s a capacity of %i', (name, capacity) => {
    const classes = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.name === name);
    expect(classes.length).toBeGreaterThan(0);
    for (const template of classes) {
      expect(template.capacity).toBe(capacity);
    }
  });

  it('sizes HYROX by the day it runs — 24 on Wednesday, 30 on Friday and Sunday', () => {
    const byDay = (day: number) =>
      DEFAULT_TEMPLATE_SHAPES.filter((t) => t.name === 'HYROX' && t.dayOfWeek === day);

    expect(byDay(3)).toHaveLength(3);
    expect(byDay(3).every((t) => t.capacity === 24)).toBe(true);

    expect(byDay(5)).toHaveLength(4);
    expect(byDay(5).every((t) => t.capacity === 30)).toBe(true);

    expect(byDay(7)).toHaveLength(1);
    expect(byDay(7).every((t) => t.capacity === 30)).toBe(true);
  });

  it('says Run Club is free to book for all members', () => {
    const runClub = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.name === 'Run Club');
    expect(runClub).toHaveLength(1);
    expect(runClub[0].capacity).toBe(30);
    expect(runClub[0].notes).toMatch(/free to book/i);
    expect(runClub[0].notes).toMatch(/every pace/i);
  });
});

describe('every class runs 42 minutes', () => {
  it('is the duration on every template', () => {
    expect(CLASS_DURATION_MINUTES).toBe(42);
    for (const template of DEFAULT_TEMPLATE_SHAPES) {
      expect(template.durationMinutes).toBe(42);
    }
  });

  it('ends a 6:00am class at 6:42am', () => {
    const specs = expandTemplates(
      DEFAULT_TEMPLATE_SHAPES.map((shape, index) => ({
        ...shape,
        id: `t-${index}`,
        activeFrom: '2026-01-01',
      })) as TemplateSpec[],
      '2026-08-17',
      '2026-08-17',
    );

    const early = specs.find((s) => toLocalTime(s.startsAt) === '06:00');
    expect(early).toBeDefined();
    expect(toLocalTime(early!.endsAt)).toBe('06:42');
  });
});

describe('cancellation rules', () => {
  it('makes 6am and 7am classes cancellable until 9pm the night before', () => {
    const earlies = DEFAULT_TEMPLATE_SHAPES.filter(
      (t) => ['06:00', '07:00'].includes(t.startTimeLocal) && t.name !== 'BUILD42',
    );
    // Two each on Monday, Tuesday, Wednesday and Friday. Thursday is BUILD42.
    expect(earlies.length).toBe(8);
    for (const template of earlies) {
      expect(template.cancelPolicyType).toBe('ABSOLUTE');
      expect(template.cancelAbsoluteTimeLocal).toBe('21:00');
    }
  });

  it('lets 9:30am classes be cancelled right up to the start', () => {
    const midMornings = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.startTimeLocal === '09:30');
    expect(midMornings.length).toBe(5);
    for (const template of midMornings) {
      expect(template.cancelPolicyType).toBe('NONE');
    }
  });

  it('gives afternoon and evening classes a two-hour window', () => {
    const laters = DEFAULT_TEMPLATE_SHAPES.filter(
      (t) => t.startTimeLocal >= '12:00' && t.name !== 'BUILD42',
    );
    // Mon 2, Tue 3 (incl. Run Club), Wed 2, Fri 1.
    expect(laters.length).toBe(8);
    for (const template of laters) {
      expect(template.cancelPolicyType).toBe('RELATIVE');
      expect(template.cancelRelativeHours).toBe(2);
    }
  });

  it('makes every BUILD42 free to cancel, whatever the hour', () => {
    const build = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.name === 'BUILD42');
    expect(build.length).toBe(5);
    for (const template of build) {
      expect(template.cancelPolicyType).toBe('NONE');
      expect(template.cancelAbsoluteTimeLocal).toBeNull();
      expect(template.cancelRelativeHours).toBeNull();
    }

    // Including the 6am, which for every other class type needs committing to
    // by 9pm the night before.
    const earlyBuild = build.find((t) => t.startTimeLocal === '06:00');
    expect(earlyBuild?.cancelPolicyType).toBe('NONE');
  });
});

describe('the Sunday drop-in', () => {
  it('tells members a payment link is coming', () => {
    const sunday = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.dayOfWeek === 7);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].notes).toMatch(/pay/i);
    expect(sunday[0].notes).toMatch(/link/i);
  });

  it('carries that note onto every generated Sunday class', () => {
    const specs = expandTemplates(
      DEFAULT_TEMPLATE_SHAPES.map((shape, index) => ({
        ...shape,
        id: `t-${index}`,
        activeFrom: '2026-01-01',
      })) as TemplateSpec[],
      '2026-08-17',
      '2026-08-23',
    );

    const sunday = specs.filter((s) => s.date === '2026-08-23');
    expect(sunday).toHaveLength(1);
    expect(sunday[0].notes).toMatch(/link/i);

    // Monday carries no note at all.
    const weekday = specs.filter((s) => s.date === '2026-08-17');
    expect(weekday.every((s) => s.notes === null)).toBe(true);
  });
});

describe('a generated week', () => {
  // Monday 17 August 2026 through Sunday 23 August.
  const specs = expandTemplates(
    DEFAULT_TEMPLATE_SHAPES.map((shape, index) => ({
      ...shape,
      id: `t-${index}`,
      activeFrom: '2026-01-01',
    })) as TemplateSpec[],
    '2026-08-17',
    '2026-08-23',
  );

  it('produces exactly one week of classes', () => {
    expect(specs).toHaveLength(25);
  });

  it('puts every class at its advertised local time', () => {
    for (const spec of specs) {
      expect(toLocalTime(spec.startsAt)).toMatch(/^\d{2}:\d{2}$/);
    }
    const monday = specs.filter((s) => s.date === '2026-08-17');
    expect(monday.map((s) => toLocalTime(s.startsAt))).toEqual([
      '06:00',
      '07:00',
      '09:30',
      '17:30',
      '18:30',
    ]);
  });

  it('has an empty Saturday', () => {
    expect(specs.filter((s) => s.date === '2026-08-22')).toHaveLength(0);
  });
});
