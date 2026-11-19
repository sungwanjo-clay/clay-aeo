'use client'

/**
 * Portfolio tab: penetration and offer redemption across VC / accelerator portfolios.
 * A different population from the Startup tab's inbound funnel: every verified portfolio company,
 * whether or not it visited. Counts companies, not workspaces.
 *
 * Data: Supabase `dashboard` views (roster, companies, company_status, firms) synced into the
 * artifact db, joined live to Snowflake for workspace / paid / redeemed. Until that sync exists,
 * every number renders "Not connected".
 */
import { useState } from 'react'
import { Card, Eyebrow, H2, InfoTip, Segmented, T } from '../ui'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const mono = { fontFamily: T.mono } as const

function NC({ why }: { why?: string }) {
  return <span title={why} style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>
}
const NOT_SYNCED = 'The portfolio roster and weekly snapshots aren’t synced from Supabase yet'

type Col = { h: string; tip?: string; num?: boolean }

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

function Table({ cols, minW, empty }: { cols: Col[]; minW: number; empty: React.ReactNode }) {
  return (
    <div className="overflow-x-auto"><table className="w-full text-[15px]" style={{ color: T.ink, minWidth: minW }}>
      <thead><tr style={head}>{cols.map(c => <th key={c.h} className={`${th} ${c.num ? 'text-right' : 'text-left'}`}>{c.h}</th>)}</tr></thead>
      <tbody><tr><td colSpan={cols.length} className="px-3 py-4 text-[14px]">{empty}</td></tr></tbody>
    </table></div>
  )
}

/* ───────────────────────── Numerator / denominator strip ───────────────────────── */
type StepId = 'portfolio' | 'workspace' | 'paying' | 'eligible' | 'redeemed'
const STEPS: { id: StepId; label: string; of: string; tip: string }[] = [
  { id: 'portfolio', label: 'Verified portfolio', of: 'the denominator',
    tip: 'Companies verified as backed by the selected firms, from firm-first sources (Harmonic, PitchBook, Crunchbase, Dealroom, portfolio pages, the YC directory, partner lists, announcements). Companies found only by matching our own workspaces don’t count.' },
  { id: 'workspace', label: 'With a workspace', of: '÷ verified portfolio = penetration',
    tip: 'Verified portfolio companies with at least one Clay workspace, free or paid, matched on current and past domains. Once per company.' },
  { id: 'paying', label: 'Paying', of: '÷ verified portfolio',
    tip: 'Verified portfolio companies with a paying workspace (Snowflake CUSTOMERS).' },
  { id: 'eligible', label: 'Eligible', of: 'confirmed since tracking began',
    tip: 'Companies that were ever confirmed eligible in a weekly snapshot: Seed or Series A, VC-backed, and passed the net-new workspace check. They stay in the count after they pay or raise again. This is the redemption denominator.' },
  { id: 'redeemed', label: 'Redeemed', of: '÷ eligible = redemption rate',
    tip: 'Eligible companies that redeemed the startup offer. Needs promo-code redemptions in Snowflake.' },
]

