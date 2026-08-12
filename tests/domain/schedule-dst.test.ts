import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { expandTemplates, type TemplateSpec } from '@/lib/domain/schedule';
import { classCancelDeadline } from '@/lib/domain/cancellation';
import { GYM_TZ, localToUtc, toLocalTime, toLocalDate } from '@/lib/time';

/**
 * The gym is in America/New_York. In 2026 the clocks go forward on Sunday
 * 8 March and back on Sunday 1 November.
 */
const sixAm: TemplateSpec = {
  id: 'template-6am',
  name: '6:00am WOD',
  dayOfWeek: 1, // Monday
  startTimeLocal: '06:00',
  durationMinutes: 60,
  capacity: 16,
  cancelPolicyType: 'ABSOLUTE',
  cancelAbsoluteTimeLocal: '21:00',
  activeFrom: '2026-01-01',
};

describe('DST-safe scheduling', () => {
  it('keeps a 6am class at 6am local across the spring-forward boundary', () => {
    // Mondays either side of Sunday 8 March 2026.
    const specs = expandTemplates([sixAm], '2026-03-01', '2026-03-16');
    const times = specs.map((s) => ({ date: s.date, local: toLocalTime(s.startsAt) }));

    expect(times).toEqual([
      { date: '2026-03-02', local: '06:00' },
      { date: '2026-03-09', local: '06:00' },
      { date: '2026-03-16', local: '06:00' },
    ]);
  });

  it('shifts the underlying UTC instant by an hour across the boundary', () => {
    const specs = expandTemplates([sixAm], '2026-03-01', '2026-03-16');
    const utc = specs.map((s) => s.startsAt.toISOString());

    // 11:00Z in EST, 10:00Z in EDT — the wall clock is what stays fixed.
    expect(utc).toEqual([
      '2026-03-02T11:00:00.000Z',
      '2026-03-09T10:00:00.000Z',
      '2026-03-16T10:00:00.000Z',
    ]);
  });

  it('keeps a 6am class at 6am local across the autumn fall-back boundary', () => {
    const specs = expandTemplates([sixAm], '2026-10-26', '2026-11-09');
    expect(specs.map((s) => ({ date: s.date, local: toLocalTime(s.startsAt) }))).toEqual([
      { date: '2026-10-26', local: '06:00' },
      { date: '2026-11-02', local: '06:00' },
      { date: '2026-11-09', local: '06:00' },
    ]);
    expect(specs.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-10-26T10:00:00.000Z',
      '2026-11-02T11:00:00.000Z',
      '2026-11-09T11:00:00.000Z',
    ]);
  });

  it('lands an ABSOLUTE 21:00 deadline on 21:00 local even when the class is across a DST change', () => {
    // Monday 9 March is EDT; Sunday 8 March (deadline day) contains the change.
    const specs = expandTemplates([sixAm], '2026-03-09', '2026-03-09');
    const deadline = specs[0].cancelDeadlineAt;

    expect(toLocalDate(deadline)).toBe('2026-03-08');
    expect(toLocalTime(deadline)).toBe('21:00');
    // 21:00 EDT is 01:00Z the next day.
    expect(deadline.toISOString()).toBe('2026-03-09T01:00:00.000Z');
  });

  it('keeps every ABSOLUTE deadline at 21:00 local across a whole year', () => {
    const specs = expandTemplates([sixAm], '2026-01-01', '2026-12-31');
    expect(specs.length).toBeGreaterThan(50);

    for (const spec of specs) {
      expect(toLocalTime(spec.cancelDeadlineAt)).toBe('21:00');
      expect(toLocalTime(spec.startsAt)).toBe('06:00');
    }
  });

  it('resolves a local time inside the spring-forward gap by moving forward', () => {
    // 02:30 on 8 March 2026 does not exist in New York.
    const instant = localToUtc('2026-03-08', '02:30');
    expect(toLocalTime(instant)).toBe('03:30');
  });

  it('resolves an ambiguous fall-back local time to the first occurrence', () => {
    // 01:30 on 1 November 2026 happens twice; the earlier one is EDT (-04:00).
    const instant = localToUtc('2026-11-01', '01:30');
    expect(DateTime.fromJSDate(instant, { zone: GYM_TZ }).offset).toBe(-240);
  });

  it('generates only on the template weekday and inside its active window', () => {
    const bounded: TemplateSpec = {
      ...sixAm,
      activeFrom: '2026-03-09',
      activeUntil: '2026-03-09',
    };
    const specs = expandTemplates([bounded], '2026-03-01', '2026-03-31');
    expect(specs.map((s) => s.date)).toEqual(['2026-03-09']);
  });

  it('skips archived templates', () => {
    const specs = expandTemplates([{ ...sixAm, archived: true }], '2026-03-01', '2026-03-31');
    expect(specs).toEqual([]);
  });
});

describe('cancellation deadline shapes', () => {
  const startsAt = localToUtc('2026-06-15', '17:30');

  it('RELATIVE subtracts whole hours from the class start', () => {
    const deadline = classCancelDeadline('2026-06-15', startsAt, {
      type: 'RELATIVE',
      relativeHours: 2,
    });
    expect(toLocalTime(deadline)).toBe('15:30');
    expect(toLocalDate(deadline)).toBe('2026-06-15');
  });

  it('NONE runs right up to the start of the class', () => {
    const deadline = classCancelDeadline('2026-06-15', startsAt, { type: 'NONE' });
    expect(deadline.getTime()).toBe(startsAt.getTime());
  });

  it('ABSOLUTE lands on the previous calendar day', () => {
    const deadline = classCancelDeadline('2026-06-15', startsAt, {
      type: 'ABSOLUTE',
      absoluteTimeLocal: '21:00',
    });
    expect(toLocalDate(deadline)).toBe('2026-06-14');
    expect(toLocalTime(deadline)).toBe('21:00');
  });

  it('refuses an ABSOLUTE policy with no time and a RELATIVE policy with no hours', () => {
    expect(() => classCancelDeadline('2026-06-15', startsAt, { type: 'ABSOLUTE' })).toThrow();
    expect(() => classCancelDeadline('2026-06-15', startsAt, { type: 'RELATIVE' })).toThrow();
  });
});
