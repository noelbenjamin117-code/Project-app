import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { gymConfig } from '~/gym.config';
import { expandTemplates, type TemplateSpec } from '@/lib/domain/schedule';
import { classCancelDeadline } from '@/lib/domain/cancellation';
import { GYM_TZ, localToUtc, toLocalTime, toLocalDate } from '@/lib/time';

/**
 * These tests take the timezone as a parameter rather than reading it from the
 * gym config.
 *
 * An earlier version hard-coded New York's transition dates, which meant that
 * changing the gym's timezone — a supported thing to do before launch — broke
 * the suite even though the app was working correctly. Now the behaviour is
 * verified for several zones AND for whatever the gym is actually set to.
 */

function sixAmTemplate(overrides: Partial<TemplateSpec> = {}): TemplateSpec {
  return {
    id: 'template-6am',
    name: '6:00am WOD',
    dayOfWeek: 1, // Monday
    startTimeLocal: '06:00',
    durationMinutes: 60,
    capacity: 16,
    cancelPolicyType: 'ABSOLUTE',
    cancelAbsoluteTimeLocal: '21:00',
    activeFrom: '2020-01-01',
    ...overrides,
  };
}

/** The instants in a year where a zone's UTC offset changes. */
function dstTransitions(zone: string, year: number): string[] {
  const days: string[] = [];
  let cursor = DateTime.fromISO(`${year}-01-01`, { zone });
  let offset = cursor.offset;

  while (cursor.year === year) {
    const next = cursor.plus({ days: 1 });
    if (next.offset !== offset) {
      days.push(next.toFormat('yyyy-MM-dd'));
      offset = next.offset;
    }
    cursor = next;
  }
  return days;
}

describe.each([
  { zone: 'America/New_York', label: 'New York' },
  { zone: 'Europe/London', label: 'London' },
  { zone: 'Australia/Sydney', label: 'Sydney' },
])('a 6am class in $label', ({ zone }) => {
  const transitions = dstTransitions(zone, 2026);

  it('has clock changes in 2026 worth testing', () => {
    expect(transitions.length).toBeGreaterThan(0);
  });

  it('starts at 06:00 local on every single occurrence of the year', () => {
    const specs = expandTemplates([sixAmTemplate()], '2026-01-01', '2026-12-31', zone);

    expect(specs.length).toBeGreaterThan(50);
    for (const spec of specs) {
      expect(toLocalTime(spec.startsAt, zone)).toBe('06:00');
    }
  });

  it('keeps the ABSOLUTE 21:00 deadline at 21:00 local all year', () => {
    const specs = expandTemplates([sixAmTemplate()], '2026-01-01', '2026-12-31', zone);

    for (const spec of specs) {
      expect(toLocalTime(spec.cancelDeadlineAt, zone)).toBe('21:00');
      // Always the previous calendar day, never the day of the class.
      expect(toLocalDate(spec.cancelDeadlineAt, zone)).toBe(
        DateTime.fromISO(spec.date, { zone }).minus({ days: 1 }).toFormat('yyyy-MM-dd'),
      );
    }
  });

  it('shifts the underlying UTC instant across each clock change', () => {
    for (const transition of transitions) {
      // The Mondays either side of this transition.
      const before = DateTime.fromISO(transition, { zone }).minus({ days: 9 });
      const after = DateTime.fromISO(transition, { zone }).plus({ days: 9 });

      const specs = expandTemplates(
        [sixAmTemplate()],
        before.toFormat('yyyy-MM-dd'),
        after.toFormat('yyyy-MM-dd'),
        zone,
      );

      const offsets = new Set(
        specs.map((s) => DateTime.fromJSDate(s.startsAt, { zone }).offset),
      );
      // Wall-clock time held constant, so the offset must have moved.
      expect(offsets.size).toBeGreaterThan(1);

      for (const spec of specs) {
        expect(toLocalTime(spec.startsAt, zone)).toBe('06:00');
      }
    }
  });

  it('keeps an evening class on the right calendar day across changes', () => {
    const evening = sixAmTemplate({
      id: 'evening',
      startTimeLocal: '18:30',
      cancelPolicyType: 'RELATIVE',
      cancelAbsoluteTimeLocal: null,
      cancelRelativeHours: 2,
    });
    const specs = expandTemplates([evening], '2026-01-01', '2026-12-31', zone);

    for (const spec of specs) {
      expect(toLocalTime(spec.startsAt, zone)).toBe('18:30');
      expect(toLocalDate(spec.startsAt, zone)).toBe(spec.date);
      // Two hours before, on the same day.
      expect(toLocalTime(spec.cancelDeadlineAt, zone)).toBe('16:30');
      expect(toLocalDate(spec.cancelDeadlineAt, zone)).toBe(spec.date);
    }
  });
});

