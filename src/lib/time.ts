import { DateTime } from 'luxon';
import { gymConfig } from '~/gym.config';

export const GYM_TZ = gymConfig.timezone;

/** "yyyy-MM-dd" in gym-local time. */
export type LocalDate = string;
/** "HH:mm" wall-clock, no offset. */
export type LocalTime = string;

/**
 * Combine a local calendar date with a wall-clock time in the gym's timezone
 * and return the UTC instant.
 *
 * This is the single conversion that keeps a 6am class at 6am across a DST
 * boundary: the template stores "06:00" with no offset, and the offset is
 * resolved per-date at generation time.
 *
 * Two DST edge cases, resolved explicitly rather than left to chance:
 *  - Spring forward: 02:30 does not exist. Luxon shifts it forward past the
 *    gap, so the class lands at the first valid instant.
 *  - Fall back: 01:30 happens twice. Luxon takes the first (pre-transition)
 *    occurrence, which is the earlier wall-clock moment members expect.
 */
export function localToUtc(date: LocalDate, time: LocalTime, zone: string = GYM_TZ): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) {
    throw new Error(`Invalid local datetime ${date}T${time}: ${dt.invalidReason}`);
  }
  return dt.toUTC().toJSDate();
}

/** The gym-local calendar date of an instant, as "yyyy-MM-dd". */
export function toLocalDate(instant: Date, zone: string = GYM_TZ): LocalDate {
  return DateTime.fromJSDate(instant, { zone }).toFormat('yyyy-MM-dd');
}

/** The gym-local wall-clock time of an instant, as "HH:mm". */
export function toLocalTime(instant: Date, zone: string = GYM_TZ): LocalTime {
  return DateTime.fromJSDate(instant, { zone }).toFormat('HH:mm');
}

export function todayLocal(now: Date = new Date()): LocalDate {
  return toLocalDate(now);
}

/** Shift a local date by whole days, staying in the local calendar. */
export function addLocalDays(date: LocalDate, days: number, zone: string = GYM_TZ): LocalDate {
  return DateTime.fromISO(date, { zone }).plus({ days }).toFormat('yyyy-MM-dd');
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function localWeekday(date: LocalDate, zone: string = GYM_TZ): number {
  return DateTime.fromISO(date, { zone }).weekday;
}

/** Inclusive list of local dates from `from` to `to`. */
export function localDateRange(
  from: LocalDate,
  to: LocalDate,
  zone: string = GYM_TZ,
): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = DateTime.fromISO(from, { zone }).startOf('day');
  const end = DateTime.fromISO(to, { zone }).startOf('day');
  while (cursor <= end) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Display helpers. Everything a member reads is rendered through these, so the
// UI never has to think about offsets.
// ---------------------------------------------------------------------------

/** "6:00am" */
export function formatTime(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: GYM_TZ })
    .toFormat('h:mma')
    .toLowerCase();
}

/** "Mon 12 Aug" */
export function formatDayDate(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: GYM_TZ }).toFormat('ccc d LLL');
}

/** "Mon 12 Aug, 6:00am" */
export function formatDateTime(instant: Date): string {
  return `${formatDayDate(instant)}, ${formatTime(instant)}`;
}

/**
 * A deadline phrased the way a member would say it out loud:
 * "9:00pm tonight", "9:00pm tomorrow", "5:30pm Thu 14 Aug".
 *
 * The cancellation UI must show a real timestamp rather than restating the
 * rule, so this is what it renders.
 */
export function formatDeadline(deadline: Date, now: Date = new Date()): string {
  const time = formatTime(deadline);
  const deadlineDate = toLocalDate(deadline);
  const today = toLocalDate(now);

  if (deadlineDate === today) {
    const hour = DateTime.fromJSDate(deadline, { zone: GYM_TZ }).hour;
    if (hour >= 17) return `${time} tonight`;
    if (hour < 12) return `${time} this morning`;
    return `${time} today`;
  }
  if (deadlineDate === addLocalDays(today, 1)) return `${time} tomorrow`;
  return `${time} ${formatDayDate(deadline)}`;
}

/** "in 2 hours", "in 25 minutes", "3 days ago". Coarse on purpose. */
export function formatRelative(instant: Date, now: Date = new Date()): string {
  return (
    DateTime.fromJSDate(instant, { zone: GYM_TZ }).toRelative({
      base: DateTime.fromJSDate(now, { zone: GYM_TZ }),
    }) ?? ''
  );
}
