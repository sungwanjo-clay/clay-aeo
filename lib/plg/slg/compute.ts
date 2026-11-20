/**
 * View models for the SLG pieces: PLG-sourced pipeline (Workspaces tab) and the Tier 4 tab.
 * Pure: Sigma rows (sql.ts, tier4sql.ts) in, render-ready numbers out. Rows are already relabelled to cur / prev.
 */
import { b, code, driverPara, ratePara, type Block, type Insight, type Item, type Para } from '../insights'
import { PLG_PLAYS, type PlgGroup } from './sql'
import type { CompanyRow, Firm } from '../portfolio/data'

type Tbl = { columns: string[]; rows: unknown[][] }
function table(payload: unknown): Tbl {
  const t = payload as Tbl
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new Error('Unexpected Sigma response shape')
  return t
}
/** Rows as objects keyed by lower-case column name; numeric-looking columns listed in `nums` become numbers. */
function objects(payload: unknown, nums: string[]): Record<string, unknown>[] {
  const t = table(payload)
  const cols = t.columns.map(c => String(c).toLowerCase())
  const isNum = new Set(nums.map(n => n.toLowerCase()))
  return t.rows.map(r => Object.fromEntries(cols.map((c, i) => [c, isNum.has(c) ? Number(r[i] ?? 0) || 0 : r[i] == null ? null : String(r[i])])))
}

// ── PLG-sourced pipeline ───────────────────────────────────────────────────

export type SlgCounts = { mqal: number; s1: number; s2: number; pipe: number }
const zero = (): SlgCounts => ({ mqal: 0, s1: 0, s2: 0, pipe: 0 })
export type SlgPeriod = { team: SlgCounts; plg: SlgCounts; groups: Record<PlgGroup, SlgCounts> }
export type SlgCampaign = { group: PlgGroup; campaign: string; cur: SlgCounts; prev: SlgCounts }
export type SlgView = { cur: SlgPeriod; prev: SlgPeriod; campaigns: SlgCampaign[] }

function add(c: SlgCounts, ev: string, n: number, amt: number) {
  if (ev === 'mqal') c.mqal += n
  else if (ev === 's1') c.s1 += n
  else if (ev === 's2') { c.s2 += n; c.pipe += amt }
}

export function buildSlg(payload: unknown): SlgView {
  const rows = objects(payload, ['n', 'amt'])
  const period = (): SlgPeriod => ({ team: zero(), plg: zero(), groups: { signup: zero(), expansion: zero() } })
  const P: Record<'cur' | 'prev', SlgPeriod> = { cur: period(), prev: period() }
  const camps = new Map<string, SlgCampaign>()
  for (const r of rows) {
    const bk = r.b === 'cur' || r.b === 'prev' ? r.b : null
    if (!bk) continue
    const ev = String(r.ev), n = r.n as number, amt = r.amt as number
    if (r.k === 'team') add(P[bk].team, ev, n, amt)
    else if (r.k === 'plg') {
      const [g, ...rest] = String(r.d ?? '').split('|')
      const group = (g === 'expansion' ? 'expansion' : 'signup') as PlgGroup
      const campaign = rest.join('|') || '(no campaign)'
      add(P[bk].plg, ev, n, amt)
      add(P[bk].groups[group], ev, n, amt)
      const key = `${group}|${campaign}`
      const c = camps.get(key) ?? { group, campaign, cur: zero(), prev: zero() }
      add(c[bk], ev, n, amt)
      camps.set(key, c)
    }
  }
  const campaigns = [...camps.values()].sort((a, c) => c.cur.pipe - a.cur.pipe || c.cur.s2 - a.cur.s2 || c.cur.s1 - a.cur.s1 || c.cur.mqal - a.cur.mqal)
  return { cur: P.cur, prev: P.prev, campaigns }
}

/** Drivers for the Workspaces tab's What moved: PLG-sourced S2 pipeline by play. */
export function slgDrivers(s: SlgView): Block[] {
  const items: Item[] = s.campaigns.map(c => ({ label: c.campaign, cur: c.cur.pipe, prev: c.prev.pipe, tags: [PLG_PLAYS[c.group].label] }))
  const p = driverPara('PLG-sourced S2 pipeline', 'pipeline', { cur: s.cur.plg.pipe, prev: s.prev.plg.pipe }, items, { usd: true })
  return p ? [p] : []
}

// ── Tier 4 tab ─────────────────────────────────────────────────────────────

/** A cohort of Tier 4 accounts and where they are now (see tier4sql.ts for each definition). */
export type T4Cohort = { accounts: number; workspace: number; newWs: number; activated: number; paying: number; retiered: number; s2: number }
const cohort = (r?: Record<string, unknown>): T4Cohort => ({
  accounts: (r?.n as number) ?? 0, workspace: (r?.a as number) ?? 0, newWs: (r?.p as number) ?? 0, activated: (r?.x as number) ?? 0,
  paying: (r?.c as number) ?? 0, retiered: (r?.y as number) ?? 0, s2: (r?.z as number) ?? 0,
})

