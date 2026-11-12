import { plgDb } from './db'
import { resolveQuarters, type DailyPoint, type Meta, type RangeSummary } from './compute'
import { DEFAULT_QUARTERS } from './config'
import type { ISODate } from './dates'
import { DAILY_KEYS, SUMMARY_KEYS, assembleDashboard, planDashboard, type DailyKey, type SummaryKey } from './plan'

export type { DashboardPayload } from './plan'

/** Where the Next.js dashboard reads aggregated data from. */
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
  const quarters = resolveQuarters(DEFAULT_QUARTERS, meta.goals ?? [])
  const plan = planDashboard(sp, String(meta.max_day).slice(0, 10), quarters)
  const [summaries, dailies] = await Promise.all([
    Promise.all(SUMMARY_KEYS.map(k => source.summary(...plan.summaries[k]))),
    Promise.all(DAILY_KEYS.map(k => source.daily(...plan.dailies[k]))),
  ])
  return assembleDashboard(plan, meta, {
    summaries: Object.fromEntries(SUMMARY_KEYS.map((k, i) => [k, summaries[i]])) as Record<SummaryKey, RangeSummary>,
    dailies: Object.fromEntries(DAILY_KEYS.map((k, i) => [k, dailies[i]])) as Record<DailyKey, DailyPoint[]>,
  }, source.kind)
}
