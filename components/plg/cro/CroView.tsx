'use client'

import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CRO } from '@/lib/plg/cro/sql'
import { ZONE_LABEL, botShare, convRate, croInsight, ctr, demoShare, rate, type CroView as V, type Daily, type Seg, type SegRow, type Window } from '@/lib/plg/cro/compute'
import { mondayOf, type ISODate } from '@/lib/plg/dates'
import WhatMoved from '../WhatMoved'
import { Card, Def, Delta, Eyebrow, H2, InfoTip, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-2.5 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'
const rel = (c: number, p: number) => (p ? (c - p) / p : null)
const dp = (r: number | null) => (r != null && r < 0.1 ? 1 : 1)
const PP = ({ c, p }: { c: number | null; p: number | null }) => {
  if (c == null || p == null) return <span style={{ color: T.faint }}>–</span>
  const d = (c - p) * 100
  return <span style={{ ...mono, color: deltaColor(Math.abs(d) < 0.05 ? 0 : d) }}>{fmtPp(Math.abs(d) < 0.05 ? 0 : d)}</span>
}

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

export default function CroView({ v, loading }: { v: V; loading?: boolean }) {
  const insight = useMemo(() => croInsight(v), [v])
  const { cur: c, prev: p } = v.all
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="New visitors" value={fmtInt(c.newVisitors)}
          tip={<Def d="First-ever sessions from people with no workspace yet, on clay.com, signup and login, guides and university." src="MARKETING_WEBSITE_SESSIONS" note="Likely bots (crawler IP, no Clay user id) are left out." />}>
          <Delta value={rel(c.newVisitors, p.newVisitors)}>{fmtPctSigned(rel(c.newVisitors, p.newVisitors))}</Delta> <span style={{ color: T.muted }}>vs period before</span>
        </Tile>
        <Tile label="Visit → workspace (1 day)" value={fmtPct(convRate(c), 1)}
          tip={<Def d="New visitors who created a workspace within 24 hours of their first visit." src="COOKIE_TO_WORKSPACE_RELATIONSHIP → CUSTOMERS" note="The latest day reads low until its window closes." />}>
          {fmtInt(c.converted)} workspaces · {ppLine(convRate(c), convRate(p))}
        </Tile>
        <Tile label="CTA click-through" value={fmtPct(ctr(c), 1)}>
          {fmtInt(c.clickers)} clickers · {ppLine(ctr(c), ctr(p))}
        </Tile>
        <Tile label="Demo share of CTA clicks" value={fmtPct(demoShare(c), 0)}
          tip={<Def d="Demo clickers ÷ demo plus self-serve clickers." src="CONVERSION_BUTTON_CLICKED · button type" />}>
          {fmtInt(c.demo)} demo · {fmtInt(c.selfServe)} self-serve · <PP c={demoShare(c)} p={demoShare(p)} />
        </Tile>
        <Tile label="Likely-bot share" value={fmtPct(botShare(c), 0)} muted
          tip={<Def d="Share of first-ever sessions flagged as likely bots and excluded from every other number here." src="MARKETING_IP_CRAWLER_CLASSIFICATION" />}>
          {fmtInt(c.bots)} of {fmtInt(c.entries)} entries · <PP c={botShare(c)} p={botShare(p)} />
        </Tile>
      </div>

      <WhatMoved insight={{ ...insight, title: 'What moved · conversion' }} />

      <SegTable title="By landing page type" sub="Where new visitors first land, grouped by page type (locale prefixes stripped). Sorted by new visitors." rows={v.landing} total={c} />

      <div className="grid gap-6 sm:gap-8 grid-cols-1 2xl:grid-cols-2">
        <SegTable title="By channel" sub="Channel of the first session." rows={v.channels} compact />
        <SegTable title="By device" sub="Operating system of the first session." rows={v.devices} compact />
      </div>

      <SegTable title="Top entry pages" sub="The 40 entry pages with the most new visitors in the period (25 or more). Use it to find pages that bring traffic but don’t convert." rows={v.paths} paths />

      <CtaZones v={v} />

      <KeyPages v={v} />

      {v.launch && <Launch w={v.launch} />}
    </div>
  )
}