describe('the gym\'s configured timezone', () => {
  it(`is a real IANA zone (${gymConfig.timezone})`, () => {
    expect(DateTime.local().setZone(gymConfig.timezone).isValid).toBe(true);
    expect(GYM_TZ).toBe(gymConfig.timezone);
  });

  it('keeps every class in the real schedule at its advertised local time all year', () => {
    // The gym's actual classes, in the gym's actual timezone.
    const templates: TemplateSpec[] = [
      ['06:00', 'ABSOLUTE'],
      ['07:00', 'ABSOLUTE'],
      ['09:30', 'NONE'],
      ['17:30', 'RELATIVE'],
      ['18:30', 'RELATIVE'],
    ].flatMap(([time, policy], index) =>
      [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        id: `t-${index}-${dayOfWeek}`,
        name: `${time} WOD`,
        dayOfWeek,
        startTimeLocal: time as string,
        durationMinutes: 60,
        capacity: 16,
        cancelPolicyType: policy as 'ABSOLUTE' | 'RELATIVE' | 'NONE',
        cancelAbsoluteTimeLocal: policy === 'ABSOLUTE' ? '21:00' : null,
        cancelRelativeHours: policy === 'RELATIVE' ? 2 : null,
        activeFrom: '2020-01-01',
      })),
    );

    const specs = expandTemplates(templates, '2026-01-01', '2026-12-31');
    expect(specs.length).toBeGreaterThan(1000);

    for (const spec of specs) {
      expect(toLocalTime(spec.startsAt)).toBe(spec.name.slice(0, 5));
    }
  });
});

describe('awkward local times', () => {
  it('moves a time inside the spring-forward gap forward, rather than failing', () => {
    // 02:30 on 8 March 2026 does not exist in New York.
    expect(toLocalTime(localToUtc('2026-03-08', '02:30', 'America/New_York'), 'America/New_York'))
      .toBe('03:30');
    // 01:30 on 29 March 2026 does not exist in London.
    expect(toLocalTime(localToUtc('2026-03-29', '01:30', 'Europe/London'), 'Europe/London'))
      .toBe('02:30');
  });

  it('resolves an ambiguous fall-back time to the first occurrence', () => {
    // 01:30 on 1 November 2026 happens twice in New York; the earlier is EDT.
    const ny = localToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(DateTime.fromJSDate(ny, { zone: 'America/New_York' }).offset).toBe(-240);

    // 01:30 on 25 October 2026 happens twice in London; the earlier is BST.
    const london = localToUtc('2026-10-25', '01:30', 'Europe/London');
    expect(DateTime.fromJSDate(london, { zone: 'Europe/London' }).offset).toBe(60);
  });
});

describe('generation windows', () => {
  it('generates only on the template weekday and inside its active window', () => {
    const bounded = sixAmTemplate({ activeFrom: '2026-03-09', activeUntil: '2026-03-09' });
    const specs = expandTemplates([bounded], '2026-03-01', '2026-03-31', 'America/New_York');
    expect(specs.map((s) => s.date)).toEqual(['2026-03-09']);
  });

  it('skips archived templates', () => {
    const specs = expandTemplates([sixAmTemplate({ archived: true })], '2026-03-01', '2026-03-31');
    expect(specs).toEqual([]);
  });
});

describe('cancellation deadline shapes', () => {
  const zone = 'Europe/London';
  const startsAt = localToUtc('2026-06-15', '17:30', zone);

  it('RELATIVE subtracts whole hours from the class start', () => {
    const deadline = classCancelDeadline(
      '2026-06-15',
      startsAt,
      { type: 'RELATIVE', relativeHours: 2 },
      zone,
    );
    expect(toLocalTime(deadline, zone)).toBe('15:30');
    expect(toLocalDate(deadline, zone)).toBe('2026-06-15');
  });

  it('NONE runs right up to the start of the class', () => {
    const deadline = classCancelDeadline('2026-06-15', startsAt, { type: 'NONE' }, zone);
    expect(deadline.getTime()).toBe(startsAt.getTime());
  });

  it('ABSOLUTE lands on the previous calendar day', () => {
    const deadline = classCancelDeadline(
      '2026-06-15',
      startsAt,
      { type: 'ABSOLUTE', absoluteTimeLocal: '21:00' },
      zone,
    );
    expect(toLocalDate(deadline, zone)).toBe('2026-06-14');
    expect(toLocalTime(deadline, zone)).toBe('21:00');
  });

  it('refuses an ABSOLUTE policy with no time and a RELATIVE policy with no hours', () => {
    expect(() => classCancelDeadline('2026-06-15', startsAt, { type: 'ABSOLUTE' })).toThrow();
    expect(() => classCancelDeadline('2026-06-15', startsAt, { type: 'RELATIVE' })).toThrow();
  });
});
