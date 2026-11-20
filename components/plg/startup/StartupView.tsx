'use client'

import { useState } from 'react'

import type { FunnelStep, StartupPeriod, StartupViewModel as SV } from '@/lib/plg/startup/compute'
import { ENABLEMENT, STEPS } from '@/lib/plg/startup/compute'
import WhatMoved from '../WhatMoved'
import { STARTUP } from '@/lib/plg/startup/sql'
import { fmtShort } from '@/lib/plg/dates'
import ProgressChart, { type ProgressMetric } from '../ProgressChart'
import { Card, Delta, Eyebrow, H2, InfoTip, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp, fmtSigned } from '../ui'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const mono = { fontFamily: T.mono } as const
const dp = (r: number | null) => (r != null && r < 0.1 ? 2 : 1)

function NC({ why }: { why?: string }) {
  return <span title={why} style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>
}
function ppTxt(r: number, pr: number) {
  const pp = (r - pr) * 100
  return <span style={{ ...mono, color: deltaColor(pp) }}>{fmtPp(pp)}</span>
}

function Tile({ label, value, children, muted, tip }: { label: string; value: React.ReactNode; children?: React.ReactNode; muted?: boolean; tip?: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
      <p className={muted ? 'text-[22px] leading-tight' : 'text-[40px] leading-none'} style={{ fontFamily: T.mono, color: muted ? T.faint : T.ink }}>{value}</p>
      {children && <p className="text-[15px] leading-snug" style={{ color: T.ink }}>{children}</p>}
    </div>
  )
}
const dl = (cur: number, prev: number) => {
  const d = prev ? (cur - prev) / prev : null
  return <><Delta value={d}>{fmtPctSigned(d)}</Delta> vs previous period</>
}

function Kpis({ s }: { s: SV }) {
  const { T: c, P: p } = s
  if (s.beforeLaunch || c.visits < 1) {
    return <div className="grid gap-4 grid-cols-1"><Tile label="No program data" value="–">The startup program launched {STARTUP.launch}. Pick a later range.</Tile></div>
  }
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="MQALs · Tier 1–3 domains" value={fmtInt(c.mqal)}
        tip={<>Distinct Tier 1–3 company domains (Salesforce sales tier) among new workspaces created by startup-page visitors. Counts companies, so two workspaces from one company count once. Same basis as “New workspaces (Tier 1–3)” in the funnel.</>}>
        {dl(c.mqal, p.mqal)}
      </Tile>
      <Tile label="Total new workspaces" value={fmtInt(c.newWs)}
        tip={<>Workspaces created within {STARTUP.newWindowDays} days of a visit to the startup page, all tiers and email types.</>}>
        {dl(c.newWs, p.newWs)}<br /><span style={mono}>{fmtInt(c.newWsT13)}</span> at Tier 1–3
      </Tile>
      <Tile label="Redemptions" value={<NC why="No offer sent yet; promo-code redemptions aren’t connected" />} muted
        tip={<>Count of startup offer redemptions in the range: workspaces that applied the startup discount, from Stripe promo-code redemptions. Not connected until the discount exists and is wired up.</>}>
        Not connected until the offer launches
      </Tile>
      <Tile label="Eligible workspaces" value={<NC why="Eligibility source isn’t in Snowflake yet" />} muted
        tip={<>New workspaces from companies that pass the Startup Offer Eligibility rule: verified Seed or Series A, VC-backed (Pre-Seed doesn’t qualify), and a net-new workspace. Backing from a partner firm can change the offer tier but doesn’t make a company eligible on its own. Comes from the eligibility workflow’s weekly snapshot in Snowflake, which isn’t hooked up yet.</>}>
        Source not hooked up yet
      </Tile>
    </div>
  )
}

