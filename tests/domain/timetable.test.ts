import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_SHAPES } from '@/lib/bootstrap';
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

describe('cancellation rules follow the time of day', () => {
  it('makes 6am and 7am classes cancellable until 9pm the night before', () => {
    const earlies = DEFAULT_TEMPLATE_SHAPES.filter((t) =>
      ['06:00', '07:00'].includes(t.startTimeLocal),
    );
    // Two each on Monday to Friday.
    expect(earlies.length).toBe(10);
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

  it('gives afternoon and evening classes a two-hour window, including the 4:30pm', () => {
    const laters = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.startTimeLocal >= '12:00');
    // Mon 2, Tue 3 (incl. Run Club), Wed 2, Thu 2, Fri 1.
    expect(laters.length).toBe(10);
    for (const template of laters) {
      expect(template.cancelPolicyType).toBe('RELATIVE');
      expect(template.cancelRelativeHours).toBe(2);
    }

    // The Thursday 4:30pm is new, so it is worth naming explicitly.
    const thursdayLate = DEFAULT_TEMPLATE_SHAPES.find(
      (t) => t.dayOfWeek === 4 && t.startTimeLocal === '16:30',
    );
    expect(thursdayLate?.cancelRelativeHours).toBe(2);
  });
});

describe('the Sunday drop-in', () => {
  it('tells members it is not included in membership', () => {
    const sunday = DEFAULT_TEMPLATE_SHAPES.filter((t) => t.dayOfWeek === 7);
    expect(sunday).toHaveLength(1);
    expect(sunday[0].notes).toMatch(/£5/);
    expect(sunday[0].notes).toMatch(/not included in membership/i);
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
    expect(sunday[0].notes).toMatch(/£5/);

    // And nothing else picks up a note it should not have.
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
