import { DateTime } from 'luxon';
import { GYM_TZ, localDateRange, localToUtc, localWeekday, type LocalDate } from '@/lib/time';
import { classCancelDeadline, type CancelPolicyType } from './cancellation';

export interface TemplateSpec {
  id: string;
  name: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  startTimeLocal: string;
  durationMinutes: number;
  capacity: number;
  defaultCoachId?: string | null;
  cancelPolicyType: CancelPolicyType;
  cancelAbsoluteTimeLocal?: string | null;
  cancelRelativeHours?: number | null;
  activeFrom: LocalDate;
  activeUntil?: LocalDate | null;
  archived?: boolean;
  notes?: string | null;
  /** No membership covers this class; anyone may book and pays separately. */
  payg?: boolean;
}

export interface InstanceSpec {
  templateId: string;
  name: string;
  notes: string | null;
  payg: boolean;
  date: LocalDate;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  coachId: string | null;
  cancelPolicyType: CancelPolicyType;
  cancelAbsoluteTimeLocal: string | null;
  cancelRelativeHours: number | null;
  cancelDeadlineAt: Date;
}

/**
 * Expand recurring templates into concrete class instances for a local date
 * range.
 *
 * Instances are materialised rather than computed on read because bookings
 * need a real row to point at, coaches get swapped on individual days, and a
 * holiday cancellation is a fact about one class rather than the pattern.
 *
 * Every instant here is derived by converting a wall-clock local time on a
 * specific local date, which is what makes the 6am class stay at 6am when the
 * clocks change instead of drifting to 5am or 7am.
 */
export function expandTemplates(
  templates: TemplateSpec[],
  from: LocalDate,
  to: LocalDate,
  zone: string = GYM_TZ,
): InstanceSpec[] {
  const specs: InstanceSpec[] = [];

  for (const date of localDateRange(from, to, zone)) {
    const weekday = localWeekday(date, zone);
    for (const template of templates) {
      if (template.archived) continue;
      if (template.dayOfWeek !== weekday) continue;
      if (date < template.activeFrom) continue;
      if (template.activeUntil && date > template.activeUntil) continue;

      const startsAt = localToUtc(date, template.startTimeLocal, zone);
      const endsAt = DateTime.fromJSDate(startsAt)
        .plus({ minutes: template.durationMinutes })
        .toJSDate();

      specs.push({
        templateId: template.id,
        name: template.name,
        notes: template.notes ?? null,
        payg: template.payg ?? false,
        date,
        startsAt,
        endsAt,
        // Snapshotted: editing the template later must not silently change the
        // terms for anyone already booked into a generated class.
        capacity: template.capacity,
        coachId: template.defaultCoachId ?? null,
        cancelPolicyType: template.cancelPolicyType,
        cancelAbsoluteTimeLocal: template.cancelAbsoluteTimeLocal ?? null,
        cancelRelativeHours: template.cancelRelativeHours ?? null,
        cancelDeadlineAt: classCancelDeadline(
          date,
          startsAt,
          {
            type: template.cancelPolicyType,
            absoluteTimeLocal: template.cancelAbsoluteTimeLocal,
            relativeHours: template.cancelRelativeHours,
          },
          zone,
        ),
      });
    }
  }

  return specs.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** "6:00am WOD" style label from a template's local start time. */
export function defaultTemplateName(startTimeLocal: string): string {
  const dt = DateTime.fromFormat(startTimeLocal, 'HH:mm', { zone: GYM_TZ });
  return dt.isValid ? `${dt.toFormat('h:mma').toLowerCase()} WOD` : `${startTimeLocal} WOD`;
}

export const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export const WEEKDAY_SHORT: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};