function RateCards({ s }: { s: SV }) {
  if (s.beforeLaunch || s.T.visits < 1) return null
  // Same names and definitions as the Media properties rate tiles where the metric is the same.
  const LIFE = 'Lifecycle email events aren’t in Snowflake yet'
  const cards: { label: string; k: keyof StartupPeriod | null; p?: keyof StartupPeriod; desc: string; nc?: string }[] = [
    { label: 'Application rate', k: null, desc: 'Applications ÷ visits', nc: 'Typeform responses aren’t in Snowflake' },
    { label: 'Visit → workspace', k: 'newWs', p: 'visits', desc: 'New workspaces ÷ visits' },
    { label: 'Tier 1–3 share', k: 'newWsT13', p: 'newWs', desc: 'Tier 1–3 workspaces ÷ new workspaces' },
    { label: 'Email open rate', k: null, desc: 'Email opens ÷ email sends', nc: LIFE },
    { label: 'Email click-through rate', k: null, desc: 'Email clicks ÷ email opens', nc: LIFE },
    { label: 'Redemption rate', k: null, desc: 'Redeemed ÷ eligible workspaces offered', nc: 'No offer sent yet' },
    { label: 'Activation rate', k: 'activated', p: 'newWs', desc: 'Activated ÷ new workspaces' },
    { label: 'Paid rate', k: 'paid', p: 'newWs', desc: 'Paying ÷ new workspaces' },
  ]
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(c => {
        const r = c.k && c.p ? s.rate(s.T, c.k, c.p) : null
        const pr = c.k && c.p ? s.rate(s.P, c.k, c.p) : null
        return (
          <Card key={c.label} className="p-5 flex flex-col gap-2">
            <Eyebrow>{c.label}</Eyebrow>
            <p className="text-[32px] leading-none" style={{ ...mono, color: c.nc ? T.faint : T.ink }}>{c.nc ? <span className="text-[20px]"><NC why={c.nc} /></span> : fmtPct(r, dp(r))}</p>
            <p className="text-[14px]" style={{ color: T.muted }}>{r != null && pr != null ? <>{ppTxt(r, pr)} vs previous period ({fmtPct(pr, dp(pr))})</> : c.nc ? c.desc : <>– vs previous period</>}</p>
            {!c.nc && <p className="text-[12px]" style={{ color: T.faint }}>{c.desc}</p>}
          </Card>
        )
      })}
    </div>
  )
}

