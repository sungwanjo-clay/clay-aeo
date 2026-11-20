'use client'

import { useMemo, useState } from 'react'
import { NURTURE, RETIER, t4rate, tier4Csv, tier4Insight, type NurturePath, type T4Account, type T4Cohort, type Tier4View as V } from '@/lib/plg/slg/compute'
import { TIER4 } from '@/lib/plg/slg/tier4sql'
import { usd } from '@/lib/plg/insights'
import WhatMoved from '../WhatMoved'
import { Card, Delta, Eyebrow, H2, InfoTip, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'
const dp = (r: number | null) => (r != null && r < 0.1 ? 1 : 0)
const rel = (c: number, p: number) => (p ? (c - p) / p : null)
const pp = (r: number | null, pr: number | null) => (r == null || pr == null ? null : (r - pr) * 100)

function Tile({ label, value, tip, children }: { label: string; value: string; tip: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow><InfoTip label={`About ${label}`}>{tip}</InfoTip></div>
      <p className="text-[40px] leading-none" style={{ ...mono, color: T.ink }}>{value}</p>
      <p className="text-[15px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}
const ppLine = (r: number | null, pr: number | null) => {
  const d = pp(r, pr)
  return d == null ? <>–</> : <><span style={{ ...mono, color: deltaColor(d) }}>{fmtPp(Math.abs(d) < 0.05 ? 0 : d)}</span> <span style={{ color: T.muted }}>vs period before ({fmtPct(pr, dp(pr))})</span></>
}

const STEPS: { k: keyof T4Cohort; label: string; def: string }[] = [
  { k: 'accounts', label: 'Tier 4 accounts raising a hand', def: 'Accounts with an SLG touchpoint while Tier 4 (demo form, webinar, event, contact form…)' },
  { k: 'workspace', label: 'Have a workspace', def: 'A work-domain workspace on the account’s domain, created any time' },
  { k: 'newWs', label: 'Created a workspace after', def: 'A workspace created on or after the account’s first Tier 4 touchpoint in the period' },
  { k: 'activated', label: 'Activated', def: 'A workspace on the domain has been activated' },
  { k: 'paying', label: 'Paying now', def: 'A workspace on the domain has invoiced and is a current customer' },
  { k: 'retiered', label: 'Moved up to Tier 1–3', def: 'The Salesforce account is Tier 1–3 today' },
  { k: 's2', label: 'Reached S2', def: 'A new-business opportunity on the account entered S2 after the touchpoint (sourced or not)' },
]

export default function Tier4View({ v, loading, onExport }: { v: V; loading?: boolean; onExport?: (filename: string, csv: string) => Promise<void> }) {
  const insight = useMemo(() => tier4Insight(v), [v])
  const c = v.cur, p = v.prev
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Tier 4 accounts raising a hand" value={fmtInt(c.accounts)}
          tip={<>Salesforce accounts with an SLG touchpoint in the range while the account was Tier 4. Tier 4 never counts as an MQAL, so these don’t get an SDR demo. Aggregator accounts (gmail.com and the like) are left out.</>}>
          <Delta value={rel(c.accounts, p.accounts)}>{fmtPctSigned(rel(c.accounts, p.accounts))}</Delta> <span style={{ color: T.muted }}>vs period before ({fmtInt(p.accounts)})</span>
        </Tile>
        <Tile label="Created a workspace after" value={fmtPct(t4rate(c, 'newWs'), dp(t4rate(c, 'newWs')))}
          tip={<>Share of those accounts where a work-domain workspace was created on or after their first Tier 4 touchpoint in the range.</>}>
          {fmtInt(c.newWs)} accounts · {ppLine(t4rate(c, 'newWs'), t4rate(p, 'newWs'))}
        </Tile>
        <Tile label="Paying now" value={fmtPct(t4rate(c, 'paying'), dp(t4rate(c, 'paying')))}
          tip={<>Share of those accounts with a paying self-serve workspace on their domain today.</>}>
          {fmtInt(c.paying)} accounts · {ppLine(t4rate(c, 'paying'), t4rate(p, 'paying'))}
        </Tile>
        <Tile label="Moved up to Tier 1–3" value={fmtPct(t4rate(c, 'retiered'), 1)}
          tip={<>Share of those accounts that are Tier 1–3 in Salesforce today, so a rep can now work them. Reached S2 counts any new-business S2 on the account after the touchpoint.</>}>
          {fmtInt(c.retiered)} accounts · {fmtInt(c.s2)} reached S2<br />{ppLine(t4rate(c, 'retiered'), t4rate(p, 'retiered'))}
        </Tile>
      </div>

      <WhatMoved insight={insight} />

      <Movement v={v} />

      <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-2">
        <Types v={v} />
        <Months v={v} />
      </div>

      <Accounts rows={v.accounts} onExport={onExport} />
    </div>
  )
}

function Movement({ v }: { v: V }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Where they went</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>The period’s Tier 4 hand-raisers and where they are today, as a share of the accounts. Outcomes are as of today, so the period before has had longer to move.</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[720px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step</th><th className={`${th} text-right`}>This period</th><th className={`${th} text-right`}>Share</th>
            <th className={`${th} text-right`}>Period before</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Change</th>
          </tr></thead>
          <tbody>{STEPS.map((s, i) => {
            const r = i ? t4rate(v.cur, s.k) : null, pr = i ? t4rate(v.prev, s.k) : null
            const d = i ? pp(r, pr) : null
            const cd = i ? null : rel(v.cur.accounts, v.prev.accounts)
            return (
              <tr key={s.k} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5"><p className="font-semibold">{s.label}</p><p className="text-[13px]" style={{ color: T.muted }}>{s.def}</p></td>
                <td className={num} style={mono}>{fmtInt(v.cur[s.k])}</td>
                <td className={num} style={mono}>{i ? fmtPct(r, dp(r)) : ''}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{fmtInt(v.prev[s.k])}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{i ? fmtPct(pr, dp(pr)) : ''}</td>
                <td className={num} style={{ ...mono, color: deltaColor(i ? d : cd) }}>{i ? (d == null ? '–' : fmtPp(Math.abs(d) < 0.05 ? 0 : d)) : fmtPctSigned(cd)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

function Types({ v }: { v: V }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>How they raised a hand</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Tier 4 accounts by touchpoint type. An account can appear under more than one type.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}><th className={`${th} text-left`}>Touchpoint</th><th className={`${th} text-right`}>Accounts</th><th className={`${th} text-right`}>Before</th><th className={`${th} text-right`}>Change</th></tr></thead>
          <tbody>{v.types.map(t => {
            const d = rel(t.cur.accounts, t.prev.accounts)
            return (
              <tr key={t.type} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5">{t.type}</td>
                <td className={num} style={mono}>{fmtInt(t.cur.accounts)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{fmtInt(t.prev.accounts)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(d) }}>{fmtPctSigned(d)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

function Months({ v }: { v: V }) {
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  const cols: { k: keyof T4Cohort; label: string }[] = [{ k: 'newWs', label: 'New ws' }, { k: 'paying', label: 'Paying' }, { k: 'retiered', label: 'Tier 1–3' }, { k: 's2', label: 'S2' }]
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Monthly cohorts</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Accounts by the month of their first Tier 4 touchpoint since {label(TIER4.cohortStart.slice(0, 7))}, and the share that has moved since. Fixed months, so they don’t change with the date filter.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}><th className={`${th} text-left`}>Month</th><th className={`${th} text-right`}>Accounts</th>{cols.map(c => <th key={c.k} className={`${th} text-right`}>{c.label}</th>)}</tr></thead>
          <tbody>{v.months.map(m => (
            <tr key={m.month} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-2.5">{label(m.month)}</td>
              <td className={num} style={mono}>{fmtInt(m.accounts)}</td>
              {cols.map(c => { const r = t4rate(m, c.k); return <td key={c.k} className={num} style={mono} title={`${fmtInt(m[c.k])} accounts`}>{fmtPct(r, c.k === 's2' ? 1 : dp(r))}</td> })}
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
  )
}

type SortKey = 'score' | 'name' | 'employees' | 'touchpoints' | 'last' | 'arr' | 'days28'
function Accounts({ rows, onExport }: { rows: T4Account[] | null; onExport?: (filename: string, csv: string) => Promise<void> }) {
  const [path, setPath] = useState<NurturePath | 'all'>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 })
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const counts = useMemo(() => Object.fromEntries(NURTURE.map(n => [n.id, rows?.filter(r => r.path === n.id).length ?? 0])), [rows])
  const list = useMemo(() => {
    if (!rows) return []
    const ql = q.trim().toLowerCase()
    const xs = rows.filter(r => (path === 'all' || r.path === path) && (!ql || r.name.toLowerCase().includes(ql) || r.domain.includes(ql) || (r.industry ?? '').toLowerCase().includes(ql)))
    const val = (r: T4Account) => (sort.key === 'name' ? r.name.toLowerCase() : sort.key === 'last' ? r.last : r[sort.key] ?? null)
    return [...xs].sort((a, b) => { const x = val(a), y = val(b); return x == null ? 1 : y == null ? -1 : (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }, [rows, path, sort, q])
  const sh = (k: SortKey, label: string, right = true) => {
    const on = sort.key === k
    return <th key={k} className={`${th} ${right ? 'text-right' : 'text-left'}`} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="uppercase inline-flex items-center gap-1" style={{ color: on ? T.ink : T.muted, letterSpacing: 'inherit' }}
        onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : right ? -1 : 1 })}>{label}<span aria-hidden style={{ opacity: on ? 1 : 0.35 }}>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span></button>
    </th>
  }
  const doExport = async () => {
    if (!onExport) return
    try { await onExport(`tier4-${path === 'all' ? 'all' : path.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, tier4Csv(list)); setMsg(null) } catch { setMsg('Export was cancelled or isn’t available here.') }
  }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <H2>Tier 4 accounts to nurture</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>Accounts still Tier 4 with a touchpoint in the last {TIER4.listDays} days, top {TIER4.listLimit} by score. Each gets one PLG nurture path.</p>
        </div>
        <button type="button" onClick={doExport} disabled={!onExport || !list.length} title={onExport ? `Download these ${list.length} accounts as CSV` : 'Downloads aren’t available in this view'}
          className="rounded-full px-4 py-2 text-[14px] font-medium" style={{ background: onExport && list.length ? T.ink : '#EFEEEA', color: onExport && list.length ? '#fff' : T.faint }}>Export CSV</button>
      </div>
      {msg && <p className="text-[13px]" style={{ color: T.neg }}>{msg}</p>}
      {!rows ? <p className="text-[15px]" style={{ color: T.muted }}>Querying Sigma for the account list…</p> : <>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
          {NURTURE.map(n => {
            const on = path === n.id
            return (
              <button key={n.id} type="button" onClick={() => setPath(on ? 'all' : n.id)} aria-pressed={on}
                className="rounded-2xl p-3 text-left flex flex-col gap-1" style={{ background: on ? '#E8F6F8' : T.tile, border: `1px solid ${on ? '#9ED6DE' : 'transparent'}` }}>
                <span className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-semibold">{n.id}</span><span style={mono}>{fmtInt(counts[n.id])}</span></span>
                <span className="text-[12px]" style={{ color: T.muted }}>{n.rule}</span>
                <span className="text-[12px]" style={{ color: T.ink }}>{n.play}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search account, domain or industry" aria-label="Search accounts"
            className="rounded-full px-4 py-2 text-[14px] w-full sm:w-[320px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }} />
          <span className="text-[13px]" style={{ color: T.muted }}>{fmtInt(list.length)} accounts{path !== 'all' ? ` · ${path}` : ''}</span>
        </div>
        <div className="overflow-auto max-h-[640px] rounded-xl" style={{ border: `1px solid ${T.border}` }}>
          <table className="w-full min-w-[1080px] text-[14px]" style={{ color: T.ink }}>
            <thead className="sticky top-0 z-10" style={{ background: '#fff' }}><tr style={head}>
              {sh('name', 'Account', false)}{sh('employees', 'Employees')}<th className={`${th} text-left`}>Industry · region</th>
              {sh('touchpoints', 'Touchpoints')}{sh('last', 'Last')}<th className={`${th} text-left`}>Product</th>{sh('days28', 'Active 28d')}{sh('arr', 'ARR')}
              {sh('score', 'Score')}<th className={`${th} text-left`}>Path</th>
            </tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2"><p className="font-medium">{r.name}</p><p className="text-[12px]" style={{ color: T.muted }}>{r.domain}</p></td>
                <td className={num} style={mono}>{fmtInt(r.employees)}</td>
                <td className="px-3 py-2"><p>{r.industry ?? '–'}</p><p className="text-[12px]" style={{ color: T.muted }}>{r.region ?? ''}</p></td>
                <td className={num} style={mono}>{fmtInt(r.touchpoints)}{r.demo && <span title="Filled in a demo or contact-sales form" style={{ color: T.pos }}> ●</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap"><p style={mono}>{r.last}</p><p className="text-[12px]" style={{ color: T.muted }}>{r.lastType ?? ''}</p></td>
                <td className="px-3 py-2"><p>{r.workspaces ? `${fmtInt(r.workspaces)} workspace${r.workspaces === 1 ? '' : 's'}` : 'No workspace'}</p>
                  <p className="text-[12px]" style={{ color: T.muted }}>{r.paying ? `Paying${r.plan ? ` · ${r.plan}` : ''}` : r.activated ? 'Activated, not paying' : r.workspaces ? 'Not activated' : ''}</p></td>
                <td className={num} style={mono}>{r.workspaces ? fmtInt(r.days28) : '–'}</td>
                <td className={num} style={mono}>{r.arr ? usd(r.arr) : '–'}</td>
                <td className={num} style={mono} title={`Size ${r.parts.size} + intent ${r.parts.intent} + product ${r.parts.product}`}>{fmtInt(r.score)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.path}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p className="text-[13px]" style={{ color: T.muted }}>
          Score (0–100): <b>size</b> up to 30 (200+ employees 30, 50–199 22, 20–49 14, 10–19 8); <b>intent</b> 20 for a demo or contact-sales form, plus 10 for 3+ touchpoints (5 for 2);
          <b> product</b> 15 for an activated workspace, 10 for 5+ active days in the last 28, 10 for paying. Hover a score for its parts. Paths are checked in order:
          {' '}re-tier review ({RETIER.employees}+ employees or {usd(RETIER.arr)}+ ARR) first, then expansion, upgrade, activation, trial invite.
        </p>
      </>}
    </Card>
  )
}