function Strip({ selected, onSelect }: { selected: StepId | null; onSelect: (s: StepId | null) => void }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      {STEPS.map((s, i) => {
        const on = selected === s.id
        return (
          <button key={s.id} type="button" onClick={() => onSelect(on ? null : s.id)} aria-pressed={on}
            className="relative rounded-[22px] p-5 text-left flex flex-col gap-2 transition-shadow focus:outline-none focus-visible:ring-2"
            style={{ background: on ? '#E8F6F8' : T.tile, boxShadow: on ? `inset 0 0 0 2px ${T.pos}` : 'none' }}>
            <span className="flex items-center gap-2">
              <Eyebrow>{s.label}</Eyebrow>
              <span onClick={e => e.stopPropagation()}><InfoTip label={`About ${s.label}`}>{s.tip}</InfoTip></span>
            </span>
            <span className="text-[22px] leading-tight" style={{ ...mono, color: T.faint }}><NC why={NOT_SYNCED} /></span>
            <span className="text-[14px]" style={{ color: T.muted }}>{s.of}</span>
            {i < STEPS.length - 1 && <span aria-hidden className="hidden xl:block absolute -right-[11px] top-1/2 -translate-y-1/2 text-[16px]" style={{ color: T.faint }}>→</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ───────────────────────── Firms ───────────────────────── */
const FIRM_COLS: Col[] = [
  { h: 'Firm' }, { h: 'Type', tip: 'VC fund or accelerator.' },
  { h: 'Partner', tip: 'From the Venture Partner Program sheet: the Partner box on All Priority, the Proven tab and the To Approve tab are shown separately.' },
  { h: 'Verified portfolio', num: true, tip: 'The denominator for this firm.' },
  { h: 'Shared by partner', num: true, tip: 'Verified companies that were on a list the firm shared. A coverage check, not the denominator.' },
  { h: 'With a workspace', num: true }, { h: 'Penetration', num: true, tip: 'With a workspace ÷ verified portfolio.' },
  { h: 'Paying', num: true },
  { h: 'Eligible', num: true, tip: 'Confirmed eligible since tracking began.' },
  { h: 'Needs check', num: true, tip: 'Fits on funding, but the net-new workspace check hasn’t passed or failed yet. Counted as neither eligible nor ineligible.' },
  { h: 'Redeemed', num: true }, { h: 'Redemption rate', num: true, tip: 'Redeemed ÷ eligible, cumulative.' },
  { h: 'In review', num: true, tip: 'Links found but not yet verified, so not in the denominator. A large number means the firm’s rate is provisional.' },
  { h: 'Roster refreshed', tip: 'Last successful roster run for the firm.' },
]

/* ───────────────────────── Companies ───────────────────────── */
const COMPANY_COLS: Col[] = [
  { h: 'Company', tip: 'Name and current domain. Stealth companies show without a domain.' },
  { h: 'Firm(s)', tip: 'Every selected firm that backs it, with the sources and evidence link for each.' },
  { h: 'Stage', tip: 'Latest verified round from the weekly snapshot.' },
  { h: 'Last round' },
  { h: 'Clay status', tip: 'Not on Clay, Free workspace or Paid, live from Snowflake on current and past domains.' },
  { h: 'Offer', tip: 'Eligible, Needs check, Not eligible (with the reason) or Redeemed. Separate from Clay status: a company can be paid and have redeemed.' },
  { h: 'Workspaces', num: true, tip: 'Clay workspaces matched to the company.' },
  { h: 'First paid', tip: 'Date of the first paid invoice.' },
  { h: 'In denominator', tip: 'Whether the company counts toward the verified portfolio, and why not if it doesn’t (in review, or found only by matching our workspaces).' },
]

const STATUS_FILTERS = ['All', 'Not on Clay', 'With a workspace', 'Free workspace', 'Paid', 'Eligible', 'Needs check', 'Redeemed', 'Not in denominator'] as const
type StatusFilter = typeof STATUS_FILTERS[number]
const STEP_TO_FILTER: Record<StepId, StatusFilter> = { portfolio: 'All', workspace: 'With a workspace', paying: 'Paid', eligible: 'Eligible', redeemed: 'Redeemed' }

type Cut = 'partnered' | 'not' | 'all'

export default function PortfolioView() {
  const [cut, setCut] = useState<Cut>('partnered')
  const [step, setStep] = useState<StepId | null>(null)
  const [status, setStatus] = useState<StatusFilter>('All')
  const [q, setQ] = useState('')
  const pick = (s: StepId | null) => { setStep(s); setStatus(s ? STEP_TO_FILTER[s] : 'All') }

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Firm cut" value={cut} onChange={setCut}
          options={[{ id: 'partnered', label: 'Partnered firms' }, { id: 'not', label: 'Not partnered' }, { id: 'all', label: 'All firms' }]} />
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: T.muted }}>
          Firm
          <select disabled className="rounded-full px-3 py-2 text-[14px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.faint }}>
            <option>All firms in the cut</option>
          </select>
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <Strip selected={step} onSelect={pick} />
        <p className="text-[14px]" style={{ color: T.muted }}>
          Click a number to list exactly those companies below. Penetration is over the whole verified portfolio; redemption only over companies confirmed eligible.
        </p>
      </section>

      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Firms</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Click a firm to filter the numbers above and the companies below to it. A company backed by two firms counts in both rows, once in the totals.</p>
        <Table cols={FIRM_COLS} minW={1280} empty={<><NC why={NOT_SYNCED} /> · needs the roster synced from Supabase</>} />
        <ColDefs cols={FIRM_COLS} />
      </Card>

      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>Companies</H2>
          <button type="button" disabled title="Available once the roster is synced"
            className="rounded-full px-4 py-2 text-[14px] font-medium disabled:cursor-not-allowed"
            style={{ background: '#EFEEEA', color: T.faint }}>Export CSV</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search company or domain"
            className="rounded-full px-4 py-2 text-[14px] min-w-[240px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map(f => (
              <button key={f} type="button" onClick={() => { setStatus(f); setStep(null) }} aria-pressed={status === f}
                className="rounded-full px-3 py-1.5 text-[13px]"
                style={{ background: status === f ? T.ink : '#fff', color: status === f ? '#fff' : T.ink, border: `1px solid ${status === f ? T.ink : T.border}` }}>{f}</button>
            ))}
          </div>
        </div>
        <Table cols={COMPANY_COLS} minW={1120} empty={<><NC why={NOT_SYNCED} /> · will list {status === 'All' ? 'every verified portfolio company' : `companies: ${status}`}{cut !== 'all' ? (cut === 'partnered' ? ' at partnered firms' : ' at non-partnered firms') : ''}{q ? ` matching “${q}”` : ''}</>} />
        <ColDefs cols={COMPANY_COLS} />
      </Card>

      <p className="text-[13px]" style={{ color: T.muted }}>
        Source: the Clay portfolio workflow, landed in Supabase (roster, evidence, weekly snapshots), joined live to Snowflake for workspaces and paid status.
        Redemption needs promo-code redemptions in Snowflake and stays Not connected until then.
      </p>
    </div>
  )
}
