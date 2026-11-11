/**
 * Pure calculation layer for the PLG dashboard. No I/O — takes the raw RPC
 * payloads and returns a render-ready view model. Kept pure so the math can be
 * checked against reference numbers (scripts/plg-check.ts).
 */
import {
  CHANNEL_DISPLAY, CHANNEL_GROUPS, GUARDRAILS, KNOWN_INCIDENTS, PACING, TIERS, UNASSIGNED_TIER_BUCKET,
  groupForCategory, type ChannelGroupId, type QuarterGoals, type Tier,
} from './config'
import {
  addDays, daysBetween, firstOfMonth, fmtRange, fmtRangeCompact, fmtShort, maxDate, minDate, mondayOf,
  type ISODate,
} from './dates'

// ── Raw payload types (shape of the Supabase RPCs) ──────────────────────────

export interface RangeSummary {
  channels: { c: string; ch: string; t: string; n: number }[]
  mcp: { s: string; n: number }[]
  quality: { q: string; n: number }[]
  domain: { s: string; n: number }[]
}
export interface DailyPoint { d: ISODate; n: number; unattr: number | null; hq: number | null; lowq: number | null }
export interface GoalRow { label: string; start: ISODate; end: ISODate; scope: 'quarter' | 'tier' | 'group'; key: string; value: number }
export interface Meta {
  min_day: ISODate | null
  max_day: ISODate | null
  last_ok_at: string | null
  last_run: { finished_at: string | null; status: string; message: string | null } | null
  restatements: { week_start: ISODate; old: number; new: number; at: string }[]
  recon_mismatches: { day: ISODate; facts: number; metrics: number }[]
  goals: GoalRow[]
}

export type Grain = 'day' | 'week' | 'month'
export type CompareMode = 'previous_period' | 'previous_year'

// ── Small helpers ───────────────────────────────────────────────────────────

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null)
const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null)

/** Map a stored sales_tier to a displayed tier (or null = not shown). */
export function displayTier(t: string): Tier | null {
  if ((TIERS as readonly string[]).includes(t)) return t as Tier
  return UNASSIGNED_TIER_BUCKET
}

// ── Goals ───────────────────────────────────────────────────────────────────

/** Merge Supabase goal rows over code defaults, keyed by quarter start. */
export function resolveQuarters(defaults: QuarterGoals[], rows: GoalRow[]): QuarterGoals[] {
  const byStart = new Map<string, QuarterGoals>(defaults.map(q => [q.start, structuredClone(q)]))
  for (const r of rows) {
    const start = String(r.start).slice(0, 10)
    let q = byStart.get(start)
    if (!q) {
      q = { label: r.label, start, end: String(r.end).slice(0, 10), quarterGoal: 0,
            tierWeekly: { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0, 'Tier 4': 0 }, groupWeekly: {} }
      byStart.set(start, q)
    }
    q.label = r.label
    q.end = String(r.end).slice(0, 10)
    const v = Number(r.value)
    if (r.scope === 'quarter') q.quarterGoal = v
    else if (r.scope === 'tier' && (TIERS as readonly string[]).includes(r.key)) q.tierWeekly[r.key as Tier] = v
    else if (r.scope === 'group') q.groupWeekly[r.key as ChannelGroupId] = v
  }
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start))
}

export function quarterFor(quarters: QuarterGoals[], d: ISODate): QuarterGoals | null {
  return quarters.find(q => d >= q.start && d <= q.end) ?? null
}

/**
 * Prorated goal for a date range: each day contributes weekly/7 from the
 * quarter that contains it. Returns null if any day has no configured goal.
 */
export function goalForRange(
  quarters: QuarterGoals[], start: ISODate, end: ISODate, pick: (q: QuarterGoals) => number | undefined,
): number | null {
  let total = 0
  for (const q of quarters) {
    const s = maxDate(start, q.start)
    const e = minDate(end, q.end)
    if (s > e) continue
    const weekly = pick(q)
    if (weekly == null) return null
    total += (weekly / 7) * daysBetween(s, e)
  }
  // Uncovered days → unknown goal
  const covered = quarters.reduce((acc, q) => {
    const s = maxDate(start, q.start); const e = minDate(end, q.end)
    return s > e ? acc : acc + daysBetween(s, e)
  }, 0)
  return covered === daysBetween(start, end) ? total : null
}

