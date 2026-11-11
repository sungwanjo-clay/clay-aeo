import { plgDb } from './db'
import { buildDashboard, resolveQuarters, type DailyPoint, type Meta, type RangeSummary } from './compute'
import { DEFAULT_QUARTERS } from './config'
import { addDays, minDate, mondayOf, todayUTC, type ISODate } from './dates'
import { PRESETS, comparisonRange, resolveParams } from './range'

/** Where the dashboard reads aggregated data from. */
export interface PlgSource {
  kind: 'supabase' | 'fixture'
  meta(): Promise<Meta>
  summary(start: ISODate, end: ISODate): Promise<RangeSummary>
  daily(start: ISODate, end: ISODate): Promise<DailyPoint[]>
}

export function supabaseSource(): PlgSource {
  const db = plgDb()
  const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data as T
  }
  return {
    kind: 'supabase',
    meta: () => call<Meta>('plg_meta'),
    summary: (s, e) => call<RangeSummary>('plg_range_summary', { p_start: s, p_end: e }),
    daily: (s, e) => call<DailyPoint[]>('plg_daily_series', { p_start: s, p_end: e }),
  }
}

export class NoDataError extends Error {}

export async function loadDashboard(sp: URLSearchParams, source: PlgSource) {
  const meta = await source.meta()
  if (!meta.max_day) throw new NoDataError('No PLG data loaded yet. Run /api/plg/refresh?from=2025-10-01 once to backfill.')
  const dataEnd = String(meta.max_day).slice(0, 10)
  const quarters = resolveQuarters(DEFAULT_QUARTERS, meta.goals ?? [])
  const p = resolveParams(sp, dataEnd, quarters)
  const { prevStart, prevEnd } = comparisonRange(p.start, p.end, p.compare)

  const q = quarters.find(x => dataEnd >= x.start && dataEnd <= x.end)
  const qStart = q?.start ?? addDays(dataEnd, -89)
  const recentStart = minDate(qStart, addDays(dataEnd, -13))

  // Commentary week = most recently completed Mon–Sun on or before dataEnd.
  const wkEnd = addDays(mondayOf(addDays(dataEnd, 1)), -1)
  const wkStart = addDays(wkEnd, -6)

  const [cur, prev, curDaily, prevDaily, recentDaily, qtd, wCur, wPrev] = await Promise.all([
    source.summary(p.start, p.end),
    source.summary(prevStart, prevEnd),
    source.daily(p.start, p.end),
    source.daily(prevStart, prevEnd),
    source.daily(recentStart, dataEnd),
    source.summary(qStart, dataEnd),
    source.summary(wkStart, wkEnd),
    source.summary(addDays(wkStart, -7), addDays(wkStart, -1)),
  ])

  const view = buildDashboard({
    start: p.start, end: p.end, prevStart, prevEnd,
    compare: p.compare, grain: p.grain,
    presetLabel: p.preset ? PRESETS.find(x => x.id === p.preset)!.caption : null,
    today: todayUTC(), dataEnd, quarters,
    cur, prev, curDaily, prevDaily, recentDaily, qtd,
    week: { start: wkStart, end: wkEnd, cur: wCur, prev: wPrev },
    meta,
  })
  return { ...view, params: { preset: p.preset, compare: p.compare, grain: p.grain }, source: source.kind }
}

export type DashboardPayload = Awaited<ReturnType<typeof loadDashboard>>
