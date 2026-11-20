'use client'

import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CRO } from '@/lib/plg/cro/sql'
import { PAGE_TYPES } from '@/lib/plg/cro/pageTypes'
import { ZONE_LABEL, botShare, convRate, croInsight, ctr, cut, demoShare, rate, trend, type CroCut, type CroData, type Seg, type SegRow } from '@/lib/plg/cro/compute'
import { mondayOf, type ISODate } from '@/lib/plg/dates'
import WhatMoved from '../WhatMoved'
import SectionBar, { Chip, MultiSelect } from '../SectionBar'
import { Card, Def, Delta, Eyebrow, H2, InfoTip, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-2.5 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'
const rel = (c: number, p: number) => (p ? (c - p) / p : null)
const PP = ({ c, p }: { c: number | null; p: number | null }) => {
  if (c == null || p == null) return <span style={{ color: T.faint }}>–</span>
  const d = (c - p) * 100
  return <span style={{ ...mono, color: deltaColor(Math.abs(d) < 0.05 ? 0 : d) }}>{fmtPp(Math.abs(d) < 0.05 ? 0 : d)}</span>
}
const KEY_PAGES = ['Homepage', 'Pricing']
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

function Tile({ label, value, tip, children, muted }: { label: string; value: string; tip?: React.ReactNode; children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="rounded-[22px] p-5 flex flex-col gap-2" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
      <p className="text-[34px] leading-none" style={{ ...mono, color: muted ? T.muted : T.ink }}>{value}</p>
      <p className="text-[14px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}
const ppLine = (c: number | null, p: number | null) => <><PP c={c} p={p} /> <span style={{ color: T.muted }}>vs period before ({fmtPct(p, 1)})</span></>

/** Conversion deep dive: every table, chart and tile follows the page-type filter in the section's sticky bar. */
export default function CroView({ v, loading }: { v: CroData; loading?: boolean }) {
  const [types, setTypes] = useState<string[]>([])
  const toggle = (t: string) => setTypes(x => (x.includes(t) ? x.filter(y => y !== t) : [...x, t]))
  const base = useMemo(() => cut(v, []), [v])
  const c = useMemo(() => (types.length ? cut(v, types) : base), [v, types, base])
  const insight = useMemo(() => croInsight(c), [c])
  const { cur, prev } = c.total
  const counts = new Map(base.landing.map(r => [r.id, r.cur.newVisitors]))
  const scope = types.length ? (types.length <= 3 ? types.join(' + ') : `${types.length} page types`) : 'All pages'
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <SectionBar label="Page type filter">
        <span className="text-[12px] uppercase mr-1" style={{ color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono }}>Page type</span>
        <Chip on={!types.length} onClick={() => setTypes([])}>All pages</Chip>
        <Chip on={sameSet(types, ['Homepage'])} onClick={() => setTypes(['Homepage'])}>Homepage</Chip>
        <Chip on={sameSet(types, ['Pricing'])} onClick={() => setTypes(['Pricing'])}>Pricing</Chip>
        <Chip on={sameSet(types, KEY_PAGES)} onClick={() => setTypes(KEY_PAGES)}>Homepage + Pricing</Chip>
        <MultiSelect label="All page types" value={types} onChange={setTypes}
          options={PAGE_TYPES.filter(t => counts.has(t)).map(t => ({ id: t, label: t, n: counts.get(t) }))} />
        <span className="text-[13px] sm:ml-auto" style={{ color: T.muted }}>Showing <b style={{ color: T.ink }}>{scope}</b></span>
      </SectionBar>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="New visitors" value={fmtInt(cur.newVisitors)}
          tip={<Def d="First-ever sessions from people with no workspace yet, by the page type they entered on." src="MARKETING_WEBSITE_SESSIONS" note="Likely bots (crawler IP, no Clay user id) are left out." />}>
          <Delta value={rel(cur.newVisitors, prev.newVisitors)}>{fmtPctSigned(rel(cur.newVisitors, prev.newVisitors))}</Delta> <span style={{ color: T.muted }}>vs period before</span>
        </Tile>
        <Tile label="Visit → workspace (1 day)" value={fmtPct(convRate(cur), 1)}
          tip={<Def d="New visitors who created a workspace within 24 hours of their first visit." src="COOKIE_TO_WORKSPACE_RELATIONSHIP → CUSTOMERS" note="The latest day reads low until its window closes." />}>
          {fmtInt(cur.converted)} workspaces · {ppLine(convRate(cur), convRate(prev))}
        </Tile>
        <Tile label="CTA click-through" value={fmtPct(ctr(cur), 1)}>
          {fmtInt(cur.clickers)} clickers · {ppLine(ctr(cur), ctr(prev))}
        </Tile>
        <Tile label="Demo share of CTA clicks" value={fmtPct(demoShare(cur), 0)}
          tip={<Def d="Demo clickers ÷ demo plus self-serve clickers." src="CONVERSION_BUTTON_CLICKED · button type" />}>
          {fmtInt(cur.demo)} demo · {fmtInt(cur.selfServe)} self-serve · <PP c={demoShare(cur)} p={demoShare(prev)} />
        </Tile>
        <Tile label="Likely-bot share" value={fmtPct(botShare(cur), 0)} muted
          tip={<Def d="Share of first-ever sessions flagged as likely bots and excluded from every other number here." src="MARKETING_IP_CRAWLER_CLASSIFICATION" />}>
          {fmtInt(cur.bots)} of {fmtInt(cur.entries)} entries · <PP c={botShare(cur)} p={botShare(prev)} />
        </Tile>
      </div>

      <WhatMoved insight={{ ...insight, title: 'What moved · conversion' }} />

      <Trend v={v} types={types.length ? types.slice(0, 6) : KEY_PAGES} defaulted={!types.length} more={types.length > 6} />

      <SegTable title="By page type" sub="Where new visitors first land. Click a row to add it to the filter." rows={base.landing} total={base.total.cur}
        selected={types} onPick={toggle} />

      <div className="grid gap-6 sm:gap-8 grid-cols-1 2xl:grid-cols-2">
        <SegTable title="By channel" sub={`Channel of the first session · ${scope}.`} rows={c.channels} compact />
        <SegTable title="By device" sub={`Operating system of the first session · ${scope}.`} rows={c.devices} compact />
      </div>

      <SegTable title="Top entry pages" sub={`The 40 entry pages with the most new visitors in each period (25 or more) · ${scope}. Use it to find pages that bring traffic but don’t convert.`} rows={c.paths} paths />

      <CtaZones c={c} filtered={types.length > 0} scope={scope} />
    </div>
  )
}

type SortKey = 'label' | 'visitors' | 'conv' | 'convD' | 'ctr' | 'demo' | 'ws'
function SegTable({ title, sub, rows, total, compact, paths, selected, onPick }: {
  title: string; sub: string; rows: SegRow[]; total?: Seg; compact?: boolean; paths?: boolean; selected?: string[]; onPick?: (id: string) => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'visitors', dir: -1 })
  const [all, setAll] = useState(false)
  const totalVisitors = total?.newVisitors ?? rows.reduce((a, r) => a + r.cur.newVisitors, 0)
  const val = (r: SegRow): number | string | null => {
    switch (sort.key) {
      case 'label': return r.label.toLowerCase()
      case 'visitors': return r.cur.newVisitors
      case 'ws': return r.cur.converted
      case 'conv': return convRate(r.cur)
      case 'convD': { const a = convRate(r.cur), b = convRate(r.prev); return a == null || b == null ? null : a - b }
      case 'ctr': return ctr(r.cur)
      case 'demo': return demoShare(r.cur)
    }
  }
  const sorted = [...rows].sort((a, b) => { const x = val(a), y = val(b); return x == null ? 1 : y == null ? -1 : (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  const shown = paths && !all ? sorted.slice(0, 25) : sorted
  const S = (k: SortKey, label: string, right = true, tip?: string) => {
    const on = sort.key === k
    return <th key={k} title={tip} className={`${th} ${right ? 'text-right' : 'text-left'} sticky top-0 z-10`} style={{ background: '#fff' }}>
      <button type="button" className="uppercase inline-flex items-center gap-1" style={{ color: on ? T.ink : T.muted, letterSpacing: 'inherit' }}
        onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : right ? -1 : 1 })}>{label}<span aria-hidden style={{ opacity: on ? 1 : 0.35 }}>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span></button>
    </th>
  }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1"><H2>{title}</H2><p className="text-[15px]" style={{ color: T.muted }}>{sub}</p></div>
      {!rows.length ? <p className="text-[15px]" style={{ color: T.muted }}>No new visitors for this selection.</p> :
      <div className={`overflow-auto rounded-xl ${paths ? 'max-h-[620px]' : ''}`} style={{ border: `1px solid ${T.border}` }}>
        <table className={`w-full ${compact ? 'min-w-[620px]' : 'min-w-[880px]'} text-[14px]`} style={{ color: T.ink }}>
          <thead><tr style={head}>
            {S('label', paths ? 'Entry page' : title.replace('By ', ''), false)}
            {paths && <th className={`${th} text-left sticky top-0`} style={{ background: '#fff' }}>Type</th>}
            {S('visitors', 'New visitors')}
            {!compact && <th className={`${th} text-right sticky top-0`} style={{ background: '#fff' }}>Share</th>}
            {S('ws', 'Workspaces')}
            {S('conv', '1-day conv.')}
            {S('convD', 'Δ conv.', true, 'Change in 1-day conversion vs the period before, in percentage points')}
            {S('ctr', 'CTA CTR')}
            {!compact && S('demo', 'Demo share')}
          </tr></thead>
          <tbody>
            {shown.map(r => {
              const on = !!selected?.includes(r.id)
              return (
                <tr key={r.id} onClick={onPick ? () => onPick(r.id) : undefined} aria-selected={onPick ? on : undefined}
                  className={onPick ? 'cursor-pointer hover:bg-[#FAF9F6]' : undefined}
                  style={{ borderBottom: `1px solid ${T.border}`, background: on ? '#E8F6F8' : undefined }}>
                  <td className="px-3 py-2.5">{paths ? <span style={mono}>{r.label}</span> : <>{onPick && <span aria-hidden style={{ color: on ? T.ink : T.faint }}>{on ? '● ' : '○ '}</span>}{r.label}</>}</td>
                  {paths && <td className="px-3 py-2.5 text-[13px]" style={{ color: T.muted }}>{r.type}</td>}
                  <td className={num} style={mono}>{fmtInt(r.cur.newVisitors)} <span className="text-[12px]" style={{ color: deltaColor(rel(r.cur.newVisitors, r.prev.newVisitors)) }}>{fmtPctSigned(rel(r.cur.newVisitors, r.prev.newVisitors), 0)}</span></td>
                  {!compact && <td className={num} style={{ ...mono, color: T.muted }}>{fmtPct(rate(r.cur.newVisitors, totalVisitors), 1)}</td>}
                  <td className={num} style={mono}>{fmtInt(r.cur.converted)}</td>
                  <td className={num} style={mono}>{fmtPct(convRate(r.cur), 1)}</td>
                  <td className={num}><PP c={convRate(r.cur)} p={convRate(r.prev)} /></td>
                  <td className={num} style={mono}>{fmtPct(ctr(r.cur), 1)}</td>
                  {!compact && <td className={num} style={mono}>{fmtPct(demoShare(r.cur), 0)}</td>}
                </tr>
              )
            })}
            {total && (
              <tr style={{ background: '#F7F6F2', fontWeight: 600 }}>
                <td className="px-3 py-2.5">All page types</td>
                <td className={num} style={mono}>{fmtInt(total.newVisitors)}</td>
                <td className={num} style={mono}>100%</td>
                <td className={num} style={mono}>{fmtInt(total.converted)}</td>
                <td className={num} style={mono}>{fmtPct(convRate(total), 1)}</td>
                <td className={num} />
                <td className={num} style={mono}>{fmtPct(ctr(total), 1)}</td>
                <td className={num} style={mono}>{fmtPct(demoShare(total), 0)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}
      {paths && sorted.length > 25 && (
        <button type="button" onClick={() => setAll(a => !a)} className="self-start rounded-full px-4 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
          {all ? 'Show top 25' : `Show all ${sorted.length}`}
        </button>
      )}
    </Card>
  )
}

function CtaZones({ c, filtered, scope }: { c: CroCut; filtered: boolean; scope: string }) {
  const tot = c.zones.reduce((a, z) => a + z.cur.clicks, 0)
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <H2>CTA clicks by page zone</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Conversion-button clicks by new visitors within a day of their first visit, by where the button sits · {scope}.{filtered && ' The self-serve and demo split is shown for all pages only.'}</p>
      </div>
      {!c.zones.length ? <p className="text-[15px]" style={{ color: T.muted }}>No CTA clicks for this selection.</p> :
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Zone</th><th className={`${th} text-right`}>Clicks</th><th className={`${th} text-right`}>Share</th>
            <th className={`${th} text-right`}>Change</th>{!filtered && <><th className={`${th} text-right`}>Self-serve</th><th className={`${th} text-right`}>Demo</th></>}
          </tr></thead>
          <tbody>{c.zones.map(z => (
            <tr key={z.zone} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-2.5">{ZONE_LABEL[z.zone] ?? z.zone}</td>
              <td className={num} style={mono}>{fmtInt(z.cur.clicks)}</td>
              <td className={num} style={{ ...mono, color: T.muted }}>{fmtPct(rate(z.cur.clicks, tot), 1)}</td>
              <td className={num} style={{ ...mono, color: deltaColor(rel(z.cur.clicks, z.prev.clicks)) }}>{fmtPctSigned(rel(z.cur.clicks, z.prev.clicks), 0)}</td>
              {!filtered && <><td className={num} style={mono}>{fmtInt(z.ss)}</td><td className={num} style={mono}>{fmtInt(z.demo)}</td></>}
            </tr>))}</tbody>
        </table>
      </div>}
    </Card>
  )
}

type Metric = 'visitors' | 'conv' | 'ctr' | 'demo'
const METRIC: Record<Metric, { label: string; f: (s: Seg) => number | null; fmt: (n: number) => string }> = {
  visitors: { label: 'New visitors', f: s => s.newVisitors, fmt: n => fmtInt(n) },
  conv: { label: '1-day workspace conversion', f: s => convRate(s), fmt: n => fmtPct(n, 1) },
  ctr: { label: 'CTA click-through', f: s => ctr(s), fmt: n => fmtPct(n, 1) },
  demo: { label: 'Demo share of CTA clickers', f: s => demoShare(s), fmt: n => fmtPct(n, 0) },
}
const LINE = ['#2F5BEA', '#C2410C', '#1F8A4C', '#7C3AED', '#B45309', '#0E7490']
function Trend({ v, types, defaulted, more }: { v: CroData; types: string[]; defaulted: boolean; more: boolean }) {
  const [m, setM] = useState<Metric>('conv')
  const [grain, setGrain] = useState<'day' | 'week'>('week')
  const data = useMemo(() => trend(v, types, grain).map(p => ({ k: p.k, ...Object.fromEntries(types.map(t => [t, p.byType[t] ? METRIC[m].f(p.byType[t]) : null])) })), [v, types, grain, m])
  const x = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const near = (d: ISODate) => (grain === 'week' ? mondayOf(d) : d)
  const det = near(CRO.detectionChange as ISODate)
  const showDetection = data.some(p => p.k < det) && data.some(p => p.k > det)
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <H2>Page types over time</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>
            {defaulted ? 'Homepage and Pricing, the two biggest entry points; pick page types in the bar above to compare others. ' : more ? 'The first 6 selected page types. ' : ''}
            Last {Math.round(CRO.trendDays / 7)} weeks, through the last day whose 1-day window has closed; not tied to the date filter.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Metric" value={m} onChange={e => setM(e.target.value as Metric)} className="rounded-full px-3 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {(Object.keys(METRIC) as Metric[]).map(k => <option key={k} value={k}>{METRIC[k].label}</option>)}
          </select>
          <Segmented ariaLabel="Grain" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }]} />
        </div>
      </div>
      {!v.days ? <p className="text-[15px]" style={{ color: T.muted }}>Loading the trend…</p> : !data.length ? <p className="text-[15px]" style={{ color: T.muted }}>No data for these page types.</p> :
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={T.barTrack} vertical={false} />
            <XAxis dataKey="k" tickFormatter={x} tick={{ fontSize: 12, fill: T.muted }} minTickGap={24} />
            <YAxis tickFormatter={n => METRIC[m].fmt(n)} tick={{ fontSize: 12, fill: T.muted }} width={56} />
            <Tooltip formatter={n => METRIC[m].fmt(Number(n))} labelFormatter={l => x(String(l))} />
            <Legend />
            {showDetection && <ReferenceLine x={det} stroke={T.faint} strokeDasharray="2 3" label={{ value: 'Workspace detection change', position: 'insideTopRight', fontSize: 11, fill: T.muted }} />}
            {types.map((t, i) => <Line key={t} type="monotone" dataKey={t} name={t} stroke={LINE[i % LINE.length]} strokeWidth={2} dot={false} connectNulls />)}
          </LineChart>
        </ResponsiveContainer>
      </div>}
      {showDetection && <p className="text-[13px]" style={{ color: T.muted }}>On {x(CRO.detectionChange)} prior-workspace detection widened, so more first-time visitors count as existing users and the new-visitor denominator shrinks from then on.</p>}
    </Card>
  )
}