type SortKey = 'label' | 'visitors' | 'conv' | 'convD' | 'ctr' | 'demo' | 'ws'
function SegTable({ title, sub, rows, total, compact, paths }: { title: string; sub: string; rows: SegRow[]; total?: Seg; compact?: boolean; paths?: boolean }) {
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
      <div className={`overflow-auto rounded-xl ${paths ? 'max-h-[620px]' : ''}`} style={{ border: `1px solid ${T.border}` }}>
        <table className={`w-full ${compact ? 'min-w-[620px]' : 'min-w-[880px]'} text-[14px]`} style={{ color: T.ink }}>
          <thead><tr style={head}>
            {S('label', paths ? 'Entry page' : title.replace('By ', ''), false)}
            {S('visitors', 'New visitors')}
            {!compact && <th className={`${th} text-right sticky top-0`} style={{ background: '#fff' }}>Share</th>}
            {S('ws', 'Workspaces')}
            {S('conv', '1-day conv.')}
            {S('convD', 'Δ conv.', true, 'Change in 1-day conversion vs the period before, in percentage points')}
            {S('ctr', 'CTA CTR')}
            {!compact && S('demo', 'Demo share')}
          </tr></thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5">{paths ? <span style={mono}>{r.label}</span> : r.label}</td>
                <td className={num} style={mono}>{fmtInt(r.cur.newVisitors)} <span className="text-[12px]" style={{ color: deltaColor(rel(r.cur.newVisitors, r.prev.newVisitors)) }}>{fmtPctSigned(rel(r.cur.newVisitors, r.prev.newVisitors), 0)}</span></td>
                {!compact && <td className={num} style={{ ...mono, color: T.muted }}>{fmtPct(rate(r.cur.newVisitors, totalVisitors), 1)}</td>}
                <td className={num} style={mono}>{fmtInt(r.cur.converted)}</td>
                <td className={num} style={mono}>{fmtPct(convRate(r.cur), dp(convRate(r.cur)))}</td>
                <td className={num}><PP c={convRate(r.cur)} p={convRate(r.prev)} /></td>
                <td className={num} style={mono}>{fmtPct(ctr(r.cur), 1)}</td>
                {!compact && <td className={num} style={mono}>{fmtPct(demoShare(r.cur), 0)}</td>}
              </tr>
            ))}
            {total && (
              <tr style={{ background: '#F7F6F2', fontWeight: 600 }}>
                <td className="px-3 py-2.5">All landing pages</td>
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
      </div>
      {paths && sorted.length > 25 && (
        <button type="button" onClick={() => setAll(a => !a)} className="self-start rounded-full px-4 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
          {all ? 'Show top 25' : `Show all ${sorted.length}`}
        </button>
      )}
    </Card>
  )
}

