/**
 * Startup program view model. Pure: Sigma rows (sql.ts) in, render-ready numbers out.
 * Steps with no source are null and render "Not connected"; nothing substitutes a value.
 */
import type { ISODate } from '../dates'
import { STARTUP } from './sql'

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
  { k: null, rl: 'Visit → application', key: true, name: 'Applications', lever: 'Typeform', nc: NO_TYPEFORM },
  { h: 'Workspaces' },
  { k: 'newWs', p: 'visits', rl: 'Visit → workspace', name: 'Total new workspaces (all tiers)', lever: `Snowflake · CUSTOMERS · created within ${STARTUP.newWindowDays} days of the visit` },
  { k: 'newWsT13', p: 'newWs', rl: 'Share of all new workspaces', key: true, name: 'New workspaces (Tier 1–3)', lever: 'Snowflake · CUSTOMERS → Salesforce sales tier' },
  { k: null, rl: 'Share of all new workspaces', key: true, name: 'Eligible workspaces', lever: 'Venture-backed Pre-Seed to Series A, or a partner VC’s portfolio company',
    nc: 'Eligibility (funding stage and partner-VC portfolios) comes from a Snowflake source that isn’t hooked up yet' },
  { h: 'Email' },
  { k: null, rl: 'Send rate', name: 'Email sends', lever: 'Lifecycle (Inflection)', nc: NO_LIFECYCLE },
  { k: null, rl: 'Open rate', name: 'Email opens', lever: 'Lifecycle (Inflection)', nc: NO_LIFECYCLE },
  { h: 'Outcome' },
  { k: null, rl: 'Redemption rate', key: true, name: 'Offer redeemed', lever: 'Stripe discount', nc: 'No offer sent yet' },
  { k: 'activated', p: 'newWs', rl: 'Activation rate', key: true, name: 'Activated', lever: 'Snowflake · first table run within 7 days' },
  { k: null, rl: 'Paid rate', name: 'Paid (discounted price)', lever: 'Stripe · first discounted invoice paid', nc: 'No offer sent yet' },
]

export function buildStartup(o: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate]; dataEnd: ISODate; rows: Row[] }) {
  const T = period(o.rows, 'cur')
  const P = period(o.rows, 'prev')
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
    cur: o.cur, prev: o.prev, T, P, move,
    beforeLaunch: o.cur[1] < STARTUP.launch,
    rate,
  }
}
export type StartupViewModel = ReturnType<typeof buildStartup>
