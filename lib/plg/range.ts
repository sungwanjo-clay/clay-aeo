import { addDays, daysBetween, isValidISO, maxDate, minDate, type ISODate } from './dates'
import type { CompareMode, Grain } from './compute'
import type { QuarterGoals } from './config'

export const PRESETS = [
  { id: 'last7',  label: 'Last 7 days',     caption: "last 7 days'" },
  { id: 'last28', label: 'Last 28 days',    caption: "last 28 days'" },
  { id: 'last90', label: 'Last 90 days',    caption: "last 90 days'" },
  { id: 'qtd',    label: 'Quarter to date', caption: 'quarter-to-date' },
  { id: 'ytd',    label: 'Year to date',    caption: 'year-to-date' },
] as const
export type PresetId = (typeof PRESETS)[number]['id']

export const COMPARE_OPTIONS: { id: CompareMode; label: string }[] = [
  { id: 'previous_period', label: 'Previous period' },
  { id: 'previous_year',   label: 'Same period last year' },
]

export const GRAINS: { id: Grain; label: string }[] = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
]

/** Presets anchor on the last complete day of data, never today. */
export function presetRange(id: PresetId, dataEnd: ISODate, quarters: QuarterGoals[]): { start: ISODate; end: ISODate } {
  switch (id) {
    case 'last7':  return { start: addDays(dataEnd, -6), end: dataEnd }
    case 'last28': return { start: addDays(dataEnd, -27), end: dataEnd }
    case 'last90': return { start: addDays(dataEnd, -89), end: dataEnd }
    case 'qtd': {
      const q = quarters.find(x => dataEnd >= x.start && dataEnd <= x.end)
      return { start: q?.start ?? addDays(dataEnd, -89), end: dataEnd }
    }
    case 'ytd': return { start: `${dataEnd.slice(0, 4)}-01-01`, end: dataEnd }
  }
}

export function comparisonRange(start: ISODate, end: ISODate, mode: CompareMode) {
  if (mode === 'previous_year') {
    // 364 days keeps weekdays aligned (weekend dips line up).
    return { prevStart: addDays(start, -364), prevEnd: addDays(end, -364) }
  }
  const len = daysBetween(start, end)
  return { prevStart: addDays(start, -len), prevEnd: addDays(start, -1) }
}

export interface RangeParams {
  preset: PresetId | null
  start: ISODate
  end: ISODate
  compare: CompareMode
  grain: Grain
}

/** Parse + clamp query params. Custom dates win over preset when both given. */
export function resolveParams(sp: URLSearchParams, dataEnd: ISODate, quarters: QuarterGoals[]): RangeParams {
  const compare = (COMPARE_OPTIONS.some(c => c.id === sp.get('compare')) ? sp.get('compare') : 'previous_period') as CompareMode
  const grain = (GRAINS.some(g => g.id === sp.get('grain')) ? sp.get('grain') : 'day') as Grain
  const s = sp.get('start'); const e = sp.get('end')
  if (isValidISO(s) && isValidISO(e)) {
    let start = minDate(s, e); let end = maxDate(s, e)
    end = minDate(end, dataEnd)
    start = minDate(start, end)
    return { preset: null, start, end, compare, grain }
  }
  const preset = (PRESETS.some(p => p.id === sp.get('preset')) ? sp.get('preset') : 'last7') as PresetId
  return { preset, ...presetRange(preset, dataEnd, quarters), compare, grain }
}
