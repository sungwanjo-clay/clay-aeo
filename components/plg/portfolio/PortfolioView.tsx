'use client'

/**
 * Portfolio tab: penetration and offer redemption across VC / accelerator portfolios.
 * A different population from the Startup tab's inbound funnel: every verified portfolio company,
 * whether or not it visited. Counts companies, not workspaces.
 *
 * Data: the Supabase reporting views (via scripts/sync-portfolio.mjs → artifact db `portfolio/*`),
 * as of the last complete weekly snapshot. Clay does the Snowflake lookup; this tab doesn't query Sigma.
 */
import { useMemo, useState } from 'react'
import WhatMoved from '../WhatMoved'
import ProgressChart, { type ProgressMetric } from '../ProgressChart'
import { addDays, fmtShort, mondayOf } from '@/lib/plg/dates'
import { Card, Eyebrow, H2, InfoTip, Pill, Segmented, T, fmtInt, fmtPct, fmtPp } from '../ui'
import {
  CUT_LABEL, STATUS_FILTERS, countsFor, csvOf, filterCompanies, rate,
  type CompanyRow, type Counts, type CutFilter, type PortfolioData, type PortfolioMeta, type StatusFilter, SOURCE_LABEL,
  portfolioInsight,
} from '@/lib/plg/portfolio/data'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const mono = { fontFamily: T.mono } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const PAGE = 150

