/**
 * Source-agnostic glue between URL-style params and the pure compute layer.
 * planDashboard() says which date ranges are needed; assembleDashboard()
 * turns the fetched data into the view model. Used by the Next.js route
 * (lib/plg/load.ts, Supabase) and the claude.ai artifact (artifact/plg, Sigma).
 */
import { buildDashboard, type DailyPoint, type Meta, type RangeSummary } from './compute'
import type { QuarterGoals } from './config'
import { addDays, minDate, mondayOf, todayUTC, type ISODate } from './dates'
import { PRESETS, comparisonRange, resolveParams } from './range'

export type Range = [ISODate, ISODate]
export const SUMMARY_KEYS = ['cur', 'prev', 'qtd', 'wk', 'pwk'] as const
export const DAILY_KEYS = ['cur', 'prev', 'recent'] as const
export type SummaryKey = (typeof SUMMARY_KEYS)[number]
export type DailyKey = (typeof DAILY_KEYS)[number]

export function planDashboard(sp: URLSearchParams, dataEnd: ISODate, quarters: QuarterGoals[]) {
  const p = resolveParams(sp, dataEnd, quarters)
  const { prevStart, prevEnd } = comparisonRange(p.start, p.end, p.compare)
  const q = quarters.find(x => dataEnd >= x.start && dataEnd <= x.end)
  const qStart = q?.start ?? addDays(dataEnd, -89)
  // Commentary week = most recently completed Mon–Sun on or before dataEnd.
  const wkEnd = addDays(mondayOf(addDays(dataEnd, 1)), -1)
  const wkStart = addDays(wkEnd, -6)
  const summaries: Record<SummaryKey, Range> = {
    cur: [p.start, p.end],
    prev: [prevStart, prevEnd],
    qtd: [qStart, dataEnd],
    wk: [wkStart, wkEnd],
    pwk: [addDays(wkStart, -7), addDays(wkStart, -1)],
  }
  const dailies: Record<DailyKey, Range> = {
    cur: [p.start, p.end],
    prev: [prevStart, prevEnd],
    // Covers QTD (projection) and the last 14 days (guardrails / restatements).
    recent: [minDate(qStart, addDays(dataEnd, -20)), dataEnd],
  }
  return { params: p, dataEnd, quarters, summaries, dailies }
}

export type DashboardPlan = ReturnType<typeof planDashboard>

export function assembleDashboard(
  plan: DashboardPlan,
  meta: Meta,
  data: { summaries: Record<SummaryKey, RangeSummary>; dailies: Record<DailyKey, DailyPoint[]> },
  source: 'supabase' | 'fixture' | 'sigma',
) {
  const { params: p, summaries: S } = plan
  const view = buildDashboard({
    start: p.start, end: p.end, prevStart: S.prev[0], prevEnd: S.prev[1],
    compare: p.compare, grain: p.grain,
    presetLabel: p.preset ? PRESETS.find(x => x.id === p.preset)!.caption : null,
    today: todayUTC(), dataEnd: plan.dataEnd, quarters: plan.quarters,
    cur: data.summaries.cur, prev: data.summaries.prev,
    curDaily: data.dailies.cur, prevDaily: data.dailies.prev, recentDaily: data.dailies.recent,
    qtd: data.summaries.qtd,
    week: { start: S.wk[0], end: S.wk[1], cur: data.summaries.wk, prev: data.summaries.pwk },
    meta,
  })
  return { ...view, params: { preset: p.preset, compare: p.compare, grain: p.grain }, source }
}

export type DashboardPayload = ReturnType<typeof assembleDashboard>