function Funnel({ s }: { s: SV }) {
  // Same layout as the Media properties funnel: each count, then its step rate on its own row (counts change in %, rates in pp).
  // Rates whose inputs aren't connected yet still say what they will divide.
  const RATE_DEF: Record<string, string> = { 'Application rate': 'Applications ÷ visits', 'Email open rate': 'Email opens ÷ email sends',
    'Email click-through rate': 'Email clicks ÷ email opens', 'Redemption rate': 'Redeemed ÷ eligible workspaces offered', 'Share of all new workspaces': 'Eligible ÷ total new workspaces' }
  type Row = { id: string; stage: string; kind: 'count' | 'rate'; label: string; def: string; cur: number | null; prev: number | null; nc?: string }
  const rows: Row[] = []
  let stage = ''
  for (const st of STEPS) {
    if ('h' in st) { stage = st.h; continue }
    rows.push({ id: st.name, stage, kind: 'count', label: st.name, def: st.lever, cur: st.k ? (s.T[st.k] as number) : null, prev: st.k ? (s.P[st.k] as number) : null, nc: st.nc })
    if (st.rl) rows.push({ id: `${st.name}-rate`, stage, kind: 'rate', label: st.rl, def: st.k && st.p ? `${st.name} ÷ ${String(STEPS.find(x => 'k' in x && x.k === st.p && 'name' in x) && (STEPS.find(x => 'k' in x && x.k === st.p) as { name: string }).name).toLowerCase()}` : RATE_DEF[st.rl] ?? st.lever,
      cur: st.k && st.p ? s.rate(s.T, st.k, st.p) : null, prev: st.k && st.p ? s.rate(s.P, st.k, st.p) : null, nc: st.nc ?? (!st.k || !st.p ? 'No source yet' : undefined) })
  }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Each count, then its step rate on its own row. Counts change in %, rates in percentage points (pp). Steps without a source read “Not connected” (hover for what’s missing).</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[700px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step</th><th className={`${th} text-right`}>This period</th><th className={`${th} text-right`}>Period before</th><th className={`${th} text-right`}>Change</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => {
            const isRate = r.kind === 'rate'
            const fmt = (v: number | null) => (v == null ? '–' : isRate ? fmtPct(v, dp(v)) : fmtInt(v))
            const d = r.cur == null || r.prev == null ? null : isRate ? (r.cur - r.prev) * 100 : r.prev ? (r.cur - r.prev) / r.prev : null
            return [
              (i === 0 || rows[i - 1].stage !== r.stage) && <tr key={`h-${r.id}`}><td colSpan={4} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{r.stage}</td></tr>,
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}`, background: isRate ? '#FAF9F6' : undefined }}>
                <td className={isRate ? 'px-3 py-2 pl-8' : 'px-3 py-3'}>
                  <p className={isRate ? 'text-[14px]' : 'font-semibold'}>{isRate && <span style={{ color: T.faint }}>↳ </span>}{r.label}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{r.def}</p>
                </td>
                <td className={num} style={mono}>{r.nc ? <NC why={r.nc} /> : fmt(r.cur)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{r.nc ? '' : fmt(r.prev)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(d) }}>{r.nc ? '' : d == null ? '–' : isRate ? fmtPp(Math.abs(d) < 0.05 ? 0 : d) : fmtPctSigned(d)}</td>
              </tr>,
            ]
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

function TiersAndReasons({ s }: { s: SV }) {
  const rows = s.T.tiers.map((t, i) => {
    const pt = s.P.tiers[i]
    const r = s.T.newWs ? t.newWs / s.T.newWs : null
    const pr = s.P.newWs ? pt.newWs / s.P.newWs : null
    return { ...t, r, pr }
  })
  const mx = Math.max(0.0001, ...rows.map(r => r.r ?? 0))
  const notQ = s.T.reasons.reduce((a, r) => a + r.people, 0)
  const top = s.T.reasons[0]?.people ?? 0
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>MQALs and new workspaces by tier</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>MQALs = Tier 1–3 company domains with a new workspace. Share = the tier’s new workspaces ÷ all new workspaces.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Tier</th><th className={`${th} text-right`}>MQALs</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Redeemed</th><th className={`${th} text-right`}>Share of new WS</th><th className={`${th} text-right`}>Δ share</th>
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.tier} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{r.tier}</td>
              <td className={num} style={mono}>{fmtInt(r.mqal)}</td>
              <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
              <td className={num}><NC why="No offer sent yet" /></td>
              <td className="px-3 py-3">
                <div className="flex gap-2.5 items-center justify-end">
                  <div className="h-[10px] w-[120px] rounded-full overflow-hidden" style={{ background: T.barTrack }}>
                    <div className="h-full rounded-full" style={{ width: `${((r.r ?? 0) / mx) * 100}%`, background: T.pos }} />
                  </div>
                  <span className="min-w-[48px] text-right" style={mono}>{fmtPct(r.r)}</span>
                </div>
              </td>
              <td className={num}>{r.r != null && r.pr != null ? ppTxt(r.r, r.pr) : '–'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Why new workspaces didn’t qualify</H2>
        <p className="text-[15px]" style={{ color: T.muted }}><span style={mono}>{fmtInt(notQ)}</span> new workspaces weren’t at a Tier 1–3 domain.</p>
        <div className="flex flex-col gap-2.5">
          {s.T.reasons.map(r => (
            <div key={r.reason} className="grid items-center gap-3 text-[15px]" style={{ gridTemplateColumns: 'minmax(140px, 190px) 1fr 48px', color: T.ink }}>
              <span>{r.reason}</span>
              <div className="h-[12px] rounded-full overflow-hidden" style={{ background: T.barTrack }}>
                <div className="h-full rounded-full" style={{ width: `${top ? (r.people / top) * 100 : 0}%`, background: '#A8A49C' }} />
              </div>
              <span className="text-right" style={mono}>{fmtInt(r.people)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/** Sortable column header (same behaviour as the Portfolio and Media tables). */
type SortState = { key: string; dir: 1 | -1 }
function SortTh({ label, k, sort, set, right = true, title }: { label: React.ReactNode; k: string; sort: SortState; set: (s: SortState) => void; right?: boolean; title?: string }) {
  const on = sort.key === k
  return (
    <th className={`${th} ${right ? 'text-right' : 'text-left'}`} title={title} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => set({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : right ? -1 : 1 })} className="uppercase inline-flex items-center gap-1" style={{ color: on ? T.ink : T.muted, letterSpacing: 'inherit' }}>
        {label}<span aria-hidden style={{ opacity: on ? 1 : 0.35 }}>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}
const cmpVals = (a: number | string | null | undefined, b: number | string | null | undefined, dir: 1 | -1) =>
  a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir

type Camp = StartupPeriod['campaigns'][number]
const campKey = (c: Camp) => `${c.platform}|${c.campaign}`
const campName = (c: Camp) => (c.campaign && c.campaign !== '(no campaign)' ? c.campaign : 'No campaign name')
type CampFilter = 'all' | 'Google' | 'Meta' | 'LinkedIn' | 'other' | 'ws' | 'mqal'
const CAMP_FILTERS: { id: CampFilter; label: string }[] = [
  { id: 'all', label: 'All campaigns' }, { id: 'Google', label: 'Google' }, { id: 'Meta', label: 'Meta' }, { id: 'LinkedIn', label: 'LinkedIn' },
  { id: 'other', label: 'Other paid' }, { id: 'ws', label: 'Drove workspaces' }, { id: 'mqal', label: 'Drove MQALs' },
]
const campMatch = (f: CampFilter, c: Camp) => f === 'all' ? true : f === 'ws' ? c.newWs > 0 : f === 'mqal' ? c.mqal > 0 : f === 'other' ? !['Google', 'Meta', 'LinkedIn'].includes(c.platform) : c.platform === f

/** Paid campaigns: the tiles' metrics per campaign, quick filters, sortable; a row opens its headline numbers and the deep dive. */
function Campaigns({ s }: { s: SV }) {
  const [sort, setSort] = useState<SortState>({ key: 'visits', dir: -1 })
  const [cf, setCf] = useState<CampFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const prevOf = (c: Camp) => s.P.campaigns.find(x => campKey(x) === campKey(c))
  const val = (c: Camp): number | string | null => sort.key === 'campaign' ? campName(c).toLowerCase() : sort.key === 'platform' ? c.platform
    : sort.key === 'rate' ? (c.visits ? c.newWs / c.visits : null) : (c[sort.key as 'visits' | 'newWs' | 'mqal'] ?? null)
  const rows = s.T.campaigns.filter(c => campMatch(cf, c)).sort((a, b) => cmpVals(val(a), val(b), sort.dir))
  const delta = (cur: number, prev: number | undefined) => { const d = prev ? (cur - prev) / prev : null; return <span style={{ color: deltaColor(d), ...mono }}>{fmtPctSigned(d)}</span> }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Paid campaigns</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>The tiles’ metrics for each paid campaign. Judge campaigns on MQALs and new workspaces, not visits alone; spend and cost columns need ad spend in Snowflake. Select a campaign for its numbers vs the period before.</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter campaigns">
        {CAMP_FILTERS.map(f => {
          const n = s.T.campaigns.filter(c => campMatch(f.id, c)).length
          return <button key={f.id} type="button" aria-pressed={cf === f.id} onClick={() => setCf(f.id)} className="rounded-full px-3 py-1.5 text-[13px]"
            style={{ background: cf === f.id ? T.ink : '#fff', color: cf === f.id ? '#fff' : T.ink, border: `1px solid ${cf === f.id ? T.ink : T.border}` }}>{f.label} <span style={{ opacity: 0.6 }}>{n}</span></button>
        })}
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          <SortTh label="Campaign" k="campaign" sort={sort} set={setSort} right={false} /><SortTh label="Platform" k="platform" sort={sort} set={setSort} right={false} />
          <SortTh label="Visits" k="visits" sort={sort} set={setSort} /><SortTh label="Visit → workspace" k="rate" sort={sort} set={setSort} />
          <SortTh label="New workspaces" k="newWs" sort={sort} set={setSort} /><SortTh label="MQALs" k="mqal" sort={sort} set={setSort} />
          <th className={`${th} text-right`}>Spend</th><th className={`${th} text-right`}>Cost / MQAL</th>
        </tr></thead>
        <tbody>{rows.length ? rows.flatMap(c => {
          const k = campKey(c), p = prevOf(c)
          const out = [<tr key={k} style={{ borderBottom: open === k ? 'none' : `1px solid ${T.border}`, background: open === k ? '#E8F6F8' : undefined }}>
            <td className="px-3 py-3"><button type="button" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} className="font-semibold text-left hover:underline break-all" style={mono}>{campName(c)}</button></td>
            <td className="px-3 py-3">{c.platform}</td>
            <td className={num} style={mono}>{fmtInt(c.visits)}</td>
            <td className={num} style={mono}>{fmtPct(c.visits ? c.newWs / c.visits : null, 1)}</td>
            <td className={num} style={mono}>{fmtInt(c.newWs)}</td>
            <td className={num} style={mono}>{fmtInt(c.mqal)}</td>
            <td className={num}><NC why="No ad spend table in Snowflake" /></td>
            <td className={num} style={{ color: T.faint }}>–</td>
          </tr>]
          if (open === k) out.push(<tr key={`${k}-open`} style={{ borderBottom: `1px solid ${T.border}`, background: '#E8F6F8' }}>
            <td colSpan={8} className="px-3 pb-4">
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                {([['Visits', fmtInt(c.visits), delta(c.visits, p?.visits)], ['New workspaces', fmtInt(c.newWs), delta(c.newWs, p?.newWs)], ['MQALs', fmtInt(c.mqal), delta(c.mqal, p?.mqal)],
                  ['Visit → workspace', fmtPct(c.visits ? c.newWs / c.visits : null, 1), null]] as [string, string, React.ReactNode][]).map(([l, v, d]) => (
                  <div key={l} className="flex flex-col gap-0.5 min-w-[110px]"><span className="text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.1em', ...mono }}>{l}</span>
                    <span className="text-[20px]" style={mono}>{v}</span>{d && <span className="text-[12px]" style={{ color: T.muted }}>{d} vs before</span>}</div>))}
              </div>
            </td>
          </tr>)
          return out
        }) : <tr><td colSpan={8} className="px-3 py-4" style={{ color: T.muted }}>No paid-click visits to the page in this range{cf !== 'all' ? ' for this filter' : ''}.</td></tr>}</tbody>
      </table></div>
      <p className="text-[13px]" style={{ color: T.muted }}>Paid = a gclid, fbclid or LinkedIn click id, or a paid utm_medium.</p>
    </Card>
  )
}

/** Progress over the selected range, day by day, against the previous period (dashed). */
function Progress({ s }: { s: SV }) {
  if (s.beforeLaunch || s.T.visits < 1) return null
  const { cur, prev } = s.days
  const empty = 'Daily numbers arrive with the next refresh of this view.'
  const m = (id: 'visits' | 'newWs' | 'mqal' | 'activated', label: string, total: number, prevTotal: number, note?: string): ProgressMetric => ({
    id, label, fmt: fmtInt, empty,
    points: cur.map(p => ({ label: fmtShort(p.d), v: p[id] })),
    prev: prev.map(p => ({ label: fmtShort(p.d), v: p[id] })),
    summary: <><span style={{ ...mono, color: T.ink }}>{fmtInt(total)}</span> in this range · {dl(total, prevTotal)}</>,
    note,
  })
  const metrics = [
    m('visits', 'Visits', s.T.visits, s.P.visits, 'Unique visitors to the startup page each day.'),
    m('newWs', 'New workspaces', s.T.newWs, s.P.newWs, `By the visitor’s first visit day; a workspace counts if created within ${STARTUP.newWindowDays} days of it.`),
    m('mqal', 'MQALs (Tier 1–3 domains)', s.T.mqal, s.P.mqal, 'Tier 1–3 company domains with a new workspace, by first visit day.'),
    m('activated', 'Activated workspaces', s.T.activated, s.P.activated, 'New workspaces that ran a first table within 7 days, by first visit day.'),
    { id: 'redemptions', label: 'Redemptions', fmt: fmtInt, points: [], summary: <span style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>,
      empty: 'Redemptions: Not connected. They appear here once the startup discount launches and promo-code redemptions are in Snowflake.' },
  ]
  return <ProgressChart title="Progress" metrics={cur.length ? metrics : metrics.map(x => ({ ...x, points: [] }))} />
}

/** After redemption: the educational series and how much of it redeemers complete. Placeholders until the series exists. */
function Enablement() {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>After redemption: enablement</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Each workspace that redeems the offer gets a series of educational emails with videos and lessons. These show whether the emails get opened and how much of the material each redeemer completes.</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[640px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}><th className={`${th} text-left`}>Metric</th><th className={`${th} text-right`}>This period</th><th className={`${th} text-left`}>Definition</th></tr></thead>
          <tbody>{ENABLEMENT.map(m => (
            <tr key={m.label} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{m.label}</td>
              <td className={num}><NC why={m.nc} /></td>
              <td className="px-3 py-3 text-[14px]" style={{ color: T.muted }}>{m.def}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
  )
}

export default function StartupView({ s, loading }: { s: SV; loading: boolean }) {
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <Kpis s={s} />
      <Progress s={s} />
      <RateCards s={s} />
      <WhatMoved insight={s.insight} />
      <Funnel s={s} />
      <TiersAndReasons s={s} />
      <Campaigns s={s} />
      <Enablement />
      <p className="text-[14px]" style={{ color: T.muted }}>Partner penetration and portfolio companies: switch to <b>Portfolio partners</b> at the top of this tab.</p>
    </div>
  )
}