function NC({ why }: { why?: string }) {
  return <span title={why} style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>
}
/** $1.2M / $340K / $900 */
const fmtUsd = (n: number | null | undefined): string => {
  if (n == null) return '–'
  if (n < 0) return `−${fmtUsd(-n)}`
  return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`
}
/** ARR at churn (last invoice, annualized) for a company that paid and has nothing paying now; 0 otherwise. */
const coChurn = (r: CompanyRow) => (r.payingNow ? 0 : (r.churnedArr ?? 0))
const CUT_RANK: Record<string, number> = { partnered: 0, pending: 1, not_partnered: 2 }
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '–'

type Col = { h: string; tip?: string; num?: boolean; sort?: string }
type Sort = { key: string; dir: 1 | -1 }
/** Click a sortable header to sort by it; click again to flip. Numbers start high-to-low, text A–Z. */
const DESC_FIRST = new Set(['lastRoundAt', 'refreshed', 'last'])   // dates: newest first
const nextSort = (cur: Sort, key: string, numeric: boolean): Sort => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: numeric ? -1 : 1 })
function cmp(a: unknown, b: unknown, dir: 1 | -1) {
  if (a == null && b == null) return 0
  if (a == null) return 1                          // blanks always last
  if (b == null) return -1
  return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * dir
}
function ColDefs({ cols }: { cols: Col[] }) {
  return (
    <details className="text-[14px]" style={{ color: T.ink }}>
      <summary className="cursor-pointer select-none" style={{ color: T.muted }}>What each column means</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 grid-cols-1 md:grid-cols-[180px_1fr]">
        {cols.filter(c => c.tip).map(c => <div key={c.h} className="contents"><dt className="font-semibold">{c.h}</dt><dd style={{ color: T.muted }}>{c.tip}</dd></div>)}
      </dl>
    </details>
  )
}
function Head({ cols, sort, onSort }: { cols: Col[]; sort?: Sort; onSort?: (s: Sort) => void }) {
  return <thead><tr style={head}>{cols.map(c => {
    const on = !!sort && !!c.sort && sort.key === c.sort
    return (
      <th key={c.h} className={`${th} ${c.num ? 'text-right' : 'text-left'} sticky top-0 z-10`} style={{ background: T.card }} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
        {c.sort && sort && onSort
          ? <button type="button" onClick={() => onSort(nextSort(sort, c.sort!, !!c.num || DESC_FIRST.has(c.sort!)))} className="uppercase inline-flex items-center gap-1"
              style={{ color: on ? T.ink : T.muted, letterSpacing: 'inherit' }}>
              {c.h}<span aria-hidden style={{ opacity: on ? 1 : 0.35 }}>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
            </button>
          : c.h}
      </th>
    )
  })}</tr></thead>
}

/* ───────────────────────── Strip ───────────────────────── */
type StepId = 'portfolio' | 'workspace' | 'paying' | 'eligible' | 'redeemed'
const STEP_FILTER: Record<StepId, StatusFilter> = { portfolio: 'All', workspace: 'With a workspace', paying: 'Paying now', eligible: 'Eligible', redeemed: 'Redeemed' }
const STEP_TIP: Record<StepId, string> = {
  portfolio: 'Companies verified as backed by the selected firms, from firm-first sources (official rosters, Harmonic, PitchBook, Crunchbase, Dealroom, portfolio pages, partner lists, announcements), frozen when the week closed. Companies found only by matching our own workspaces don’t count.',
  workspace: 'Companies Clay matched to at least one Clay workspace in Snowflake, free or paid, on an exact domain. Lookups that failed or need review are shown as unknown, never as zero.',
  paying: 'Companies with a workspace that is paying now, as Clay read it from Snowflake. “Ever paid” counts any first invoice. Churned ARR = what companies that paid before and pay nothing now were paying: their last invoice, annualized (within 20% of real ARR for 98% of current customers). Sort the firms or companies by Churned ARR, or filter companies by Churned, for the re-engagement list.',
  eligible: 'Companies ever confirmed eligible in a weekly snapshot (Seed or Series A, VC-backed, net-new workspace). They stay counted after they pay or raise again. The redemption denominator.',
  redeemed: 'Eligible companies that redeemed the startup offer. Needs promo-code redemptions, which aren’t connected yet.',
}

function Step({ id, label, value, sub, on, onClick, nc }: { id: StepId; label: string; value: React.ReactNode; sub: React.ReactNode; on: boolean; onClick: () => void; nc?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="relative rounded-[22px] p-5 text-left flex flex-col gap-2 transition-shadow focus:outline-none focus-visible:ring-2"
      style={{ background: on ? '#E8F6F8' : T.tile, boxShadow: on ? `inset 0 0 0 2px ${T.pos}` : 'none' }}>
      <span className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow><span onClick={e => e.stopPropagation()}><InfoTip label={`About ${label}`}>{STEP_TIP[id]}</InfoTip></span></span>
      <span className={nc ? 'text-[22px] leading-tight' : 'text-[34px] leading-none'} style={{ ...mono, color: nc ? T.faint : T.ink }}>{value}</span>
      <span className="text-[14px] leading-snug" style={{ color: T.muted }}>{sub}</span>
    </button>
  )
}

function Strip({ c, p, eligibilityConnected, arrConnected, churnConnected, selected, onSelect }: {
  c: Counts | null; p: Counts | null; eligibilityConnected: boolean; arrConnected?: boolean; churnConnected?: boolean; selected: StepId | null; onSelect: (s: StepId | null) => void
}) {
  const pick = (s: StepId) => () => onSelect(selected === s ? null : s)
  if (!c) return null
  const pen = rate(c.with_workspace, c.portfolio)
  const prevPen = p ? rate(p.with_workspace, p.portfolio) : null
  const pay = rate(c.paying_now, c.portfolio)
  const redemptionOn = !!c.redemption_connected
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      <Step id="portfolio" label="Verified portfolio" value={fmtInt(c.portfolio)} on={selected === 'portfolio'} onClick={pick('portfolio')}
        sub={<>the denominator{p ? <> · {c.portfolio - p.portfolio >= 0 ? '+' : '−'}{fmtInt(Math.abs(c.portfolio - p.portfolio))} vs last week</> : null}</>} />
      <Step id="workspace" label="With a workspace" value={fmtInt(c.with_workspace)} on={selected === 'workspace'} onClick={pick('workspace')}
        sub={<><b style={mono}>{fmtPct(pen)}</b> penetration{pen != null && prevPen != null ? <> · {fmtPp((pen - prevPen) * 100)}</> : null}
          {c.workspace_unknown > 0 && <><br />{fmtInt(c.workspace_unknown)} unknown (lookup failed or in review)</>}</>} />
      <Step id="paying" label="Paying now" value={fmtInt(c.paying_now)} on={selected === 'paying'} onClick={pick('paying')}
        sub={<><b style={mono}>{fmtPct(pay)}</b> of portfolio · {fmtInt(c.ever_paid)} ever paid
          {arrConnected ? <><br /><b style={mono}>{fmtUsd(c.paying_arr_usd)}</b> current paying ARR</> : null}
          {churnConnected ? <><br /><b style={mono}>{fmtUsd(c.churned_arr_usd ?? 0)}</b> churned ARR · {fmtInt(c.churned ?? 0)} churned</> : null}
          {c.paying_unknown > 0 && <><br />{fmtInt(c.paying_unknown)} with a workspace, paid status unknown</>}</>} />
      <Step id="eligible" label="Eligible" nc={!eligibilityConnected} value={eligibilityConnected ? fmtInt(c.eligible_to_date) : <NC why="The weekly eligibility check isn’t writing snapshots yet" />}
        on={selected === 'eligible'} onClick={pick('eligible')} sub="confirmed since tracking began" />
      <Step id="redeemed" label="Redeemed" nc={!redemptionOn} value={redemptionOn ? fmtInt(c.redeemed) : <NC why="Promo-code redemptions aren’t connected" />}
        on={selected === 'redeemed'} onClick={pick('redeemed')}
        sub={redemptionOn ? <><b style={mono}>{fmtPct(rate(c.redeemed, c.eligible_to_date))}</b> of eligible</> : '÷ eligible = redemption rate'} />
    </div>
  )
}

/* ───────────────────────── Firms ───────────────────────── */
const FIRM_COLS: Col[] = [
  { h: 'Firm', sort: 'name' }, { h: 'Type', sort: 'type' },
  { h: 'Partner', sort: 'cut', tip: 'Partnered = the Partner box is checked in the Venture Partner Program sheet and the firm isn’t on To Approve. Pending = on To Approve.' },
  { h: 'Paying ARR', num: true, sort: 'paying_arr_usd', tip: 'Current paying ARR (Snowflake CUSTOMERS.ARR for workspaces paying now) across the firm’s portfolio companies. Ranks which funds’ portfolios bring the most revenue. A company backed by two firms counts in both rows.' },
  { h: 'Churned ARR', num: true, sort: 'churned_arr_usd', tip: 'ARR lost from portfolio companies that paid before and pay nothing now: each one’s last invoice, annualized. Sort by it to find the portfolios to re-engage. A company backed by two firms counts in both rows.' },
  { h: 'Portfolio', num: true, sort: 'portfolio', tip: 'Verified portfolio companies in the latest week: the denominator.' },
  { h: 'With a workspace', num: true, sort: 'with_workspace' }, { h: 'Penetration', num: true, sort: 'penetration', tip: 'With a workspace ÷ portfolio.' },
  { h: 'Unknown', num: true, sort: 'workspace_unknown', tip: 'Companies whose workspace lookup failed or needs review. Not counted as zero.' },
  { h: 'Paying now', num: true, sort: 'paying_now' },
  { h: 'Ever paid', num: true, sort: 'ever_paid' },
  { h: 'Eligible', num: true, tip: 'Confirmed eligible since tracking began.' },
  { h: 'Redeemed', num: true },
  { h: 'Shared by partner', num: true, sort: 'shared_by_partner', tip: 'Companies that were on a portfolio list the firm sent us directly. A coverage check on our own discovery; shown once a firm has shared a list.' },
  { h: 'Roster refreshed', sort: 'refreshed', tip: 'Last successful roster run for the firm.' },
]

/* ───────────────────────── Companies ───────────────────────── */
const COMPANY_COLS: Col[] = [
  { h: 'Company', sort: 'name', tip: 'Name and current domain.' },
  { h: 'Firm(s)', sort: 'firms', tip: 'Firms in the list that back it. Sorting puts companies with the most backers first.' },
  { h: 'Type', sort: 'type', tip: 'Type of the backing firm(s): VC fund or accelerator.' },
  { h: 'Partner', sort: 'cut', tip: 'The closest partnership among its backing firms: Partnered, then Pending, then Not partnered.' },
  { h: 'Paying ARR', sort: 'arr', num: true, tip: 'Current paying ARR across the company’s Clay workspaces.' },
  { h: 'Churned ARR', sort: 'churn', num: true, tip: 'For a company that paid before and pays nothing now: its last invoice, annualized. Hover for the churn date. Sort by it for the re-engagement list.' },
  { h: 'Total funding', sort: 'funding', num: true, tip: 'Total funding raised, from the company’s Salesforce account. Blank when it has no Salesforce record or Salesforce has no amount. Sort with “Not on Clay” to find well-funded companies that aren’t paying. It’s Salesforce’s figure as recorded, so a few records are clearly wrong (billions for a seed company); check the outliers before acting on them.' },
  { h: 'Sales tier', sort: 'tier', tip: 'The Salesforce sales tier (Tier 1 is the highest). Blank without a Salesforce record.' },
  { h: 'Clay workspace', sort: 'workspaces', tip: 'From Clay’s Snowflake lookup: matched (with the number of workspaces), no exact match, or unknown when the lookup failed or needs review.' },
  { h: 'Paid', sort: 'paid', tip: 'Paying now, ever paid, or not. Unknown when Clay didn’t read paid status.' },
  { h: 'Offer', tip: 'Eligible since tracking began, and redemption. Redemption shows Not connected until promo-code events are in.' },
  { h: 'Stage', sort: 'stage' }, { h: 'Last round', sort: 'lastRoundAt' },
  { h: 'In totals', tip: 'Whether the company counts in the numbers above. Yes = a firm-first source (the firm’s own site, PitchBook, Crunchbase, Dealroom, announcements) verified the firm backs it. No = still being verified, or we only found it by matching our own Clay workspaces, which can’t prove who invested.' },
]

function wsCell(r: CompanyRow) {
  if (!r.inDenominator) return <span style={{ color: T.faint }}>–</span>
  if (r.hasWorkspace === true) return <Pill tone="on_track">{r.workspaces != null ? `${r.workspaces} workspace${r.workspaces === 1 ? '' : 's'}` : 'Matched'}</Pill>
  if (r.hasWorkspace === false) return <span>Not on Clay</span>
  return <span style={{ color: T.amberInk }}>Unknown · {r.lookup === 'failed' ? 'lookup failed' : r.lookup === 'needs_review' ? 'needs review' : 'not looked up'}</span>
}
function paidCell(r: CompanyRow) {
  if (!r.inDenominator || r.hasWorkspace === null) return <span style={{ color: T.faint }}>–</span>
  if (r.payingNow) return <b>Paying now</b>
  if (r.everPaid) return <span>Ever paid</span>
  if (r.hasWorkspace === false || (r.payingNow === false && r.everPaid === false)) return <span style={{ color: T.muted }}>No</span>
  return <span style={{ color: T.amberInk }}>Unknown</span>
}

const SOURCE_ORDER = ['official_portfolio', 'official_page', 'crunchbase', 'pitchbook', 'dealroom', 'google', 'linkedin', 'x', 'salesforce']
const RUN_TONE: Record<string, string> = { ok: T.ink, partial: T.amberInk, failed: T.neg, skipped: T.faint }

/** How each firm's list is built: verified companies per source, and how many only that source found. */
function Sources({ meta, firmIds, firmName, pick, selected }: {
  meta: PortfolioMeta; firmIds: string[] | null; firmName: (id: string) => string; pick: (id: string | null) => void; selected: string | null
}) {
  const [sort, setSort] = useState<Sort>({ key: 'firm', dir: 1 })
  const [shownSrc, setShownSrc] = useState(PAGE)
  const cov = meta.sources ?? []
  const runs = meta.sourceRuns ?? []
  const ids = firmIds ?? [...new Set(cov.map(r => r.firm_id))]
  if (!ids.length) return null
  const cell = new Map(cov.map(r => [`${r.firm_id}|${r.source}`, r]))
  const run = new Map(runs.map(r => [`${r.firm_id}|${r.source}`, r]))
  const used = SOURCE_ORDER.filter(s => cov.some(r => r.source === s) || runs.some(r => r.source === s))
  const lastRun = (id: string) => runs.filter(r => r.firm_id === id).map(r => r.recorded_at).sort().at(-1)
  const total = (id: string) => meta.sourceTotals?.[id] ?? null
  const sorted = [...ids].sort((a, b) => cmp(
    sort.key === 'firm' ? firmName(a) : sort.key === 'last' ? lastRun(a) ?? null : sort.key === 'total' ? total(a) : cell.get(`${a}|${sort.key}`)?.companies ?? null,
    sort.key === 'firm' ? firmName(b) : sort.key === 'last' ? lastRun(b) ?? null : sort.key === 'total' ? total(b) : cell.get(`${b}|${sort.key}`)?.companies ?? null, sort.dir) || firmName(a).localeCompare(firmName(b)))
  const sortTh = (key: string, label: string, right: boolean, numeric: boolean, tip?: string) => (
    <th key={key} title={tip} className={`px-3 py-2 text-[12px] uppercase whitespace-nowrap sticky top-0 z-10 ${right ? 'text-right' : 'text-left'}`} style={{ color: T.muted, letterSpacing: '0.12em', ...mono, background: T.card }}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => setSort(nextSort(sort, key, numeric || DESC_FIRST.has(key)))} className="uppercase inline-flex items-center gap-1" style={{ color: sort.key === key ? T.ink : T.muted, letterSpacing: 'inherit' }}>
        {label}<span aria-hidden style={{ opacity: sort.key === key ? 1 : 0.35 }}>{sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>How each list is built</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>
        Total companies is each firm’s unique verified companies. Each source column is how many of them that source found, with how many only that source found in brackets; most companies are found by several sources, so the columns add up to more than the total. Every candidate is checked
        against public evidence before it counts, whichever source found it. A source in orange or red had a partial or failed run this week (hover for detail).
      </p>
      <div className="overflow-auto max-h-[620px]" style={{ overscrollBehavior: 'contain' }}><table className="w-full min-w-[1080px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}>
          {sortTh('firm', 'Firm', false, false)}
          {sortTh('total', 'Total companies', true, true, 'Unique verified companies across all sources. Sources overlap (most companies are found by several), so the source columns add up to more than this.')}
          {used.map(s => sortTh(s, SOURCE_LABEL[s] ?? s, true, true))}
          {sortTh('last', 'Last run', true, false)}
        </tr></thead>
        <tbody>{sorted.slice(0, shownSrc).map(id => (
          <tr key={id} onClick={() => pick(selected === id ? null : id)} className="cursor-pointer"
            style={{ borderBottom: `1px solid ${T.border}`, background: selected === id ? '#E8F6F8' : undefined }}>
            <td className="px-3 py-3 font-semibold whitespace-nowrap">{firmName(id)}</td>
            <td className={`${num} font-semibold`} style={mono}>{total(id) != null ? fmtInt(total(id)!) : '–'}</td>
            {used.map(s => {
              const c = cell.get(`${id}|${s}`); const r = run.get(`${id}|${s}`)
              const tone = r ? RUN_TONE[r.status] ?? T.ink : T.ink
              const tip = r ? `${SOURCE_LABEL[s] ?? s}: ${r.status} on ${fmtDate(r.recorded_at)}, ${fmtInt(r.companies)} candidates${r.cap_hit ? ' (hit its cap)' : ''}${r.error ? ` · ${r.error}` : ''}` : 'Not run for this firm'
              return (
                <td key={s} className={num} style={{ ...mono, color: c ? tone : T.faint }} title={tip}>
                  {c ? <>{fmtInt(c.companies)}<span style={{ color: T.muted }}> ({fmtInt(c.only)})</span></> : '–'}
                </td>
              )
            })}
            <td className={num} style={{ ...mono, color: T.muted }}>{fmtDate(lastRun(id))}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <MoreLess total={sorted.length} shown={shownSrc} set={setShownSrc} what="firms" />
      <p className="text-[13px]" style={{ color: T.muted }}>Salesforce is our own CRM: it shows which accounts already list the firm as an investor, so it confirms rather than discovers.</p>
    </Card>
  )
}

/** Row-count control under a long table: "Showing 150 of 258 · Show 108 more · Show all", or "Collapse to 150". */
function MoreLess({ total, shown, set, what }: { total: number; shown: number; set: (n: number) => void; what: string }) {
  if (total <= PAGE) return null
  const btn = 'rounded-full px-4 py-2 text-[14px]'
  const st = { background: '#fff', border: `1px solid ${T.border}`, color: T.ink }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px]" style={{ color: T.muted }}>
      <span style={mono}>Showing {fmtInt(Math.min(shown, total))} of {fmtInt(total)} {what}</span>
      {shown < total && <button type="button" className={btn} style={st} onClick={() => set(shown + PAGE)}>Show {fmtInt(Math.min(PAGE, total - shown))} more</button>}
      {shown < total && total - shown > PAGE && <button type="button" className={btn} style={st} onClick={() => set(total)}>Show all</button>}
      {shown > PAGE && <button type="button" className={btn} style={st} onClick={() => set(PAGE)}>Collapse to {PAGE}</button>}
    </div>
  )
}

// Quick filters on Salesforce SALES_TIER_C. "Unmatched": no Salesforce record, or a record with no tier. Clicking the active one clears it.
type TierFilter = 'all' | 't12' | 't34' | 'none'
const TIER_FILTERS: { id: Exclude<TierFilter, 'all'>; label: string; title: string }[] = [
  { id: 't12', label: 'Tier 1–2', title: 'Salesforce sales tier 1 or 2' },
  { id: 't34', label: 'Tier 3–4', title: 'Salesforce sales tier 3 or 4' },
  { id: 'none', label: 'Unmatched', title: 'No Salesforce record, or no sales tier on it' },
]
const TIER_MATCH: Record<TierFilter, (t: string | null | undefined) => boolean> = {
  all: () => true,
  t12: t => t === 'Tier 1' || t === 'Tier 2',
  t34: t => t === 'Tier 3' || t === 'Tier 4',
  none: t => !t,
}

export default function PortfolioView({ data, onExport }: { data: PortfolioData | null | undefined; onExport?: (filename: string, csv: string) => Promise<void> }) {
  const [cut, setCut] = useState<CutFilter>('all')
  const [firmId, setFirmId] = useState<string | null>(null)
  const [step, setStep] = useState<StepId | null>(null)
  const [status, setStatus] = useState<StatusFilter>('All')
  const [firmSort, setFirmSort] = useState<Sort>({ key: 'paying_arr_usd', dir: -1 })
  const [coSort, setCoSort] = useState<Sort>({ key: 'name', dir: 1 })
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<TierFilter>('all')
  const [shown, setShown] = useState(PAGE)
  const [firmShown, setFirmShown] = useState(PAGE)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const meta = data?.meta
  const latest = meta?.latest?.snapshot_date ?? null
  const firmName = useMemo(() => {
    const m = new Map((meta?.firms ?? []).map(f => [f.firm_id, f.name]))
    return (id: string) => m.get(id) ?? 'Unknown firm'
  }, [meta])
  const firmsById = useMemo(() => new Map((meta?.firms ?? []).map(f => [f.firm_id, f])), [meta])
  // A company's Type and Partner come from its backing firms (closest partnership wins).
  const coType = (r: CompanyRow) => {
    const t = new Set(r.firms.map(f => firmsById.get(f)?.firm_type).filter(Boolean))
    return t.size === 0 ? null : t.size > 1 ? 'VC fund + accelerator' : t.has('accelerator') ? 'Accelerator' : 'VC fund'
  }
  const coCut = (r: CompanyRow) => {
    const fs = r.firms.map(f => firmsById.get(f)).filter(Boolean)
    const best = fs.map(f => f!.partnership_cut).sort((a, b) => CUT_RANK[a] - CUT_RANK[b])[0]
    return { rank: best ? CUT_RANK[best] : 9, label: best ? CUT_LABEL[best] : '–' }
  }

  const firmRows = useMemo(() => (meta && latest
    ? meta.firmRows.filter(r => r.snapshot_date === latest && (cut === 'all' || r.partnership_cut === cut)).sort((a, b) => b.portfolio - a.portfolio)
    : []), [meta, latest, cut])
  const sortedFirmRows = useMemo(() => {
    const val = (r: (typeof firmRows)[number]) => {
      const f = firmsById.get(r.firm_id)
      switch (firmSort.key) {
        case 'name': return firmName(r.firm_id)
        case 'type': return f?.firm_type ?? null
        case 'cut': return CUT_LABEL[r.partnership_cut]
        case 'penetration': return rate(r.with_workspace, r.portfolio)
        case 'refreshed': return f?.roster_refreshed_at ?? null
        default: return (r as unknown as Record<string, number | undefined>)[firmSort.key] ?? null
      }
    }
    return [...firmRows].sort((a, b) => cmp(val(a), val(b), firmSort.dir) || firmName(a.firm_id).localeCompare(firmName(b.firm_id)))
  }, [firmRows, firmSort, firmsById, firmName])
  // "Shared by partner" stays hidden until a firm has actually sent us a portfolio list.
  const showShared = firmRows.some(r => (r.shared_by_partner ?? 0) > 0)
  const firmCols = showShared ? FIRM_COLS : FIRM_COLS.filter(c => c.sort !== 'shared_by_partner')
  const firmsWithoutRoster = useMemo(() => {
    if (!meta) return 0
    const has = new Set(meta.firmRows.filter(r => r.snapshot_date === latest).map(r => r.firm_id))
    return meta.firms.filter(f => (cut === 'all' || f.partnership_cut === cut) && !has.has(f.firm_id)).length
  }, [meta, latest, cut])

  const c = meta ? countsFor(meta, latest, cut, firmId) : null
  const p = meta ? countsFor(meta, meta.previous, cut, firmId) : null
  // Firms with companies in the current cut, for the Companies card's firm picker (count = companies listed).
  const firmOptions = useMemo(() => {
    if (!data) return [] as { id: string; n: number }[]
    const n = new Map<string, number>()
    for (const r of filterCompanies(data.companies, { cut, firmId: null, status: 'All', q: '', asOf: latest }))
      for (const f of r.firms) if (cut === 'all' || firmsById.get(f)?.partnership_cut === cut) n.set(f, (n.get(f) ?? 0) + 1)
    return [...n.entries()].map(([id, c]) => ({ id, n: c })).sort((a, b) => firmName(a.id).localeCompare(firmName(b.id)))
  }, [data, cut, latest, firmName, firmsById])
  const list = useMemo(() => {
    if (!data) return []
    const rows = filterCompanies(data.companies, { cut, firmId, status, q, asOf: latest }).filter(r => TIER_MATCH[tier](r.salesTier))
    const val = (r: CompanyRow): unknown => {
      switch (coSort.key) {
        case 'name': return r.name.toLowerCase()
        case 'firms': return r.firms.length
        case 'workspaces': return r.hasWorkspace === true ? (r.workspaces ?? 1) : r.hasWorkspace === false ? 0 : null
        case 'paid': return r.payingNow ? 2 : r.everPaid ? 1 : r.everPaid === false ? 0 : null
        // Exactly the numbers shown: blank only when the column shows a dash.
        case 'arr': return r.inDenominator && meta?.arrConnected ? (r.payingArr ?? 0) : null
        case 'churn': return r.inDenominator && meta?.churnConnected ? coChurn(r) : null
        case 'funding': return r.totalFunding ?? null
        case 'tier': return r.salesTier ?? null
        case 'type': return coType(r)
        case 'cut': return coCut(r).rank
        case 'stage': return r.stage
        case 'lastRoundAt': return r.lastRoundAt
        default: return null
      }
    }
    return [...rows].sort((a, b) => cmp(val(a), val(b), coSort.dir) || a.name.localeCompare(b.name))
  }, [data, cut, firmId, status, q, tier, latest, coSort])

  // Sums over every company the filters match (all pages). With no search and status All this is the cut's (or firm's) total:
  // the same rule as the tiles and the Firms table total, each company once.
  const listArr = useMemo(() => {
    const counted = list.filter(r => r.inDenominator)
    return { n: counted.length, paying: counted.filter(r => r.payingNow).length, arr: counted.reduce((n, r) => n + (r.payingArr ?? 0), 0),
             churned: counted.filter(r => r.everPaid && r.payingNow === false).length, churnArr: counted.reduce((n, r) => n + coChurn(r), 0) }
  }, [list])

  const progress = useMemo((): ProgressMetric[] => {
    if (!data || !meta || !latest) return []
    const cos = filterCompanies(data.companies, { cut, firmId, status: 'All', q: '', asOf: latest })
    const dated = cos.filter(r => r.firstWsAt)
    const end = latest
    const first = dated.map(r => r.firstWsAt!).sort()[0]
    const start = mondayOf(first && first > addDays(end, -7 * 104) ? first : addDays(end, -7 * 104))
    const weeks: string[] = []
    for (let d = start; d <= end; d = addDays(d, 7)) weeks.push(d)
    const at = (d: string) => {
      const e = addDays(d, 6)
      let ws = 0, paid = 0, paying = 0
      for (const r of dated) {
        if (r.firstWsAt! <= e) ws++
        if (r.firstPaidAt && r.firstPaidAt <= e) {
          paid++
          if (r.payingNow || (r.churnedAt && r.churnedAt > e)) paying++
        }
      }
      return { ws, paid, paying }
    }
    const pts = weeks.map(d => ({ d, label: fmtShort(d), ...at(d) }))
    const n = cos.length
    const empty = 'Workspace history arrives with the next Clay status refresh (it adds when each company first got a workspace and first paid).'
    const note = <>Built from this week’s verified portfolio{firmId ? ` for ${firmName(firmId)}` : ''}: when each company first got a workspace, first paid, and churned.</>
    const last = pts.at(-1); const yearAgo = pts.at(-53)
    const sum = (k: 'ws' | 'paid' | 'paying', f = fmtInt) => last && dated.length ? <><span style={{ ...mono, color: T.ink }}>{f(last[k])}</span>{yearAgo ? <> now · {f(yearAgo[k])} a year ago</> : null}</> : null
    // Paying ARR is only known week by week, from closed weekly snapshots.
    const snaps = firmId
      ? meta.firmRows.filter(r => r.firm_id === firmId)
      : meta.totals.filter(t => t.cut === cut)
    const arrPts = [...snaps].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
      .map(t => ({ label: fmtShort(t.snapshot_date), v: meta.arrConnected ? t.paying_arr_usd ?? null : null }))
    const has = dated.length > 0
    return [
      { id: 'ws', label: 'Companies with a workspace', fmt: fmtInt, points: pts.map(p => ({ label: p.label, v: has ? p.ws : null })), summary: sum('ws'), empty, note },
      { id: 'pen', label: 'Penetration', fmt: (v: number) => fmtPct(v, 0), points: pts.map(p => ({ label: p.label, v: has && n ? p.ws / n : null })),
        summary: last && n && dated.length ? <><span style={{ ...mono, color: T.ink }}>{fmtPct(last.ws / n)}</span> of {fmtInt(n)} portfolio companies{yearAgo ? <> · {fmtPct(yearAgo.ws / n)} a year ago</> : null}</> : null, empty, note },
      { id: 'paying', label: 'Paying companies', fmt: fmtInt, points: pts.map(p => ({ label: p.label, v: has ? p.paying : null })), summary: sum('paying'), empty, note },
      { id: 'paid', label: 'Ever paid', fmt: fmtInt, points: pts.map(p => ({ label: p.label, v: has ? p.paid : null })), summary: sum('paid'), empty, note },
      { id: 'arr', label: 'Paying ARR (weekly snapshots)', fmt: (v: number) => fmtUsd(v), points: arrPts,
        summary: arrPts.length ? <><span style={{ ...mono, color: T.ink }}>{fmtUsd(arrPts.at(-1)!.v)}</span> in the latest closed week · {fmtInt(arrPts.length)} {arrPts.length === 1 ? 'week' : 'weeks'} so far</> : null,
        empty: 'Paying ARR appears once a weekly snapshot closes with ARR.', note: <>One point per closed weekly snapshot; it fills in week by week.</> },
    ]
  }, [data, meta, latest, cut, firmId, firmName])

  const stickyBar = (children: React.ReactNode) => (
    <div className="sticky top-0 z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 flex flex-wrap items-center gap-3"
      style={{ background: T.card, borderBottom: `1px solid ${T.border}` }}>{children}</div>
  )
  const cutSwitch = (
    <Segmented ariaLabel="Which firms" value={cut} onChange={v => setCutAndReset(v)}
      options={(['all', 'partnered', 'not_partnered', 'pending'] as CutFilter[]).map(id => ({ id, label: CUT_LABEL[id] }))} />
  )

  const setCutAndReset = (v: CutFilter) => { setCut(v); setFirmId(null); setShown(PAGE) }
  const pickStep = (s: StepId | null) => { setStep(s); setStatus(s ? STEP_FILTER[s] : 'All'); setShown(PAGE) }
  const pickFirm = (id: string | null) => { setFirmId(id); setShown(PAGE) }
  const doExport = async () => {
    if (!onExport || !latest) return
    const name = `portfolio-${latest}-${firmId ? firmName(firmId).toLowerCase().replace(/[^a-z0-9]+/g, '-') : cut}-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${tier === 'all' ? '' : '-' + tier}.csv`
    try { await onExport(name, csvOf(list, firmName)); setExportMsg(null) } catch { setExportMsg('Export was cancelled or isn’t available here.') }
  }

  if (data === undefined) return <p className="text-[15px]" style={{ color: T.muted }}>Loading the portfolio snapshot…</p>
  if (!meta) return <p className="text-[15px]" style={{ color: T.muted }}>The portfolio data hasn’t been synced to this dashboard yet.</p>

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Firm cut" value={cut} onChange={setCutAndReset}
          options={(['all', 'partnered', 'not_partnered', 'pending'] as CutFilter[]).map(id => ({ id, label: CUT_LABEL[id] }))} />
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: T.muted }}>
          Firm
          <select value={firmId ?? ''} onChange={e => pickFirm(e.target.value || null)} disabled={!firmRows.length}
            className="rounded-full px-3 py-2 text-[14px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }}>
            <option value="">{cut === 'all' ? 'Every firm' : `Every ${CUT_LABEL[cut].toLowerCase()} firm`}</option>
            {[...firmRows].sort((a, b) => firmName(a.firm_id).localeCompare(firmName(b.firm_id))).map(r => <option key={r.firm_id} value={r.firm_id}>{firmName(r.firm_id)}</option>)}
          </select>
        </label>
        <span className="text-[13px]" style={{ ...mono, color: T.muted }}>
          {latest ? <>As of the week of {fmtDate(latest)} · synced {fmtDate(meta.syncedAt)}</> : <>No completed weekly snapshot yet</>}
        </span>
      </div>

      {!latest ? (
        <Card className="p-5 sm:p-8 flex flex-col gap-2">
          <H2>No completed snapshot yet</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>
            {fmtInt(meta.firms.length)} firms are loaded from the Venture Partner Program sheet. Numbers appear here once the first weekly
            snapshot closes: Clay builds the roster, looks each company up in Snowflake and writes the week to Supabase.
          </p>
          {meta.openWeek && <p className="text-[15px]" style={{ color: T.ink }}>
            The week of {fmtDate(meta.openWeek.snapshot_date)} is being built: {fmtInt(meta.openWeek.lookups)} companies looked up so far.
            It closes once every firm in the week has run.
          </p>}
        </Card>
      ) : (<>
        <section className="flex flex-col gap-3">
          {c ? <Strip c={c} p={p} eligibilityConnected={meta.eligibilityConnected} arrConnected={meta.arrConnected} churnConnected={meta.churnConnected} selected={step} onSelect={pickStep} />
            : <p className="text-[15px]" style={{ color: T.muted }}>No verified portfolio companies for {firmId ? firmName(firmId) : CUT_LABEL[cut].toLowerCase()} in this week.</p>}
          <p className="text-[14px]" style={{ color: T.muted }}>
            {firmId ? <>Showing {firmName(firmId)}. <button type="button" className="underline" onClick={() => pickFirm(null)}>Show the whole cut</button>. </> : null}
            Click a number to list exactly those companies below. Penetration is over the whole verified portfolio; redemption only over companies confirmed eligible.
          </p>
        </section>

        {progress.length > 0 && <ProgressChart title="Progress" metrics={progress} />}
        <WhatMoved insight={portfolioInsight(meta, cut, firmName, id => cut === 'all' || firmsById.get(id)?.partnership_cut === cut)} />

        <Card className="p-5 sm:p-8 flex flex-col gap-4">
          <H2>Firms</H2>
          {stickyBar(<>
            {cutSwitch}
            <span className="text-[13px]" style={{ ...mono, color: T.muted }}>{fmtInt(sortedFirmRows.length)} {sortedFirmRows.length === 1 ? 'firm' : 'firms'}</span>
            {firmId && <button type="button" onClick={() => pickFirm(null)} className="rounded-full px-3 py-1.5 text-[13px]"
              style={{ background: '#E8F6F8', color: T.ink, border: `1px solid ${T.pos}` }}>{firmName(firmId)} ✕</button>}
          </>)}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px]" style={{ color: T.muted }}>Click a firm to filter the numbers and companies to it. A company backed by two firms counts in both rows, once in the totals.</p>
          </div>
          <div className="overflow-auto max-h-[620px]" style={{ overscrollBehavior: 'contain' }}><table className="w-full min-w-[1280px] text-[15px]" style={{ color: T.ink }}>
            <Head cols={firmCols} sort={firmSort} onSort={setFirmSort} />
            <tbody>
              {sortedFirmRows.length ? sortedFirmRows.slice(0, firmShown).map(r => {
                const f = firmsById.get(r.firm_id)
                const on = firmId === r.firm_id
                return (
                  <tr key={r.firm_id} onClick={() => pickFirm(on ? null : r.firm_id)} className="cursor-pointer"
                    style={{ borderBottom: `1px solid ${T.border}`, background: on ? '#E8F6F8' : undefined }}>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">{firmName(r.firm_id)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{f?.firm_type === 'accelerator' ? 'Accelerator' : 'VC fund'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{CUT_LABEL[r.partnership_cut]}</td>
                    <td className={`${num} font-semibold`} style={mono}>{meta.arrConnected ? fmtUsd(r.paying_arr_usd) : <NC why="Current paying ARR arrives with the next Clay status refresh" />}</td>
                    <td className={num} style={mono}>{meta.churnConnected ? (r.churned_arr_usd ? fmtUsd(r.churned_arr_usd) : <span style={{ color: T.faint }}>$0</span>) : <NC why="Churned ARR arrives with the next Clay status refresh" />}</td>
                    <td className={num} style={mono}>{fmtInt(r.portfolio)}</td>
                    <td className={num} style={mono}>{fmtInt(r.with_workspace)}</td>
                    <td className={num} style={mono}>{fmtPct(rate(r.with_workspace, r.portfolio))}</td>
                    <td className={num} style={{ ...mono, color: r.workspace_unknown ? T.amberInk : T.faint }}>{fmtInt(r.workspace_unknown)}</td>
                    <td className={num} style={mono}>{fmtInt(r.paying_now)}</td>
                    <td className={num} style={mono}>{fmtInt(r.ever_paid)}</td>
                    <td className={num} style={mono}>{meta.eligibilityConnected ? fmtInt(r.eligible_to_date) : <NC />}</td>
                    <td className={num} style={mono}>{r.redemption_connected ? fmtInt(r.redeemed) : <NC />}</td>
                    {showShared && <td className={num} style={mono}>{fmtInt(r.shared_by_partner ?? 0)}</td>}
                    <td className="px-3 py-3 whitespace-nowrap" style={{ color: T.muted }}>{fmtDate(f?.roster_refreshed_at)}</td>
                  </tr>
                )
              }) : <tr><td colSpan={firmCols.length} className="px-3 py-4 text-[14px]" style={{ color: T.muted }}>No firm in this cut has a roster in this week yet.</td></tr>}
            </tbody>
            {sortedFirmRows.length > 1 && !firmId && c && (() => {
              const t = c
              const rowSum = sortedFirmRows.reduce((n, r) => n + (r.paying_arr_usd ?? 0), 0)
              return (
                <tfoot className="sticky bottom-0 z-10"><tr style={{ borderTop: `2px solid ${T.ink}`, background: '#F7F6F2', boxShadow: `0 -1px 0 ${T.ink}` }}>
                  <td className="px-3 py-3 font-semibold whitespace-nowrap" colSpan={3}>
                    Total · each company once
                    {meta.arrConnected && Math.round(rowSum) !== Math.round(t.paying_arr_usd ?? 0) &&
                      <p className="text-[12px] font-normal" style={{ color: T.muted }}>Firm rows add up to {fmtUsd(rowSum)}: companies backed by several firms count in each.</p>}
                  </td>
                  <td className={`${num} font-semibold`} style={mono}>{meta.arrConnected ? fmtUsd(t.paying_arr_usd) : <NC />}</td>
                  <td className={`${num} font-semibold`} style={mono}>{meta.churnConnected ? fmtUsd(t.churned_arr_usd ?? 0) : <NC />}</td>
                  <td className={`${num} font-semibold`} style={mono}>{fmtInt(t.portfolio)}</td>
                  <td className={`${num} font-semibold`} style={mono}>{fmtInt(t.with_workspace)}</td>
                  <td className={`${num} font-semibold`} style={mono}>{fmtPct(rate(t.with_workspace, t.portfolio))}</td>
                  <td className={num} style={mono}>{fmtInt(t.workspace_unknown)}</td>
                  <td className={`${num} font-semibold`} style={mono}>{fmtInt(t.paying_now)}</td>
                  <td className={num} style={mono}>{fmtInt(t.ever_paid)}</td>
                  <td className={num} style={mono}>{meta.eligibilityConnected ? fmtInt(t.eligible_to_date) : <NC />}</td>
                  <td className={num} style={mono}>{t.redemption_connected ? fmtInt(t.redeemed) : <NC />}</td>
                  {showShared && <td className={num} style={{ ...mono, color: T.faint }}>–</td>}
                  <td className="px-3 py-3" />
                </tr></tfoot>
              )
            })()}
          </table></div>
          <MoreLess total={sortedFirmRows.length} shown={firmShown} set={setFirmShown} what="firms" />
          {firmsWithoutRoster > 0 && <p className="text-[13px]" style={{ color: T.muted }}>{fmtInt(firmsWithoutRoster)} more {firmsWithoutRoster === 1 ? 'firm' : 'firms'} in this cut {firmsWithoutRoster === 1 ? 'has' : 'have'} no roster yet.</p>}
          <ColDefs cols={firmCols} />
        </Card>
      </>)}


      {latest && (
        <Card className="p-5 sm:p-8 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <H2>Companies</H2>
            <button type="button" onClick={doExport} disabled={!onExport || !list.length}
              title={onExport ? `Download these ${list.length} companies as CSV` : 'Downloads aren’t available in this view'}
              className="rounded-full px-4 py-2 text-[14px] font-medium disabled:cursor-not-allowed"
              style={{ background: onExport && list.length ? T.ink : '#EFEEEA', color: onExport && list.length ? '#fff' : T.faint }}>Export CSV</button>
          </div>
          {stickyBar(<>
            {cutSwitch}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by Salesforce sales tier">
              {TIER_FILTERS.map(f => (
                <button key={f.id} type="button" title={f.title} aria-pressed={tier === f.id}
                  onClick={() => { setTier(tier === f.id ? 'all' : f.id); setShown(PAGE) }}
                  className="rounded-full px-3 py-1.5 text-[13px]"
                  style={{ background: tier === f.id ? T.ink : '#fff', color: tier === f.id ? '#fff' : T.ink, border: `1px solid ${tier === f.id ? T.ink : T.border}` }}>{f.label}</button>
              ))}
            </div>
            <select value={firmId ?? ''} onChange={e => pickFirm(e.target.value || null)} aria-label="Filter companies by firm"
              className="rounded-full px-3 py-2 text-[14px]" style={{ background: '#fff', border: `1px solid ${firmId ? T.ink : T.border}`, color: T.ink }}>
              <option value="">{cut === 'all' ? 'Every firm' : `Every ${CUT_LABEL[cut].toLowerCase()} firm`}</option>
              {firmOptions.map(f => <option key={f.id} value={f.id}>{firmName(f.id)} ({fmtInt(f.n)})</option>)}
            </select>
            <input type="search" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} placeholder="Search company or domain"
              className="rounded-full px-4 py-2 text-[14px] min-w-[240px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }} />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map(f => (
                <button key={f} type="button" onClick={() => { setStatus(f); setStep(null); setShown(PAGE); if (f === 'Churned') setCoSort({ key: 'churn', dir: -1 }) }} aria-pressed={status === f}
                  className="rounded-full px-3 py-1.5 text-[13px]"
                  style={{ background: status === f ? T.ink : '#fff', color: status === f ? '#fff' : T.ink, border: `1px solid ${status === f ? T.ink : T.border}` }}>{f}</button>
              ))}
            </div>
          </>)}
          <p className="text-[14px]" style={{ color: T.muted, ...mono }}>
            {fmtInt(list.length)} {list.length === 1 ? 'company' : 'companies'}
            {meta.arrConnected && listArr.n > 0 && <> · {fmtInt(listArr.paying)} paying · <b style={{ color: T.ink }}>{fmtUsd(listArr.arr)}</b> paying ARR</>}
            {meta.churnConnected && listArr.churned > 0 && <> · {fmtInt(listArr.churned)} churned · <b style={{ color: T.ink }}>{fmtUsd(listArr.churnArr)}</b> churned ARR</>}
          </p>
          {exportMsg && <p className="text-[13px]" style={{ color: T.neg }}>{exportMsg}</p>}
          <div className="overflow-auto max-h-[620px]" style={{ overscrollBehavior: 'contain' }}><table className="w-full min-w-[1120px] text-[15px]" style={{ color: T.ink }}>
            <Head cols={COMPANY_COLS} sort={coSort} onSort={s => { setCoSort(s); setShown(PAGE) }} />
            <tbody>
              {list.length ? list.slice(0, shown).map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-3 py-3"><p className="font-semibold">{r.name}</p><p className="text-[13px]" style={{ ...mono, color: T.muted }}>{r.domain ?? 'stealth · no domain'}</p></td>
                  <td className="px-3 py-3 text-[14px]">{r.firms.map(firmName).join(', ')}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{coType(r) ?? <span style={{ color: T.faint }}>–</span>}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{coCut(r).label}</td>
                  <td className={`${num} font-semibold`} style={mono}>{!meta.arrConnected || !r.inDenominator ? <span style={{ color: T.faint }}>–</span> : r.payingArr ? fmtUsd(r.payingArr) : <span style={{ color: T.faint }}>$0</span>}</td>
                  <td className={num} style={mono} title={coChurn(r) ? `Churned${r.churnedAt ? ' ' + fmtDate(r.churnedAt) : ''}: last invoice, annualized` : undefined}>
                    {!meta.churnConnected || !r.inDenominator ? <span style={{ color: T.faint }}>–</span> : coChurn(r) ? fmtUsd(coChurn(r)) : <span style={{ color: T.faint }}>$0</span>}</td>
                  <td className={num} style={mono}>{r.totalFunding ? fmtUsd(r.totalFunding) : <span style={{ color: T.faint }}>–</span>}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{r.salesTier ?? <span style={{ color: T.faint }}>–</span>}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{wsCell(r)}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{paidCell(r)}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">
                    {!r.inDenominator ? <span style={{ color: T.faint }}>–</span>
                      : !meta.eligibilityConnected && r.redemption === 'not_connected' ? <NC why="Eligibility snapshots and promo-code redemptions aren’t connected yet" />
                      : <>
                        {meta.eligibilityConnected ? (r.eligibleToDate ? 'Eligible' : 'Not confirmed') : <NC />}
                        <span style={{ color: T.faint }}> · </span>
                        {r.redemption === 'not_connected' ? <span style={{ color: T.faint }}>redemption not connected</span> : r.redemption === 'redeemed' ? <b>Redeemed</b> : 'Not redeemed'}
                      </>}
                  </td>
                  <td className="px-3 py-3 text-[14px]">{r.stage ?? <span style={{ color: T.faint }}>–</span>}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{r.lastRoundAt ? fmtDate(r.lastRoundAt) : <span style={{ color: T.faint }}>–</span>}</td>
                  <td className="px-3 py-3 text-[14px] whitespace-nowrap">{r.inDenominator ? 'Yes'
                    : <span style={{ color: T.muted }}>{r.notCountedReason === 'in_review' ? 'No · still being verified' : r.notCountedReason === 'workspace_match_only' ? 'No · only matched to our workspaces' : 'No · not verified'}</span>}</td>
                </tr>
              )) : <tr><td colSpan={COMPANY_COLS.length} className="px-3 py-4 text-[14px]" style={{ color: T.muted }}>No companies match these filters.</td></tr>}
            </tbody>
            {meta.arrConnected && listArr.n > 0 && (
              <tfoot className="sticky bottom-0 z-10"><tr style={{ borderTop: `2px solid ${T.ink}`, background: '#F7F6F2', boxShadow: `0 -1px 0 ${T.ink}` }}>
                <td className="px-3 py-3 font-semibold" colSpan={4}>Total · {fmtInt(listArr.n)} {listArr.n === 1 ? 'company' : 'companies'}{list.length > shown ? ' (all pages)' : ''}</td>
                <td className={`${num} font-semibold`} style={mono}>{fmtUsd(listArr.arr)}</td>
                <td className={`${num} font-semibold`} style={mono}>{meta.churnConnected ? fmtUsd(listArr.churnArr) : '–'}</td>
                <td className="px-3 py-3" colSpan={2} />
                <td className="px-3 py-3 text-[14px] whitespace-nowrap">{fmtInt(listArr.paying)} paying now{listArr.churned ? <> · {fmtInt(listArr.churned)} churned</> : null}</td>
                <td className="px-3 py-3" colSpan={COMPANY_COLS.length - 9} />
              </tr></tfoot>
            )}
          </table></div>
          <MoreLess total={list.length} shown={shown} set={setShown} what="companies" />
          <ColDefs cols={COMPANY_COLS} />
        </Card>
      )}

      <Sources meta={meta} firmIds={latest ? firmRows.map(r => r.firm_id) : null} firmName={firmName} pick={pickFirm} selected={firmId} />

      <p className="text-[13px]" style={{ color: T.muted }}>
        Source: the Clay portfolio workflow → Supabase weekly snapshots (roster frozen at the week’s close; workspace and paid status from Clay’s Snowflake lookup).
        This tab reads only the Supabase reporting views. Redemption stays Not connected until promo-code redemptions are available.
      </p>
    </div>
  )
}