const tierTotalWeekly = (q: QuarterGoals) => sum(TIERS.map(t => q.tierWeekly[t]))

// ── Aggregations over a summary ─────────────────────────────────────────────

export interface ChannelRowData {
  key: string
  label: string
  cur: number
  prev: number
  delta: number
  deltaPct: number | null
  goal: number | null
  vsGoal: number | null
  tiers: number[] // aligned with TIERS
}

interface ChannelAgg { category: string; channel: string; n: number; tiers: number[] }

function aggregateChannels(s: RangeSummary): Map<string, ChannelAgg> {
  const m = new Map<string, ChannelAgg>()
  for (const r of s.channels) {
    const a = m.get(r.ch) ?? { category: r.c, channel: r.ch, n: 0, tiers: [0, 0, 0, 0] }
    a.n += r.n
    const t = displayTier(r.t)
    if (t) a.tiers[TIERS.indexOf(t)] += r.n
    m.set(r.ch, a)
  }
  return m
}

export function totalOf(s: RangeSummary): number {
  return sum(s.channels.map(r => r.n))
}

export function tierTotals(s: RangeSummary): number[] {
  const out = [0, 0, 0, 0]
  for (const r of s.channels) {
    const t = displayTier(r.t)
    if (t) out[TIERS.indexOf(t)] += r.n
  }
  return out
}

function mkRow(key: string, label: string, cur: number, prev: number, tiers: number[], goal: number | null): ChannelRowData {
  return {
    key, label, cur, prev, delta: cur - prev, deltaPct: pctChange(cur, prev),
    goal, vsGoal: goal != null && goal > 0 ? cur / goal : null, tiers,
  }
}

// ── Pacing status ───────────────────────────────────────────────────────────

export type PaceStatus = 'on_track' | 'at_risk' | 'behind'
export function paceStatus(pct: number): PaceStatus {
  if (pct >= PACING.onTrack) return 'on_track'
  if (pct >= PACING.atRisk) return 'at_risk'
  return 'behind'
}

// ── View model ──────────────────────────────────────────────────────────────

export interface DashboardInputs {
  start: ISODate
  end: ISODate
  prevStart: ISODate
  prevEnd: ISODate
  compare: CompareMode
  grain: Grain
  /** Preset label used in captions, e.g. 'last 7 days'. null = custom dates. */
  presetLabel: string | null
  today: ISODate
  dataEnd: ISODate
  quarters: QuarterGoals[]
  cur: RangeSummary
  prev: RangeSummary
  curDaily: DailyPoint[]
  prevDaily: DailyPoint[]
  /** Daily series covering at least [min(quarter start, dataEnd-13), dataEnd]. */
  recentDaily: DailyPoint[]
  /** Summary for current quarter start → dataEnd (tier QTD for commentary). */
  qtd: RangeSummary
  /** Last complete Mon–Sun week and the one before (commentary). */
  week: { start: ISODate; end: ISODate; cur: RangeSummary; prev: RangeSummary } | null
  meta: Meta
}

export interface TierPace {
  tier: Tier; actual: number; goal: number | null; pct: number | null
  status: PaceStatus | null; prevActual: number; deltaPct: number | null
}
export interface Projection {
  label: string; value: number; pctOfGoal: number | null; quarterGoal: number; qtdActual: number
  neededPerWeek: number | null; ratePerDay: number; daysRemaining: number
}