export type NurturePath = 'Re-tier review' | 'Startup offer' | 'Expansion' | 'Upgrade nurture' | 'Activation nurture' | 'Trial invite'
export const NURTURE: { id: NurturePath; rule: string; play: string }[] = [
  { id: 'Re-tier review', rule: '200+ employees, or $10K+ self-serve ARR', play: 'Likely mis-tiered: ask RevOps to review the tier before nurturing' },
  { id: 'Startup offer', rule: 'VC-backed Seed or Series A in the portfolio scrape, not paying', play: 'Startup program offer, through the backing firm where it’s a partner' },
  { id: 'Expansion', rule: 'Paying self-serve', play: 'Usage and credit-pacing plays toward a bigger plan' },
  { id: 'Upgrade nurture', rule: 'Activated workspace, not paying', play: 'Upgrade prompts tied to what they built' },
  { id: 'Activation nurture', rule: 'Workspace, not activated', play: 'Onboarding: first table, first enrichment' },
  { id: 'Trial invite', rule: 'No workspace on their domain', play: 'Invite to start a workspace from the content they engaged with' },
]
export const RETIER = { employees: 200, arr: 10_000 }

export type T4Account = {
  id: string; name: string; domain: string; employees: number | null; industry: string | null; region: string | null
  touchpoints: number; last: string; lastType: string | null; demo: boolean
  workspaces: number; wsLast: string | null; activated: boolean; paying: boolean; arr: number; plan: string | null
  credits28: number; days28: number; pql: number; billingOpens28: number
  score: number; parts: { size: number; intent: number; product: number }; path: NurturePath
  /** From the portfolio scrape (artifact db portfolio/*), matched on domain. */
  vc?: { firms: string[]; partnered: boolean; stage: string | null; lastRoundAt: string | null; totalFunding: number | null } | null
}

