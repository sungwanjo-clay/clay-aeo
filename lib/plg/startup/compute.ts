/**
 * Startup program view model. Pure: Sigma rows (sql.ts) in, render-ready numbers out.
 * Steps with no source are null and render "Not connected"; nothing substitutes a value.
 */
import { addDays, daysBetween, type ISODate } from '../dates'
import { STARTUP } from './sql'
import { driverPara, headlineLine, type Insight, type Item, type Para } from '../insights'

type Row = { k: string; b: string; d: string; n: number; a: number; p: number; x: number; c: number }

export function parseStartupRows(payload: unknown): Row[] {
  const tbl = payload as { columns: string[]; rows: unknown[][] }
  if (!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(tbl.columns.map((c, i) => [c, i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return tbl.rows.map(r => ({ k: s(r, 'k'), b: s(r, 'b'), d: s(r, 'd'), n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c') }))
}

export const MQAL_TIERS = ['Tier 1', 'Tier 2', 'Tier 3'] as const
/** Why an identified visitor isn't an MQAL, in display order. */
export const NOT_QUALIFIED = ['Tier 4', 'No Salesforce account', 'Personal email', 'Academic', 'Invalid or missing domain'] as const
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function period(rows: Row[], b: 'cur' | 'prev') {
  const rs = rows.filter(r => r.b === b)
  const vis = rs.find(r => r.k === 'vis')
  const ws = rs.find(r => r.k === 'ws')
  const cls = (d: string) => rs.find(r => r.k === 'cls' && r.d === d) ?? { n: 0, a: 0, p: 0, x: 0, c: 0 }
  const mqn = (t: string) => rs.find(r => r.k === 'mqn' && r.d === t)?.n ?? 0
  // MQAL = a Tier 1–3 company domain with a new workspace from a startup-page visitor (same basis as the funnel).
  const tiers = MQAL_TIERS.map(t => ({ tier: t, mqal: mqn(t), people: cls(t).a, newWs: cls(t).p }))
  return {
    visits: vis?.n ?? 0, identified: vis?.a ?? 0,
    mqal: sum(tiers.map(t => t.mqal)), tiers,
    newWs: ws?.n ?? 0, activated: ws?.a ?? 0, paid: ws?.p ?? 0, active: ws?.x ?? 0, eligible: ws?.c ?? 0,
    newWsT13: sum(tiers.map(t => t.newWs)),
    /** New workspaces outside Tier 1–3, by reason. */
    reasons: NOT_QUALIFIED.map(r => ({ reason: r, people: cls(r).p })).filter(r => r.people > 0).sort((a, b) => b.people - a.people),
    campaigns: rs.filter(r => r.k === 'cmp').map(r => {
      const [platform, ...rest] = r.d.split('|')
      return { platform, campaign: rest.join('|'), visits: r.n, mqal: r.a, newWs: r.p }
    }).sort((a, b) => b.visits - a.visits),
  }
}
export type StartupPeriod = ReturnType<typeof period>

/** k = key into the period, p = previous step (rate base). nc = no source yet (renders Not connected). */
export type FunnelStep =
  | { h: string; n?: string }
  | { k: keyof StartupPeriod | null; p?: keyof StartupPeriod; rl?: string; key?: boolean; name: string; lever: string; nc?: string }

const NO_TYPEFORM = `Applications come in through a Typeform (${STARTUP.applyUrl}) whose responses aren’t in Snowflake yet`
const NO_LIFECYCLE = 'No offer sent yet, and lifecycle email isn’t in Snowflake'
export const STEPS: FunnelStep[] = [
  { h: 'Site' },
  { k: 'visits', name: 'Visits', lever: 'Snowflake · MARKETING_PAGEVIEWS (www.clay.com/clay-for-startups)' },
  { k: null, rl: 'Application rate', key: true, name: 'Applications', lever: 'Typeform', nc: NO_TYPEFORM },
  { h: 'Workspaces' },
  { k: 'newWs', p: 'visits', rl: 'Visit → workspace', name: 'Total new workspaces (all tiers)', lever: `Snowflake · CUSTOMERS · created within ${STARTUP.newWindowDays} days of the visit` },
  { k: 'newWsT13', p: 'newWs', rl: 'Share of all new workspaces', key: true, name: 'New workspaces (Tier 1–3)', lever: 'Snowflake · CUSTOMERS → Salesforce sales tier' },
  { k: null, rl: 'Share of all new workspaces', key: true, name: 'Eligible workspaces', lever: 'Startup Offer Eligibility · verified Seed or Series A, VC-backed, net-new workspace',
    nc: 'Eligibility comes from the eligibility workflow’s weekly snapshot in Snowflake, which isn’t hooked up yet' },
  { h: 'Email' },
  { k: null, name: 'Email sends', lever: 'Lifecycle (Inflection) · offer emails sent', nc: NO_LIFECYCLE },
  { k: null, rl: 'Email open rate', name: 'Email opens', lever: 'Lifecycle (Inflection) · offer emails opened', nc: NO_LIFECYCLE },
  { k: null, rl: 'Email click-through rate', name: 'Email clicks', lever: 'Lifecycle (Inflection) · clicks in offer emails', nc: NO_LIFECYCLE },
  { h: 'Outcome' },
  { k: null, rl: 'Redemption rate', key: true, name: 'Offer redeemed', lever: 'Stripe discount applied', nc: 'No offer sent yet' },
  { k: 'activated', p: 'newWs', rl: 'Activation rate', key: true, name: 'Activated workspaces', lever: 'Snowflake · first table run within 7 days' },
  { k: 'paid', p: 'newWs', rl: 'Paid rate', name: 'Paying workspaces', lever: 'Snowflake · CUSTOMERS first invoice (the discounted price once the offer launches)' },
]

/** Enablement after redemption: the educational email series and how much of it each redeemer completes. */
export const ENABLEMENT = [
  { label: 'Enablement emails sent', def: 'Educational emails sent after a workspace redeems the offer', nc: 'The enablement series isn’t built yet; sends will come from Lifecycle (Inflection)' },
  { label: 'Email open rate', def: 'Enablement emails opened ÷ sent', nc: 'Lifecycle email events aren’t in Snowflake yet' },
  { label: 'Email click-through rate', def: 'Clicks to the material ÷ opens', nc: 'Lifecycle email events aren’t in Snowflake yet' },
  { label: 'Material completed', def: 'Share of the videos and lessons sent that each redeemer finished, averaged across redeemers', nc: 'Needs a completion source for the videos (watch progress) and lessons' },
  { label: 'Redeemers who finished everything', def: 'Redeemed workspaces that completed every piece sent', nc: 'Needs the same completion source' },
] as const

/** Daily series for one range: visits (by visit day), and new workspaces, MQAL domains and activated (by first visit day). */
function daily(rows: Row[], b: 'cur' | 'prev', range: [ISODate, ISODate]) {
  const v = new Map(rows.filter(r => r.k === 'dv' && r.b === b).map(r => [r.d.slice(0, 10), r.n]))
  const w = new Map(rows.filter(r => r.k === 'dw' && r.b === b).map(r => [r.d.slice(0, 10), r]))
  const n = daysBetween(range[0], range[1]) + 1
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const d = addDays(range[0], i); const x = w.get(d)
    return { d, visits: v.get(d) ?? 0, newWs: x?.n ?? 0, activated: x?.a ?? 0, mqal: x?.p ?? 0 }
  })
}
export type StartupDay = ReturnType<typeof daily>[number]

export function buildStartup(o: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate]; dataEnd: ISODate; rows: Row[] }) {
  const T = period(o.rows, 'cur')
  const P = period(o.rows, 'prev')
  // Daily rows arrived with the progress chart; an older cached result has none (the chart then says so).
  const hasDaily = o.rows.some(r => r.k === 'dv')
  const days = { cur: hasDaily ? daily(o.rows, 'cur', o.cur) : [], prev: hasDaily ? daily(o.rows, 'prev', o.prev) : [] }
  const rate = (t: StartupPeriod, k: keyof StartupPeriod, p: keyof StartupPeriod) => {
    const den = t[p] as number
    return den >= 1 ? (t[k] as number) / den : null
  }
  // Biggest rate change (largest relative drop) among steps with a rate in both periods.
  let move: { name: string; rl: string; r: number; pr: number; rel: number } | null = null
  for (const s of STEPS) {
    if (!('name' in s) || !s.k || !s.p) continue
    const r = rate(T, s.k, s.p); const pr = rate(P, s.k, s.p)
    if (r == null || pr == null || pr === 0) continue
    const rel = r / pr - 1
    if (!move || rel < move.rel) move = { name: s.name, rl: s.rl!, r, pr, rel }
  }
  return {
    cur: o.cur, prev: o.prev, T, P, move, days, insight: startupInsight(T, P),
    beforeLaunch: o.cur[1] < STARTUP.launch,
    rate,
  }
}
export type StartupViewModel = ReturnType<typeof buildStartup>

/** What moved on the startup program (lib/plg/insights.ts rules). Drivers are the paid platforms and campaigns. */
function startupInsight(T: StartupPeriod, P: StartupPeriod): Insight {
  if (T.visits < 1 && P.visits < 1) return { headline: [], drivers: [], emerging: [], anomalies: [], goals: [], empty: 'No startup-page visits in either period.' }
  const r = (n: number, d: number) => (d >= 1 ? n / d : null)
  const headline = [
    headlineLine('Visits', T.visits, P.visits),
    headlineLine('New workspaces', T.newWs, P.newWs),
    headlineLine('MQALs (Tier 1–3 domains)', T.mqal, P.mqal),
    headlineLine('Visit → workspace', r(T.newWs, T.visits), r(P.newWs, P.visits), { kind: 'rate' }),
    headlineLine('Activation rate', r(T.activated, T.newWs), r(P.activated, P.newWs), { kind: 'rate' }),
    headlineLine('Paid rate', r(T.paid, T.newWs), r(P.paid, P.newWs), { kind: 'rate' }),
  ]
  const camp = (x: StartupPeriod['campaigns'][number]) => `${x.platform}${x.campaign && x.campaign !== '(no campaign)' ? ` · ${x.campaign}` : ' · no campaign'}`
  const items = (f: (x: StartupPeriod['campaigns'][number]) => number) => {
    const m = new Map<string, Item>()
    for (const x of T.campaigns) m.set(camp(x), { label: camp(x), cur: f(x), prev: 0 })
    for (const x of P.campaigns) { const k = camp(x); const it = m.get(k) ?? { label: k, cur: 0, prev: 0 }; it.prev = f(x); m.set(k, it) }
    return [...m.values()]
  }
  const drivers = [
    driverPara('Visits', 'visits', { cur: T.visits, prev: P.visits }, items(x => x.visits), { minVolume: 5, noun: 'campaigns' }),
    driverPara('New workspaces', 'workspaces', { cur: T.newWs, prev: P.newWs }, items(x => x.newWs), { noun: 'campaigns' }),
  ].filter((p): p is Para => !!p)
  const lowVol = T.visits < 20 ? 'Fewer than 20 visits this period, so rates swing on a handful of people.' : null
  return { note: lowVol, headline, drivers, emerging: [], anomalies: [], goals: [] }
}