export function buildDashboard(i: DashboardInputs) {
  const days = daysBetween(i.start, i.end)
  const total = totalOf(i.cur)
  const prevTotal = totalOf(i.prev)

  // ── KPI: pace vs goal for the selected dates ───────────────────────────────
  const goal = goalForRange(i.quarters, i.start, i.end, tierTotalWeekly)

  // ── KPI: projected quarter finish (always the quarter containing dataEnd) ─
  const q = quarterFor(i.quarters, i.dataEnd)
  let projection: Projection | null = null
  if (q) {
    const qtdActual = sum(i.recentDaily.filter(p => p.d >= q.start && p.d <= i.dataEnd).map(p => p.n))
    const ratePerDay = total / days
    const daysRemaining = Math.max(0, daysBetween(addDays(i.dataEnd, 1), q.end))
    const raw = qtdActual + ratePerDay * daysRemaining
    const weeksRemaining = daysRemaining / 7
    projection = {
      label: q.label,
      value: Math.round(raw / 100) * 100,
      pctOfGoal: safeDiv(raw, q.quarterGoal),
      quarterGoal: q.quarterGoal,
      qtdActual,
      neededPerWeek: weeksRemaining > 0 ? Math.max(0, (q.quarterGoal - qtdActual) / weeksRemaining) : null,
      ratePerDay,
      daysRemaining,
    }
  }

  // ── KPI: tier 1–2 share ────────────────────────────────────────────────────
  const tCur = tierTotals(i.cur)
  const tPrev = tierTotals(i.prev)
  const t12 = tCur[0] + tCur[1]
  const goalMix = q ? safeDiv(q.tierWeekly['Tier 1'] + q.tierWeekly['Tier 2'], tierTotalWeekly(q)) : null

  // ── Tier pacing (actual ÷ prorated goal for the selected dates) ────────────
  const tiers: TierPace[] = TIERS.map((t, idx) => {
    const g = goalForRange(i.quarters, i.start, i.end, qq => qq.tierWeekly[t])
    const pct = g ? tCur[idx] / g : null
    return {
      tier: t, actual: tCur[idx], goal: g, pct,
      status: pct != null ? paceStatus(pct) : null,
      prevActual: tPrev[idx], deltaPct: pctChange(tCur[idx], tPrev[idx]),
    }
  })

  // ── Cumulative chart ───────────────────────────────────────────────────────
  const cumulative = buildCumulative(i)

  // ── Channel × tier table ───────────────────────────────────────────────────
  const table = buildChannelTable(i.cur, i.prev, i.quarters, i.start, i.end, goal)

  // ── MCP by platform ────────────────────────────────────────────────────────
  const mcp = buildMcp(i.cur, i.prev, total, prevTotal)

  // ── Domain quality mix + classification-shift detector ─────────────────────
  const quality = buildQuality(i.cur, i.prev, total, prevTotal)

  // ── Commentary (last complete week vs prior) ───────────────────────────────
  const commentary = i.week ? buildCommentary(i.week, i.qtd, i.quarters, i.dataEnd) : null

  // ── Data quality strip ─────────────────────────────────────────────────────
  const last7Start = addDays(i.dataEnd, -6)
  const unattrSpikes = i.recentDaily
    .filter(p => p.d >= last7Start && p.d <= i.dataEnd && p.n > 0)
    .map(p => ({ d: p.d, share: (p.unattr ?? 0) / p.n }))
    .filter(p => p.share > GUARDRAILS.unattributableDailyShare)
  const incidentsInRange = KNOWN_INCIDENTS
    .map(k => ({ ...k, dates: k.dates.filter(d => (d >= i.start && d <= i.end) || (d >= i.prevStart && d <= i.prevEnd)) }))
    .filter(k => k.dates.length)
  const settleCutoff = addDays(i.today, -GUARDRAILS.settleDays)

  return {
    range: {
      start: i.start, end: i.end, days, prevStart: i.prevStart, prevEnd: i.prevEnd,
      label: fmtRange(i.start, i.end), prevLabel: fmtRange(i.prevStart, i.prevEnd),
      compare: i.compare, grain: i.grain, presetLabel: i.presetLabel,
      settled: i.end <= settleCutoff,
      dataStart: i.meta.min_day, dataEnd: i.dataEnd, lastRefreshAt: i.meta.last_ok_at,
    },
    kpis: {
      total, prevTotal, deltaPct: pctChange(total, prevTotal),
      goal, paceVsGoal: goal ? total / goal : null,
      projection,
      tier12: { share: safeDiv(t12, total), count: t12, goalMix },
    },
    cumulative,
    tiers,
    table,
    mcp,
    quality,
    commentary,
    discuss: buildDiscuss(tiers, table, projection),
    dataQuality: {
      unattrSpikes,
      incidents: incidentsInRange,
      restatements: i.meta.restatements,
      reconMismatches: i.meta.recon_mismatches,
      lastRun: i.meta.last_run,
    },
  }
}