const EARLY = /^(seed|series a)\b/i
/** Join the portfolio scrape onto the account list by domain: investors, partner status, stage, last round, funding. */
export function enrichTier4(rows: T4Account[], companies: CompanyRow[] | null | undefined, firms: Firm[] | null | undefined): T4Account[] {
  if (!companies?.length) return rows
  const norm = (d: string | null | undefined) => (d ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const byDom = new Map<string, CompanyRow>()
  for (const c of companies) { const d = norm(c.domain); if (d && (!byDom.has(d) || c.inDenominator)) byDom.set(d, c) }
  const firm = new Map((firms ?? []).map(f => [f.firm_id, f]))
  return rows.map(r => {
    const c = byDom.get(norm(r.domain))
    if (!c) return { ...r, vc: null }
    const fs = c.firms.map(id => firm.get(id)).filter((f): f is Firm => !!f)
    const vc = { firms: fs.map(f => f.name), partnered: fs.some(f => f.partnership_cut === 'partnered'), stage: c.stage, lastRoundAt: c.lastRoundAt, totalFunding: c.totalFunding ?? null }
    const x = { ...r, vc }
    return { ...x, path: nurturePath(x) }
  })
}

export function nurturePath(a: Pick<T4Account, 'employees' | 'arr' | 'paying' | 'activated' | 'workspaces' | 'vc'>): NurturePath {
  if ((a.employees ?? 0) >= RETIER.employees || a.arr >= RETIER.arr) return 'Re-tier review'
  if (!a.paying && a.vc?.stage && EARLY.test(a.vc.stage)) return 'Startup offer'
  if (a.paying) return 'Expansion'
  if (a.activated) return 'Upgrade nurture'
  if (a.workspaces > 0) return 'Activation nurture'
  return 'Trial invite'
}

export type Tier4View = {
  cur: T4Cohort; prev: T4Cohort
  types: { type: string; cur: { touchpoints: number; accounts: number }; prev: { touchpoints: number; accounts: number } }[]
  months: ({ month: string } & T4Cohort)[]
  accounts: T4Account[] | null
}

export function buildTier4(aggPayload: unknown, listPayload: unknown | null): Tier4View {
  const rows = objects(aggPayload, ['n', 'a', 'p', 'x', 'c', 'y', 'z'])
  const mv = (bk: string) => rows.find(r => r.k === 'mv' && r.b === bk)
  const types = new Map<string, Tier4View['types'][number]>()
  for (const r of rows.filter(r => r.k === 'tp' && (r.b === 'cur' || r.b === 'prev'))) {
    const ty = String(r.d ?? 'Other')
    const x = types.get(ty) ?? { type: ty, cur: { touchpoints: 0, accounts: 0 }, prev: { touchpoints: 0, accounts: 0 } }
    x[r.b as 'cur' | 'prev'] = { touchpoints: r.n as number, accounts: r.a as number }
    types.set(ty, x)
  }
  const months = rows.filter(r => r.k === 'mo').map(r => ({ month: String(r.d), ...cohort(r) })).sort((a, c) => a.month.localeCompare(c.month))
  let accounts: T4Account[] | null = null
  if (listPayload) {
    accounts = objects(listPayload, ['emp', 'ntp', 'demo', 'nws', 'act', 'paying', 'arr', 'cred28', 'days28', 'pql', 'modal28', 'ssize', 'sintent', 'sproduct', 'score']).map(r => {
      const a = {
        id: String(r.aid), name: String(r.name ?? r.dom ?? ''), domain: String(r.dom ?? ''), employees: (r.emp as number) || null,
        industry: (r.ind as string) ?? null, region: (r.reg as string) ?? null, touchpoints: r.ntp as number, last: String(r.last ?? '').slice(0, 10),
        lastType: (r.lasttype as string) ?? null, demo: r.demo === 1, workspaces: r.nws as number, wsLast: r.wslast ? String(r.wslast).slice(0, 10) : null,
        activated: r.act === 1, paying: r.paying === 1, arr: r.arr as number, plan: (r.plan as string) ?? null,
        credits28: r.cred28 as number, days28: r.days28 as number, pql: r.pql as number, billingOpens28: r.modal28 as number,
        score: r.score as number, parts: { size: r.ssize as number, intent: r.sintent as number, product: r.sproduct as number },
      }
      return { ...a, path: nurturePath(a) }
    })
  }
  return { cur: cohort(mv('cur')), prev: cohort(mv('prev')), types: [...types.values()].sort((a, c) => c.cur.accounts - a.cur.accounts), months, accounts }
}

export const t4rate = (c: T4Cohort, k: keyof T4Cohort, base: keyof T4Cohort = 'accounts') => (c[base] ? (c[k] as number) / (c[base] as number) : null)

/** What moved on the Tier 4 tab (lib/plg/insights.ts rules). */
export function tier4Insight(v: Tier4View): Insight {
  const { cur: c, prev: p } = v
  if (!c.accounts && !p.accounts) return { headline: [], drivers: [], emerging: [], anomalies: [], goals: [], empty: 'No Tier 4 hand-raisers in this period.' }
  const items: Item[] = v.types.map(t => ({ label: t.type, cur: t.cur.accounts, prev: t.prev.accounts }))
  const drivers: (Para | Block)[] = []
  const d = driverPara('Tier 4 accounts raising a hand', 'accounts', { cur: c.accounts, prev: p.accounts }, items, { minVolume: 10 })
  if (d) drivers.push(d)
  const rp = (label: string, k: keyof T4Cohort, noun: string) => ratePara(label, { cur: c[k] as number, prev: p[k] as number, noun }, { cur: c.accounts, prev: p.accounts, noun: 'accounts' }, 50)
  for (const x of [rp('Created a workspace after', 'newWs', 'accounts with a new workspace'), rp('Paying', 'paying', 'paying accounts'), rp('Re-tiered to Tier 1–3', 'retiered', 're-tiered accounts')]) if (x) drivers.push(x)
  const emerging: Para[] = []
  if (v.accounts) {
    const big = v.accounts.filter(a => a.path === 'Re-tier review')
    if (big.length) emerging.push([b(`${big.length} accounts`), ' still at Tier 4 look mis-tiered (200+ employees or $10K+ self-serve ARR), led by ',
      ...big.slice(0, 3).flatMap((a, i) => [i ? ', ' : '', code(a.name)] as Para), '.'])
    const vc = v.accounts.filter(a => a.vc)
    if (vc.length) {
      const partner = vc.filter(a => a.vc!.partnered).length, early = vc.filter(a => a.path === 'Startup offer').length
      emerging.push([b(`${vc.length} accounts`), ` on the list are VC-backed in the portfolio scrape${partner ? ` (${partner} backed by a partner firm)` : ''}`,
        early ? `; ${early} are Seed or Series A and not paying, so they fit the startup offer.` : '.'])
    }
  }
  const anomalies: Para[] = []
  return { headline: [], drivers, emerging, anomalies, goals: [] }
}

/** CSV of the account list for the selected path (company-level fields only). */
export function tier4Csv(rows: T4Account[]): string {
  const esc = (x: unknown) => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const cols: [string, (a: T4Account) => unknown][] = [
    ['Account', a => a.name], ['Domain', a => a.domain], ['Salesforce account id', a => a.id], ['Employees', a => a.employees], ['Industry', a => a.industry],
    ['Region', a => a.region], ['Touchpoints (180d)', a => a.touchpoints], ['Last touchpoint', a => a.last], ['Last touchpoint type', a => a.lastType],
    ['Demo or contact form', a => (a.demo ? 'yes' : 'no')], ['Workspaces', a => a.workspaces], ['Activated', a => (a.activated ? 'yes' : 'no')],
    ['Paying', a => (a.paying ? 'yes' : 'no')], ['Self-serve ARR', a => Math.round(a.arr)], ['Plan', a => a.plan], ['Active days (28d)', a => a.days28],
    ['Investors (portfolio scrape)', a => a.vc?.firms.join('; ')], ['Partner firm', a => (a.vc ? (a.vc.partnered ? 'yes' : 'no') : '')],
    ['Stage', a => a.vc?.stage], ['Last round', a => a.vc?.lastRoundAt], ['Total funding', a => a.vc?.totalFunding],
    ['Score', a => a.score], ['Nurture path', a => a.path],
  ]
  return [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(c => esc(c[1](r))).join(','))].join('\n')
}