function CtaZones({ v }: { v: V }) {
  const zones = useMemo(() => {
    const m = new Map<string, { zone: string; cur: { clicks: number; ss: number; demo: number }; prev: { clicks: number } }>()
    for (const x of v.cta) {
      const z = m.get(x.zone) ?? { zone: x.zone, cur: { clicks: 0, ss: 0, demo: 0 }, prev: { clicks: 0 } }
      z.cur.clicks += x.cur.clicks; z.prev.clicks += x.prev.clicks
      if (x.motion === 'demo') z.cur.demo += x.cur.clicks; else if (x.motion === 'self_serve') z.cur.ss += x.cur.clicks
      m.set(x.zone, z)
    }
    return [...m.values()].sort((a, b) => b.cur.clicks - a.cur.clicks)
  }, [v.cta])
  const tot = zones.reduce((a, z) => a + z.cur.clicks, 0)
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <H2>CTA clicks by page zone</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Every conversion-button click by new visitors within a day of their first visit, on any page, by where the button sits (ELEMENT_LOCATION).</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Zone</th><th className={`${th} text-right`}>Clicks</th><th className={`${th} text-right`}>Share</th>
            <th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Self-serve</th><th className={`${th} text-right`}>Demo</th>
          </tr></thead>
          <tbody>{zones.map(z => (
            <tr key={z.zone} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-2.5">{ZONE_LABEL[z.zone] ?? z.zone}</td>
              <td className={num} style={mono}>{fmtInt(z.cur.clicks)}</td>
              <td className={num} style={{ ...mono, color: T.muted }}>{fmtPct(rate(z.cur.clicks, tot), 1)}</td>
              <td className={num} style={{ ...mono, color: deltaColor(rel(z.cur.clicks, z.prev.clicks)) }}>{fmtPctSigned(rel(z.cur.clicks, z.prev.clicks), 0)}</td>
              <td className={num} style={mono}>{fmtInt(z.cur.ss)}</td>
              <td className={num} style={mono}>{fmtInt(z.cur.demo)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
  )
}

type PageMetric = 'visitors' | 'conv' | 'ctr' | 'demo'
const METRIC: Record<PageMetric, { label: string; f: (d: Daily) => number | null; fmt: (n: number) => string }> = {
  visitors: { label: 'New visitors', f: d => d.newVisitors, fmt: n => fmtInt(n) },
  conv: { label: '1-day workspace conversion', f: d => rate(d.converted, d.newVisitors), fmt: n => fmtPct(n, 1) },
  ctr: { label: 'CTA click-through', f: d => rate(d.clickers, d.newVisitors), fmt: n => fmtPct(n, 1) },
  demo: { label: 'Demo share of CTA clickers', f: d => rate(d.demo, d.demo + d.selfServe), fmt: n => fmtPct(n, 0) },
}
function KeyPages({ v }: { v: V }) {
  const [m, setM] = useState<PageMetric>('conv')
  const [grain, setGrain] = useState<'day' | 'week'>('week')
  const data = useMemo(() => {
    const bucket = (d: ISODate) => (grain === 'week' ? mondayOf(d) : d)
    const agg = (xs: Daily[]) => {
      const g = new Map<string, Daily>()
      for (const x of xs.filter(x => x.day <= v.complete)) {
        const k = bucket(x.day)
        const a = g.get(k) ?? { day: k, newVisitors: 0, converted: 0, clickers: 0, selfServe: 0, demo: 0, views: 0 }
        a.newVisitors += x.newVisitors; a.converted += x.converted; a.clickers += x.clickers; a.selfServe += x.selfServe; a.demo += x.demo; a.views += x.views
        g.set(k, a)
      }
      return g
    }
    const h = agg(v.pages.homepage), p = agg(v.pages.pricing)
    return [...new Set([...h.keys(), ...p.keys()])].sort().map(k => ({ k, homepage: h.get(k) ? METRIC[m].f(h.get(k)!) : null, pricing: p.get(k) ? METRIC[m].f(p.get(k)!) : null }))
  }, [v, m, grain])
  const x = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const near = (d: ISODate) => (grain === 'week' ? mondayOf(d) : d)
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <H2>Homepage and pricing over time</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>New visitors are counted on their first-ever view of the page. Since {x(CRO.seriesStart)}, through {x(v.complete)} (the last day whose 1-day window has closed). Not tied to the date filter.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Metric" value={m} onChange={e => setM(e.target.value as PageMetric)} className="rounded-full px-3 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {(Object.keys(METRIC) as PageMetric[]).map(k => <option key={k} value={k}>{METRIC[k].label}</option>)}
          </select>
          <Segmented ariaLabel="Grain" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }]} />
        </div>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={T.barTrack} vertical={false} />
            <XAxis dataKey="k" tickFormatter={x} tick={{ fontSize: 12, fill: T.muted }} minTickGap={24} />
            <YAxis tickFormatter={n => METRIC[m].fmt(n)} tick={{ fontSize: 12, fill: T.muted }} width={56} />
            <Tooltip formatter={n => METRIC[m].fmt(Number(n))} labelFormatter={l => x(String(l))} />
            <Legend />
            <ReferenceLine x={near(CRO.launch)} stroke={T.ink} strokeDasharray="4 3" label={{ value: 'New homepage', position: 'insideTopRight', fontSize: 12, fill: T.ink }} />
            <ReferenceLine x={near(CRO.detectionChange)} stroke={T.faint} strokeDasharray="2 3" label={{ value: 'Workspace detection change', position: 'insideTopRight', fontSize: 11, fill: T.muted }} />
            <Line type="monotone" dataKey="homepage" name="Homepage" stroke={T.pos} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="pricing" name="Pricing" stroke="#C2410C" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>
        On {x(CRO.detectionChange)} prior-workspace detection widened, so more first-time visitors count as existing users and the new-visitor denominator shrinks from then on.
      </p>
    </Card>
  )
}

