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
import { Card, Eyebrow, H2, InfoTip, Pill, Segmented, T, fmtInt, fmtPct, fmtPp } from '../ui'
import {
  CUT_LABEL, STATUS_FILTERS, countsFor, csvOf, filterCompanies, rate,
  type CompanyRow, type Counts, type CutFilter, type PortfolioData, type StatusFilter,
} from '@/lib/plg/portfolio/data'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const mono = { fontFamily: T.mono } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const PAGE = 200

function NC({ why }: { why?: string }) {
  return <span title={why} style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>
}
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '–'

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
function Head({ cols }: { cols: Col[] }) {
  return <thead><tr style={head}>{cols.map(c => <th key={c.h} className={`${th} ${c.num ? 'text-right' : 'text-left'}`}>{c.h}</th>)}</tr></thead>
}

/* ───────────────────────── Strip ───────────────────────── */
type StepId = 'portfolio' | 'workspace' | 'paying' | 'eligible' | 'redeemed'
const STEP_FILTER: Record<StepId, StatusFilter> = { portfolio: 'All', workspace: 'With a workspace', paying: 'Paying now', eligible: 'Eligible', redeemed: 'Redeemed' }
const STEP_TIP: Record<StepId, string> = {
  portfolio: 'Companies verified as backed by the selected firms, from firm-first sources (official rosters, Harmonic, PitchBook, Crunchbase, Dealroom, portfolio pages, partner lists, announcements), frozen when the week closed. Companies found only by matching our own workspaces don’t count.',
  workspace: 'Companies Clay matched to at least one Clay workspace in Snowflake, free or paid, on an exact domain. Lookups that failed or need review are shown as unknown, never as zero.',
  paying: 'Companies with a workspace that is paying now, as Clay read it from Snowflake. “Ever paid” counts any first invoice.',
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

function Strip({ c, p, eligibilityConnected, selected, onSelect }: {
  c: Counts | null; p: Counts | null; eligibilityConnected: boolean; selected: StepId | null; onSelect: (s: StepId | null) => void
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
        sub={<><b style={mono}>{fmtPct(pay)}</b> of portfolio · {fmtInt(c.ever_paid)} ever paid{c.paying_unknown > 0 && <><br />{fmtInt(c.paying_unknown)} with a workspace, paid status unknown</>}</>} />
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
  { h: 'Firm' }, { h: 'Type' },
  { h: 'Partner', tip: 'Partnered = the Partner box is checked in the Venture Partner Program sheet and the firm isn’t on To Approve. Pending = on To Approve. Proven is shown as a separate tag and doesn’t make a firm partnered.' },
  { h: 'Portfolio', num: true, tip: 'Verified portfolio companies in the latest week: the denominator.' },
  { h: 'With a workspace', num: true }, { h: 'Penetration', num: true, tip: 'With a workspace ÷ portfolio.' },
  { h: 'Unknown', num: true, tip: 'Companies whose workspace lookup failed or needs review. Not counted as zero.' },
  { h: 'Paying now', num: true }, { h: 'Ever paid', num: true },
  { h: 'Eligible', num: true, tip: 'Confirmed eligible since tracking began.' },
  { h: 'Redeemed', num: true },
  { h: 'Shared by partner', num: true, tip: 'Companies that were on a list the firm shared with us. A coverage check.' },
  { h: 'Roster refreshed', tip: 'Last successful roster run for the firm.' },
]

/* ───────────────────────── Companies ───────────────────────── */
const COMPANY_COLS: Col[] = [
  { h: 'Company', tip: 'Name and current domain.' },
  { h: 'Firm(s)', tip: 'Firms in the list that back it.' },
  { h: 'Clay workspace', tip: 'From Clay’s Snowflake lookup: matched (with the number of workspaces), no exact match, or unknown when the lookup failed or needs review.' },
  { h: 'Paid', tip: 'Paying now, ever paid, or not. Unknown when Clay didn’t read paid status.' },
  { h: 'Offer', tip: 'Eligible since tracking began, and redemption. Redemption shows Not connected until promo-code events are in.' },
  { h: 'Stage' }, { h: 'Last round' },
  { h: 'Counted', tip: 'Whether the company is in the denominator, and why not: in review, or found only by matching our workspaces.' },
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

export default function PortfolioView({ data, onExport }: { data: PortfolioData | null | undefined; onExport?: (filename: string, csv: string) => Promise<void> }) {
  const [cut, setCut] = useState<CutFilter>('partnered')
  const [firmId, setFirmId] = useState<string | null>(null)
  const [step, setStep] = useState<StepId | null>(null)
  const [status, setStatus] = useState<StatusFilter>('All')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const meta = data?.meta
  const latest = meta?.latest?.snapshot_date ?? null
  const firmName = useMemo(() => {
    const m = new Map((meta?.firms ?? []).map(f => [f.firm_id, f.name]))
    return (id: string) => m.get(id) ?? 'Unknown firm'
  }, [meta])
  const firmsById = useMemo(() => new Map((meta?.firms ?? []).map(f => [f.firm_id, f])), [meta])

  const firmRows = useMemo(() => (meta && latest
    ? meta.firmRows.filter(r => r.snapshot_date === latest && (cut === 'all' || r.partnership_cut === cut)).sort((a, b) => b.portfolio - a.portfolio)
    : []), [meta, latest, cut])
  const firmsWithoutRoster = useMemo(() => {
    if (!meta) return 0
    const has = new Set(meta.firmRows.filter(r => r.snapshot_date === latest).map(r => r.firm_id))
    return meta.firms.filter(f => (cut === 'all' || f.partnership_cut === cut) && !has.has(f.firm_id)).length
  }, [meta, latest, cut])

  const c = meta ? countsFor(meta, latest, cut, firmId) : null
  const p = meta ? countsFor(meta, meta.previous, cut, firmId) : null
  const list = useMemo(() => (data ? filterCompanies(data.companies, { cut, firmId, status, q }) : []), [data, cut, firmId, status, q])

  const setCutAndReset = (v: CutFilter) => { setCut(v); setFirmId(null); setShown(PAGE) }
  const pickStep = (s: StepId | null) => { setStep(s); setStatus(s ? STEP_FILTER[s] : 'All'); setShown(PAGE) }
  const pickFirm = (id: string | null) => { setFirmId(id); setShown(PAGE) }
  const doExport = async () => {
    if (!onExport || !latest) return
    const name = `portfolio-${latest}-${firmId ? firmName(firmId).toLowerCase().replace(/[^a-z0-9]+/g, '-') : cut}-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
    try { await onExport(name, csvOf(list, firmName)); setExportMsg(null) } catch { setExportMsg('Export was cancelled or isn’t available here.') }
  }

  if (data === undefined) return <p className="text-[15px]" style={{ color: T.muted }}>Loading the portfolio snapshot…</p>
  if (!meta) return <p className="text-[15px]" style={{ color: T.muted }}>The portfolio data hasn’t been synced to this dashboard yet.</p>

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Firm cut" value={cut} onChange={setCutAndReset}
          options={(['partnered', 'pending', 'not_partnered', 'all'] as CutFilter[]).map(id => ({ id, label: CUT_LABEL[id] }))} />
        <label className="inline-flex items-center gap-2 text-[14px]" style={{ color: T.muted }}>
          Firm
          <select value={firmId ?? ''} onChange={e => pickFirm(e.target.value || null)} disabled={!firmRows.length}
            className="rounded-full px-3 py-2 text-[14px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }}>
            <option value="">All firms in the cut</option>
            {firmRows.map(r => <option key={r.firm_id} value={r.firm_id}>{firmName(r.firm_id)}</option>)}
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
        </Card>
      ) : (<>
        <section className="flex flex-col gap-3">
          {c ? <Strip c={c} p={p} eligibilityConnected={meta.eligibilityConnected} selected={step} onSelect={pickStep} />
            : <p className="text-[15px]" style={{ color: T.muted }}>No verified portfolio companies for {firmId ? firmName(firmId) : CUT_LABEL[cut].toLowerCase()} in this week.</p>}
          <p className="text-[14px]" style={{ color: T.muted }}>
            {firmId ? <>Showing {firmName(firmId)}. <button type="button" className="underline" onClick={() => pickFirm(null)}>Show the whole cut</button>. </> : null}
            Click a number to list exactly those companies below. Penetration is over the whole verified portfolio; redemption only over companies confirmed eligible.
          </p>
        </section>

        <Card className="p-5 sm:p-8 flex flex-col gap-4">
          <H2>Firms</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>Click a firm to filter the numbers and companies to it. A company backed by two firms counts in both rows, once in the totals.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[1280px] text-[15px]" style={{ color: T.ink }}>
            <Head cols={FIRM_COLS} />
            <tbody>
              {firmRows.length ? firmRows.map(r => {
                const f = firmsById.get(r.firm_id)
                const on = firmId === r.firm_id
                return (
                  <tr key={r.firm_id} onClick={() => pickFirm(on ? null : r.firm_id)} className="cursor-pointer"
                    style={{ borderBottom: `1px solid ${T.border}`, background: on ? '#E8F6F8' : undefined }}>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">{firmName(r.firm_id)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{f?.firm_type === 'accelerator' ? 'Accelerator' : 'VC fund'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{CUT_LABEL[r.partnership_cut]}{f?.on_proven_tab ? <span className="ml-2 text-[12px] rounded-full px-2 py-0.5" style={{ background: '#EFEEEA' }}>Proven</span> : null}</td>
                    <td className={num} style={mono}>{fmtInt(r.portfolio)}</td>
                    <td className={num} style={mono}>{fmtInt(r.with_workspace)}</td>
                    <td className={num} style={mono}>{fmtPct(rate(r.with_workspace, r.portfolio))}</td>
                    <td className={num} style={{ ...mono, color: r.workspace_unknown ? T.amberInk : T.faint }}>{fmtInt(r.workspace_unknown)}</td>
                    <td className={num} style={mono}>{fmtInt(r.paying_now)}</td>
                    <td className={num} style={mono}>{fmtInt(r.ever_paid)}</td>
                    <td className={num} style={mono}>{meta.eligibilityConnected ? fmtInt(r.eligible_to_date) : <NC />}</td>
                    <td className={num} style={mono}>{r.redemption_connected ? fmtInt(r.redeemed) : <NC />}</td>
                    <td className={num} style={mono}>{fmtInt(r.shared_by_partner ?? 0)}</td>
                    <td className="px-3 py-3 whitespace-nowrap" style={{ color: T.muted }}>{fmtDate(f?.roster_refreshed_at)}</td>
                  </tr>
                )
              }) : <tr><td colSpan={FIRM_COLS.length} className="px-3 py-4 text-[14px]" style={{ color: T.muted }}>No firm in this cut has a roster in this week yet.</td></tr>}
            </tbody>
          </table></div>
          {firmsWithoutRoster > 0 && <p className="text-[13px]" style={{ color: T.muted }}>{fmtInt(firmsWithoutRoster)} more {firmsWithoutRoster === 1 ? 'firm' : 'firms'} in this cut {firmsWithoutRoster === 1 ? 'has' : 'have'} no roster yet.</p>}
          <ColDefs cols={FIRM_COLS} />
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
          <div className="flex flex-wrap items-center gap-3">
            <input type="search" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} placeholder="Search company or domain"
              className="rounded-full px-4 py-2 text-[14px] min-w-[240px]" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }} />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map(f => (
                <button key={f} type="button" onClick={() => { setStatus(f); setStep(null); setShown(PAGE) }} aria-pressed={status === f}
                  className="rounded-full px-3 py-1.5 text-[13px]"
                  style={{ background: status === f ? T.ink : '#fff', color: status === f ? '#fff' : T.ink, border: `1px solid ${status === f ? T.ink : T.border}` }}>{f}</button>
              ))}
            </div>
          </div>
          <p className="text-[14px]" style={{ color: T.muted, ...mono }}>{fmtInt(list.length)} {list.length === 1 ? 'company' : 'companies'}</p>
          {exportMsg && <p className="text-[13px]" style={{ color: T.neg }}>{exportMsg}</p>}
          <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-[15px]" style={{ color: T.ink }}>
            <Head cols={COMPANY_COLS} />
            <tbody>
              {list.length ? list.slice(0, shown).map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-3 py-3"><p className="font-semibold">{r.name}</p><p className="text-[13px]" style={{ ...mono, color: T.muted }}>{r.domain ?? 'stealth · no domain'}</p></td>
                  <td className="px-3 py-3 text-[14px]">{r.firms.map(firmName).join(', ')}</td>
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
                    : <span style={{ color: T.muted }}>{r.notCountedReason === 'in_review' ? 'No · in review' : r.notCountedReason === 'workspace_match_only' ? 'No · found via our workspaces' : 'No · not verified'}</span>}</td>
                </tr>
              )) : <tr><td colSpan={COMPANY_COLS.length} className="px-3 py-4 text-[14px]" style={{ color: T.muted }}>No companies match these filters.</td></tr>}
            </tbody>
          </table></div>
          {list.length > shown && (
            <button type="button" onClick={() => setShown(s => s + PAGE)} className="self-start rounded-full px-4 py-2 text-[14px]"
              style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink }}>Show {fmtInt(Math.min(PAGE, list.length - shown))} more</button>
          )}
          <ColDefs cols={COMPANY_COLS} />
        </Card>
      )}

      <p className="text-[13px]" style={{ color: T.muted }}>
        Source: the Clay portfolio workflow → Supabase weekly snapshots (roster frozen at the week’s close; workspace and paid status from Clay’s Snowflake lookup).
        This tab reads only the Supabase reporting views. Redemption stays Not connected until promo-code redemptions are available.
      </p>
    </div>
  )
}