export type DashboardView = ReturnType<typeof buildDashboard>

// ── Sections ────────────────────────────────────────────────────────────────

function bucketStart(d: ISODate, grain: Grain): ISODate {
  if (grain === 'week') return mondayOf(d)
  if (grain === 'month') return firstOfMonth(d)
  return d
}

function buildCumulative(i: DashboardInputs) {
  const curBy = new Map(i.curDaily.map(p => [p.d, p.n]))
  const prevBy = new Map(i.prevDaily.map(p => [p.d, p.n]))
  const days = daysBetween(i.start, i.end)
  const prevDays = daysBetween(i.prevStart, i.prevEnd)
  const dailyGoal = (d: ISODate) => goalForRange(i.quarters, d, d, tierTotalWeekly)

  type Pt = { key: ISODate; label: string; start: ISODate; end: ISODate; actual: number; prev: number | null; goal: number | null }
  const points: Pt[] = []
  let cA = 0; let cP = 0; let cG: number | null = 0
  for (let k = 0; k < days; k++) {
    const d = addDays(i.start, k)
    cA += curBy.get(d) ?? 0
    if (k < prevDays) cP += prevBy.get(addDays(i.prevStart, k)) ?? 0
    const g = dailyGoal(d)
    cG = cG == null || g == null ? null : cG + g
    const b = bucketStart(d, i.grain)
    const last = points[points.length - 1]
    const label = i.grain === 'month'
      ? new Date(`${b}T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      : fmtShort(i.grain === 'week' ? maxDate(b, i.start) : d)
    const pt: Pt = { key: b, label, start: last && last.key === b ? last.start : d, end: d,
      actual: cA, prev: k < prevDays ? cP : null, goal: cG == null ? null : Math.round(cG) }
    if (last && last.key === b) points[points.length - 1] = pt
    else points.push(pt)
  }
  const goalTotal = goalForRange(i.quarters, i.start, i.end, tierTotalWeekly)
  return { points, goalTotal }
}

export function buildChannelTable(
  cur: RangeSummary, prev: RangeSummary, quarters: QuarterGoals[], start: ISODate, end: ISODate, totalGoal: number | null,
) {
  const c = aggregateChannels(cur)
  const p = aggregateChannels(prev)
  const keys = new Set([...c.keys(), ...p.keys()])

  const groups = CHANNEL_GROUPS.map(g => {
    const children: ChannelRowData[] = []
    for (const k of keys) {
      const a = c.get(k); const b = p.get(k)
      const category = a?.category ?? b?.category ?? 'undefined'
      if (groupForCategory(category) !== g.id) continue
      children.push(mkRow(k, CHANNEL_DISPLAY[k] ?? k, a?.n ?? 0, b?.n ?? 0, a?.tiers ?? [0, 0, 0, 0], null))
    }
    children.sort((x, y) => y.cur - x.cur || y.prev - x.prev || x.label.localeCompare(y.label))
    const gGoal = goalForRange(quarters, start, end, q => q.groupWeekly[g.id])
    const row = mkRow(g.id, g.label,
      sum(children.map(r => r.cur)), sum(children.map(r => r.prev)),
      TIERS.map((_, idx) => sum(children.map(r => r.tiers[idx]))),
      gGoal && gGoal > 0 ? gGoal : null)
    return { id: g.id, row, children }
  }).filter(g => g.children.length)

  const total = mkRow('total', 'Total', sum(groups.map(g => g.row.cur)), sum(groups.map(g => g.row.prev)),
    TIERS.map((_, idx) => sum(groups.map(g => g.row.tiers[idx]))), totalGoal)
  return { groups, total }
}

const MCP_PREFIX = 'OAuth: MCP: '
function buildMcp(cur: RangeSummary, prev: RangeSummary, total: number, prevTotal: number) {
  const by = (s: RangeSummary) => new Map(s.mcp.map(r => [r.s.startsWith(MCP_PREFIX) ? r.s.slice(MCP_PREFIX.length) : r.s, r.n]))
  const c = by(cur); const p = by(prev)
  const names = new Set([...c.keys(), ...p.keys()])
  const rows = [...names].map(name => ({ platform: name, cur: c.get(name) ?? 0, delta: (c.get(name) ?? 0) - (p.get(name) ?? 0) }))
    .sort((a, b) => b.cur - a.cur || a.platform.localeCompare(b.platform))
  const mcpCur = sum([...c.values()]); const mcpPrev = sum([...p.values()])
  return { rows, total: mcpCur, share: safeDiv(mcpCur, total), prevShare: safeDiv(mcpPrev, prevTotal) }
}

const QUALITY_ROWS: { key: string; label: string; core: boolean }[] = [
  { key: 'personal', label: 'Personal', core: true },
  { key: 'non-personal: high quality', label: 'Non-personal: high quality', core: true },
  { key: 'non-personal: low quality', label: 'Non-personal: low quality', core: true },
  { key: 'spam', label: 'Spam', core: true },
  { key: 'not available', label: 'Not available', core: false },
]

function qualityCounts(s: RangeSummary) {
  const m = new Map(s.quality.map(r => [r.q, r.n]))
  return { get: (k: string) => m.get(k) ?? 0 }
}

export function detectClassificationShift(
  cur: { hq: number; lowq: number; total: number }, prev: { hq: number; lowq: number },
) {
  const hqNp = safeDiv(cur.hq, cur.hq + cur.lowq)
  const prevHqNp = safeDiv(prev.hq, prev.hq + prev.lowq)
  const lowShare = safeDiv(cur.lowq, cur.total)
  const shiftPp = hqNp != null && prevHqNp != null ? (hqNp - prevHqNp) * 100 : null
  const fired = (shiftPp != null && Math.abs(shiftPp) >= GUARDRAILS.hqShareShiftPp) ||
    (lowShare != null && lowShare > GUARDRAILS.lowQualityShareOfTotal)
  // HQ workspaces that "moved" to low-Q: what HQ would be at last period's HQ/NP ratio, minus actual.
  const reclassified = prevHqNp != null ? Math.max(0, Math.round(prevHqNp * (cur.hq + cur.lowq) - cur.hq)) : 0
  return { fired, shiftPp, hqOfNonPersonal: hqNp, prevHqOfNonPersonal: prevHqNp, reclassified }
}

function buildQuality(cur: RangeSummary, prev: RangeSummary, total: number, prevTotal: number) {
  const c = qualityCounts(cur); const p = qualityCounts(prev)
  const rows = QUALITY_ROWS
    .filter(r => r.core || c.get(r.key) >= GUARDRAILS.domainMinCount)
    .map(r => ({ key: r.key, label: r.label, cur: c.get(r.key), delta: c.get(r.key) - p.get(r.key), deltaPct: pctChange(c.get(r.key), p.get(r.key)) }))
  const hq = c.get('non-personal: high quality'); const lowq = c.get('non-personal: low quality')
  const pHq = p.get('non-personal: high quality'); const pLowq = p.get('non-personal: low quality')
  const shift = detectClassificationShift({ hq, lowq, total }, { hq: pHq, lowq: pLowq })
  const dom = (s: RangeSummary) => s.domain.find(r => r.s === 'non_personal')?.n ?? null
  return {
    rows,
    hqShare: safeDiv(hq, total), prevHqShare: safeDiv(pHq, prevTotal),
    lowShare: safeDiv(lowq, total), prevLowShare: safeDiv(pLowq, prevTotal),
    shift,
    // CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT cross-check (independent of quality scoring)
    domainCheck: { nonPersonal: dom(cur), prevNonPersonal: dom(prev), scoredNonPersonal: hq + lowq, prevScoredNonPersonal: pHq + pLowq },
  }
}

// ── Commentary ──────────────────────────────────────────────────────────────

export interface Bullet { lead: string; body: string; kind?: 'shift' | 'tier' }

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')
const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtInt(Math.abs(n))
const fmtPctSigned = (p: number | null) => (p == null ? 'new' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p * 100).toFixed(1) + '%')
const mv = (label: string, d: number, p: number | null) => `${label} ${fmtSigned(d)} (${fmtPctSigned(p)})`

export function buildCommentary(
  week: NonNullable<DashboardInputs['week']>, qtd: RangeSummary, quarters: QuarterGoals[], dataEnd: ISODate,
) {
  const prevStart = addDays(week.start, -7)
  const prevEnd = addDays(week.start, -1)
  const c = aggregateChannels(week.cur)
  const p = aggregateChannels(week.prev)
  const total = totalOf(week.cur); const prevTotal = totalOf(week.prev)

  // Movers: every channel except OAuth: MCP (represented by its platforms instead).
  type Mover = { label: string; group: ChannelGroupId; delta: number; pct: number | null }
  const movers: Mover[] = []
  for (const k of new Set([...c.keys(), ...p.keys()])) {
    if (k === 'OAuth: MCP') continue
    const a = c.get(k)?.n ?? 0; const b = p.get(k)?.n ?? 0
    movers.push({ label: CHANNEL_DISPLAY[k] ?? k, group: groupForCategory(c.get(k)?.category ?? p.get(k)?.category ?? null), delta: a - b, pct: pctChange(a, b) })
  }
  const mc = new Map(week.cur.mcp.map(r => [r.s, r.n])); const mp = new Map(week.prev.mcp.map(r => [r.s, r.n]))
  for (const k of new Set([...mc.keys(), ...mp.keys()])) {
    const a = mc.get(k) ?? 0; const b = mp.get(k) ?? 0
    const name = k.startsWith(MCP_PREFIX) ? k.slice(MCP_PREFIX.length) : k
    const pretty = name === 'chatgpt' ? 'ChatGPT' : name === 'anthropic' ? 'Anthropic' : name.charAt(0).toUpperCase() + name.slice(1)
    movers.push({ label: `${pretty} MCP`, group: 'oauth', delta: a - b, pct: pctChange(a, b) })
  }
  const top = movers.filter(m => Math.abs(m.delta) >= GUARDRAILS.commentaryMinAbsDelta)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5)

  const table = buildChannelTable(week.cur, week.prev, quarters, week.start, week.end, null)
  const groupRow = (id: ChannelGroupId) => table.groups.find(g => g.id === id)?.row

  // Cluster same-direction movers within a group into one bullet, largest first.
  const clusters = new Map<string, Mover[]>()
  for (const m of top) {
    const key = `${m.group}:${m.delta > 0 ? 'up' : 'down'}`
    clusters.set(key, [...(clusters.get(key) ?? []), m])
  }
  const bullets: Bullet[] = []
  for (const [key, ms] of clusters) {
    const [gid, dir] = key.split(':') as [ChannelGroupId, 'up' | 'down']
    const g = groupRow(gid)
    const glabel = CHANNEL_GROUPS.find(x => x.id === gid)!.label
    const [lead, ...rest] = ms
    const parts: string[] = []
    if (rest.length) parts.push(`${rest.map(m => mv(m.label, m.delta, m.pct)).join(', ')}.`)
    // Opposite-direction movers in the same group (below the top-5 cut) for context.
    const opp = movers.filter(m => m.group === gid && (dir === 'up' ? m.delta < 0 : m.delta > 0) &&
      Math.abs(m.delta) >= GUARDRAILS.commentaryMinAbsDelta && !top.includes(m))
    if (opp.length) parts.push(`Offset by ${opp.map(m => mv(m.label, m.delta, m.pct)).join(', ')}.`)
    if (g) parts.push(`${glabel} overall ${fmtSigned(g.delta)} (${fmtPctSigned(g.deltaPct)}).`)
    if (gid === 'oauth') {
      const mcpCur = [...mc.values()].reduce((a, b) => a + b, 0); const mcpPrev = [...mp.values()].reduce((a, b) => a + b, 0)
      const s = safeDiv(mcpCur, total); const ps = safeDiv(mcpPrev, prevTotal)
      if (s != null && ps != null) parts.push(`MCP OAuth share of all workspaces ${s >= ps ? 'rose' : 'fell'} to ${(s * 100).toFixed(1)}% (from ${(ps * 100).toFixed(1)}%).`)
    }
    bullets.push({ lead: mv(lead.label, lead.delta, lead.pct), body: parts.join(' ') })
  }
  if (!bullets.length) {
    bullets.push({ lead: `Total ${fmtSigned(total - prevTotal)} (${fmtPctSigned(pctChange(total, prevTotal))})`,
      body: `No channel moved by ${GUARDRAILS.commentaryMinAbsDelta}+ workspaces week over week.` })
  }

  // Classification shift — mandatory bullet; HQ-share commentary suppressed.
  const qc = qualityCounts(week.cur); const qp = qualityCounts(week.prev)
  const shift = detectClassificationShift(
    { hq: qc.get('non-personal: high quality'), lowq: qc.get('non-personal: low quality'), total },
    { hq: qp.get('non-personal: high quality'), lowq: qp.get('non-personal: low quality') })
  if (shift.fired) {
    bullets.push({
      kind: 'shift',
      lead: 'HQ share drop is almost certainly a classification change, not a real quality collapse',
      body: `~${fmtInt(shift.reclassified)} non-personal workspaces moved HQ → low-quality while total non-personal volume was roughly flat. Confirm with data-eng before interpreting HQ share.`,
    })
  }

  // Tier furthest behind QTD pace.
  const q = quarterFor(quarters, dataEnd)
  if (q) {
    const qt = tierTotals(qtd)
    const paced = TIERS.map((t, idx) => {
      const g = goalForRange(quarters, q.start, dataEnd, qq => qq.tierWeekly[t])
      return { t, idx, actual: qt[idx], goal: g, pct: g ? qt[idx] / g : null }
    }).filter(x => x.pct != null)
    const worst = paced.sort((a, b) => a.pct! - b.pct!)[0]
    if (worst && worst.pct! < PACING.onTrack) {
      // Which channels moved this tier most week over week
      const tierMovers = [...new Set([...c.keys(), ...p.keys()])].map(k => {
        const a = c.get(k)?.tiers[worst.idx] ?? 0; const b = p.get(k)?.tiers[worst.idx] ?? 0
        return { label: CHANNEL_DISPLAY[k] ?? k, delta: a - b, cur: a }
      }).sort((a, b) => a.delta - b.delta)
      const largest = [...tierMovers].sort((a, b) => b.cur - a.cur).slice(0, 2)
      const dropping = tierMovers.filter(m => m.delta < 0).slice(0, 2)
      bullets.push({
        kind: 'tier',
        lead: `${worst.t} is furthest behind pace`,
        body: `QTD ${fmtInt(worst.actual)} of ${fmtInt(worst.goal!)} expected (${Math.round(worst.pct! * 100)}%). ` +
          `Largest ${worst.t} sources this week: ${largest.map(m => `${m.label} ${fmtInt(m.cur)}`).join(', ')}.` +
          (dropping.length ? ` Biggest ${worst.t} declines: ${dropping.map(m => `${m.label} ${fmtSigned(m.delta)}`).join(', ')}.` : ''),
      })
    }
  }

  return {
    start: week.start, end: week.end, prevStart, prevEnd,
    label: `${fmtRangeCompact(week.start, week.end)} vs ${fmtRangeCompact(prevStart, prevEnd)}`,
    bullets,
  }
}

function buildDiscuss(
  tiers: TierPace[],
  table: ReturnType<typeof buildChannelTable>,
  projection: Projection | null,
): string[] {
  const worst = tiers.filter(t => t.pct != null).sort((a, b) => a.pct! - b.pct!)[0]
  const declining = [...table.groups].filter(g => g.id !== 'unattributed').sort((a, b) => a.row.delta - b.row.delta)[0]
  const out = [
    worst ? `${worst.tier} is furthest behind pace (${Math.round(worst.pct! * 100)}% of goal). Which channel owns the gap?`
      : 'Which tier is furthest behind pace, and which channel owns the gap?',
  ]
  if (declining && declining.row.delta < 0) {
    const worstKids = [...declining.children].sort((a, b) => a.delta - b.delta).slice(0, 2).map(c => c.label.replace(/^[^:]+: /, ''))
    out.push(`Is the ${declining.row.label} decline a one-time dip or a trend? What's the plan for ${worstKids.join(' and ')}?`)
  }
  if (projection?.neededPerWeek != null) {
    out.push(`Do we need ${fmtInt(projection.neededPerWeek)}/wk to hit the ${projection.label} goal, or do we re-forecast?`)
  }
  return out
}