function Launch({ w }: { w: { before: Window; after: Window; latest: Window } }) {
  const cols = [w.before, w.after, w.latest]
  const per = (x: Window) => ({
    visitors: x.days ? x.d.newVisitors / x.days : null,
    conv: rate(x.d.converted, x.d.newVisitors), ctr: rate(x.d.clickers, x.d.newVisitors),
    ss: rate(x.d.selfServe, x.d.newVisitors), demo: rate(x.d.demo, x.d.newVisitors),
    clicksPer: (() => { const c = x.zones.reduce((a, z) => a + z.clicks, 0), u = x.zones.reduce((a, z) => a + z.clickers, 0); return u ? c / u : null })(),
  })
  const P = cols.map(per)
  const rows: { label: string; def: string; k: keyof ReturnType<typeof per>; kind: 'n' | 'pct' | 'x' }[] = [
    { label: 'New homepage visitors per day', def: 'First-ever homepage view, no workspace, bots excluded', k: 'visitors', kind: 'n' },
    { label: 'Homepage 1-day workspace conversion', def: 'Workspace created within 24 hours of the first homepage view', k: 'conv', kind: 'pct' },
    { label: 'Hero, navbar and other CTA click-through', def: 'New visitors who clicked any conversion button on the homepage within a day', k: 'ctr', kind: 'pct' },
    { label: '↳ Self-serve click-through', def: 'Clicked a self-serve button (Start free trial, Sign up)', k: 'ss', kind: 'pct' },
    { label: '↳ Demo click-through', def: 'Clicked a Get a demo button', k: 'demo', kind: 'pct' },
    { label: 'Clicks per clicker', def: 'Total clicks ÷ unique clickers, by day: more engagement from the same people, or more people?', k: 'clicksPer', kind: 'x' },
  ]
  const f = (n: number | null, kind: 'n' | 'pct' | 'x') => (n == null ? '–' : kind === 'pct' ? fmtPct(n, 1) : kind === 'x' ? n.toFixed(2) : fmtInt(n))
  const zoneIds = [...new Set(cols.flatMap(c => c.zones.map(z => z.zone)))].sort((a, b) => (w.after.zones.find(z => z.zone === b)?.clickers ?? 0) - (w.after.zones.find(z => z.zone === a)?.clickers ?? 0))
  const zctr = (x: Window, id: string) => rate(x.zones.find(z => z.zone === id)?.clickers ?? 0, x.d.newVisitors)
  const x = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <H2>Homepage launch: before and after</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>{CRO.launchNote} No A/B test, so this is a before/after read: bot mix, the September detection change and seasonality move these numbers too.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Metric</th>
            {cols.map(c => <th key={c.label} className={`${th} text-right`} title={`${c.from} to ${c.to}`}>{c.label}<br /><span className="normal-case" style={{ color: T.faint }}>{x(c.from)}–{x(c.to)}</span></th>)}
            <th className={`${th} text-right`}>After vs before</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const a = P[0][r.k], bb = P[1][r.k]
              return (
                <tr key={r.k} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-3 py-2.5"><p className={r.label.startsWith('↳') ? '' : 'font-semibold'}>{r.label}</p><p className="text-[12px]" style={{ color: T.muted }}>{r.def}</p></td>
                  {P.map((pp, i) => <td key={i} className={num} style={mono}>{f(pp[r.k], r.kind)}</td>)}
                  <td className={num}>{r.kind === 'pct' ? <PP c={bb} p={a} /> : <span style={{ ...mono, color: deltaColor(a && bb != null ? bb - a : null) }}>{a && bb != null ? fmtPctSigned((bb - a) / a, 0) : '–'}</span>}</td>
                </tr>
              )
            })}
            <tr><td colSpan={5} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>Click-through by zone (unique clickers ÷ new visitors)</td></tr>
            {zoneIds.map(id => (
              <tr key={id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2">{ZONE_LABEL[id] ?? id}</td>
                {cols.map((c, i) => <td key={i} className={num} style={mono}>{fmtPct(zctr(c, id), 1)}</td>)}
                <td className={num}><PP c={zctr(w.after, id)} p={zctr(w.before, id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>Windows: the four weeks before launch day, the first four weeks on the new page (from {x(CRO.launch)}), and the latest four complete weeks. Launch day itself ({x('2026-06-23')}) is left out: both pages served that day.</p>
    </Card>
  )
}

