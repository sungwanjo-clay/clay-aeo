/**
 * Date helpers on plain 'YYYY-MM-DD' strings, all in UTC. The dbt models bucket
 * workspaces by UTC creation date, so we never touch local time here.
 */

export type ISODate = string

const DAY_MS = 86_400_000

export function toDate(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`)
}

export function iso(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: ISODate, n: number): ISODate {
  return iso(new Date(toDate(d).getTime() + n * DAY_MS))
}

/** Inclusive day count between two dates. */
export function daysBetween(start: ISODate, end: ISODate): number {
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / DAY_MS) + 1
}

export function todayUTC(): ISODate {
  return iso(new Date())
}

/** Monday of the week containing d (weeks start Monday, like dbt's TIME_PERIOD_TYPE='week'). */
export function mondayOf(d: ISODate): ISODate {
  const dow = toDate(d).getUTCDay() // 0 = Sun
  return addDays(d, -((dow + 6) % 7))
}

export function firstOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`
}

export function minDate(a: ISODate, b: ISODate): ISODate { return a < b ? a : b }
export function maxDate(a: ISODate, b: ISODate): ISODate { return a > b ? a : b }

export function isValidISO(s: string | null | undefined): s is ISODate {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime())
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Nov 4' */
export function fmtShort(d: ISODate): string {
  const dt = toDate(d)
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`
}

/** 'Nov 4 – Nov 10, 2026' (year shown once when both ends share it). */
export function fmtRange(start: ISODate, end: ISODate): string {
  const ys = start.slice(0, 4)
  const ye = end.slice(0, 4)
  return ys === ye
    ? `${fmtShort(start)} – ${fmtShort(end)}, ${ye}`
    : `${fmtShort(start)}, ${ys} – ${fmtShort(end)}, ${ye}`
}

/** 'Nov 2–8' or 'Oct 26 – Nov 1' (compact, no year) for captions. */
export function fmtRangeCompact(start: ISODate, end: ISODate): string {
  const s = toDate(start)
  const e = toDate(end)
  if (s.getUTCMonth() === e.getUTCMonth()) return `${fmtShort(start)}–${e.getUTCDate()}`
  return `${fmtShort(start)} – ${fmtShort(end)}`
}
