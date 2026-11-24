'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AEO_PLATFORMS, HIDDEN_PMM, W, competitorBoard, domainBoard, groupTable, kpis, ranges, shareSeries, sliceId, weekly,
  type AeoData, type AeoPlatform, type AeoPromptType, type GroupRow, type Kpis, type Ranked,
} from '@/lib/plg/aeo/data'
import { Card, Def, Eyebrow, H2, InfoTip, Pill, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-2.5 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'

/** Categorical series colors (validated: scripts/validate_palette.js, light surface). Clay is always ink, drawn thicker. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const CLAY = T.ink
const GRID = '#ECEAE5'
const SENT = { pos: T.pos, neu: '#C9C6BF', neg: T.neg }

const PERIODS = [{ id: '4', label: 'Last 4 weeks' }, { id: '8', label: '8 weeks' }, { id: '13', label: '13 weeks' }, { id: '26', label: '26 weeks' }] as const
type PeriodId = (typeof PERIODS)[number]['id']
const PLATFORM_LABEL: Record<AeoPlatform, string> = { all: 'All platforms', ChatGPT: 'ChatGPT', Claude: 'Claude' }
const TYPES: { id: AeoPromptType; label: string; title: string }[] = [
  { id: 'Benchmark', label: 'Benchmark', title: 'Category prompts that don’t name Clay (about 85% of prompts): the real visibility test' },
  { id: 'Branded', label: 'Branded', title: 'Prompts that name Clay; Clay is mentioned almost every time, so read these separately' },
  { id: 'all', label: 'All prompts', title: 'Benchmark and Branded together' },
]

const wk = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const pctAxis = (v: number) => `${Math.round(v * 100)}%`
/** Percent axis top: a little headroom, rounded to 5 points, never above 100%. */
const pctMax = (vals: (number | null | undefined)[]) => Math.min(1, Math.ceil((Math.max(0.05, ...vals.map(v => v ?? 0)) * 1.15) * 20) / 20)

function PPDelta({ c, p, lowerBetter }: { c: number | null; p: number | null; lowerBetter?: boolean }) {
  if (c == null || p == null) return <span style={{ color: T.faint }}>–</span>
  const d = (c - p) * 100, z = Math.abs(d) < 0.05 ? 0 : d
  return <span style={{ ...mono, color: deltaColor(lowerBetter ? -z : z) }}>{fmtPp(z)}</span>
}

function Tile({ label, value, tip, children }: { label: string; value: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-5 flex flex-col gap-2 min-w-0" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
      <p className="text-[26px] sm:text-[32px] leading-none" style={{ ...mono, color: T.ink }}>{value}</p>
      <p className="text-[14px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}

function Tiles({ c, p, prevLabel }: { c: Kpis; p: Kpis | null; prevLabel: string }) {
  const vs = <span style={{ color: T.muted }}> vs {prevLabel}</span>
  const rel = (a: number, b: number | undefined) => { if (!b) return null; const r = (a - b) / b; return Math.abs(r) < 0.0005 ? 0 : r }
  const cnt = (a: number, b: number | undefined) => { const r = rel(a, b); return r == null ? <span style={{ color: T.faint }}>–</span> : <span style={{ ...mono, color: deltaColor(r) }}>{fmtPctSigned(r)}</span> }
  const posDelta = c.position != null && p?.position != null ? c.position - p.position : null
  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
      <Tile label="Visibility" value={fmtPct(c.visibility)} tip={<Def d="Share of AI answers that mention Clay." src="AEO prompt runs (ChatGPT and Claude, one run per prompt per platform each week)" note="Clay mentions ÷ responses, summed over the period's weeks, never an average of weekly rates." />}>
        <PPDelta c={c.visibility} p={p?.visibility ?? null} />{vs}</Tile>
      <Tile label="Citation rate" value={fmtPct(c.citation)} tip={<Def d="Of answers that cite any source, the share that cite a Clay URL." note="Answers without citations are left out of the denominator." />}>
        <PPDelta c={c.citation} p={p?.citation ?? null} />{vs}</Tile>
      <Tile label="Avg position" value={c.position == null ? '–' : `#${c.position.toFixed(1)}`} tip={<Def d="Where Clay appears among the tools an answer names, when it's mentioned. 1 = named first." note="Lower is better." />}>
        {posDelta == null ? <span style={{ color: T.faint }}>–</span> : <span style={{ ...mono, color: deltaColor(Math.abs(posDelta) < 0.05 ? 0 : -posDelta) }}>{Math.abs(posDelta) < 0.05 ? '0.0' : `${posDelta > 0 ? '+' : '−'}${Math.abs(posDelta).toFixed(1)}`}</span>}{vs}</Tile>
      <Tile label="Positive sentiment" value={fmtPct(c.positive)} tip={<Def d="Of answers that mention Clay, the share that describe it positively." note="Neutral and negative make up the rest (chart below)." />}>
        <PPDelta c={c.positive} p={p?.positive ?? null} />{vs}</Tile>
      <Tile label="Claygent & MCP" value={fmtInt(c.claygent)} tip={<Def d="Answers that name Claygent or the Clay MCP server specifically." note="A count of answers, so it moves with the number of prompts run." />}>
        {cnt(c.claygent, p?.claygent)}{vs}</Tile>
      <Tile label="Responses" value={fmtInt(c.responses)} tip={<Def d="AI answers analyzed in the period: each prompt runs once per platform per week." />}>
        {cnt(c.responses, p?.responses)}{vs}</Tile>
    </div>
  )
}

function LegendRow({ items }: { items: { name: string; color: string; clay?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" style={{ color: T.muted }}>
      {items.map(i => (
        <span key={i.name} className="flex items-center gap-2">
          <span className="inline-block w-6 rounded" style={{ height: i.clay ? 3 : 2, background: i.color }} />
          <span style={{ color: i.clay ? T.ink : T.muted, fontWeight: i.clay ? 600 : 400 }}>{i.name}</span>
        </span>
      ))}
    </div>
  )
}

/** Line chart of shares over weeks: Clay plus a few named entities, one shared crosshair tooltip. */
function ShareChart({ rows, names, colors, height = 260 }: { rows: Record<string, string | number | null>[]; names: string[]; colors: Record<string, string>; height?: number }) {
  const top = pctMax(rows.flatMap(r => ['Clay', ...names].map(n => r[n] as number | null)))
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="week" tickFormatter={wk} tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={24} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <YAxis domain={[0, top]} tickFormatter={pctAxis} tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <Tooltip cursor={{ stroke: '#B9B5AC', strokeWidth: 1 }} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const items = [...payload].sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
            return (
              <div className="rounded-xl px-3 py-2 text-[13px] flex flex-col gap-0.5" style={{ background: '#fff', border: `1px solid ${T.border}`, ...mono }}>
                <div style={{ color: T.muted }}>Week of {wk(String(label))}</div>
                {items.map(it => <div key={String(it.dataKey)} className="flex items-center gap-2" style={{ color: T.ink, fontWeight: it.dataKey === 'Clay' ? 600 : 400 }}>
                  <span style={{ color: String(it.stroke) }}>●</span>{String(it.dataKey)}<span className="ml-auto pl-4">{fmtPct(Number(it.value), 1)}</span></div>)}
              </div>
            )
          }} />
          {names.map(n => <Line key={n} dataKey={n} stroke={colors[n]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />)}
          <Line dataKey="Clay" stroke={CLAY} strokeWidth={3} dot={{ r: 3, fill: CLAY, strokeWidth: 0 }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function CountChart({ rows, color = T.pos }: { rows: { week: string; v: number | null }[]; color?: string }) {
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="week" tickFormatter={wk} tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={24} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <YAxis tickFormatter={v => fmtInt(v)} tickLine={false} axisLine={false} width={52} allowDecimals={false} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <Tooltip cursor={{ stroke: '#B9B5AC', strokeWidth: 1 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload as { week: string; v: number | null }
            return <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: '#fff', border: `1px solid ${T.border}`, ...mono }}>Week of {wk(d.week)}: {fmtInt(d.v)}</div>
          }} />
          <Line dataKey="v" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Board({ rows, colors, what, show = 10 }: { rows: Ranked[]; colors: Record<string, string>; what: 'competitor' | 'domain'; show?: number }) {
  const [n, setN] = useState(show)
  const max = Math.max(0.01, ...rows.map(r => r.value ?? 0))
  const shown = rows.slice(0, n)
  const clay = rows.find(r => r.isClay)
  if (what === 'competitor' && clay && !shown.includes(clay)) shown.push(clay)
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>#</th><th className={`${th} text-left`}>{what === 'competitor' ? 'Brand' : 'Domain'}</th>
            <th className={`${th} text-right`}>{what === 'competitor' ? 'Mentioned in' : 'Cited in'}</th><th className={`${th} text-right`}>Change</th>
          </tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.name} style={{ borderBottom: `1px solid ${T.border}`, background: r.isClay ? '#F6F5F1' : undefined }}>
              <td className="px-3 py-2.5" style={{ ...mono, color: T.muted }}>{rows.indexOf(r) + 1}</td>
              <td className="px-3 py-2.5 w-full max-w-0">
                <div className="flex items-center gap-2" style={{ fontWeight: r.isClay ? 600 : 400 }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.isClay ? CLAY : colors[r.name] ?? '#D9D6CF' }} />
                  <span className="truncate min-w-0">{r.name}{r.isClay && what === 'domain' ? ' (you)' : ''}</span>
                  {what === 'domain' && r.type && <span className="text-[12px] shrink-0" style={{ color: T.faint }}>{r.type}</span>}
                </div>
                <div className="mt-1.5 h-[4px] rounded-full" style={{ background: T.barTrack }}>
                  <div className="h-full rounded-full" style={{ width: `${((r.value ?? 0) / max) * 100}%`, background: r.isClay ? CLAY : '#9A968E' }} />
                </div>
              </td>
              <td className={num} style={mono}>{fmtPct(r.value)}</td>
              <td className={num}><PPDelta c={r.value} p={r.prev} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rows.length > show && <button onClick={() => setN(n > show ? show : rows.length)} className="self-start text-[14px] underline underline-offset-4" style={{ color: T.muted }}>
        {n > show ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </div>
  )
}

function Spark({ v }: { v: (number | null)[] }) {
  const pts = v.map((x, i) => [i, x] as const).filter(([, x]) => x != null) as [number, number][]
  if (pts.length < 2) return <span style={{ color: T.faint }}>–</span>
  const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), span = hi - lo || 0.01
  const x = (i: number) => (i / Math.max(1, v.length - 1)) * 96 + 2, y = (n: number) => 22 - ((n - lo) / span) * 18
  return (
    <svg width="72" height="26" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map(([i, n]) => `${x(i)},${y(n)}`).join(' ')} fill="none" stroke={T.pos} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1][0])} cy={y(pts[pts.length - 1][1])} r="2.5" fill={T.pos} />
    </svg>
  )
}

function GroupTable({ rows, label, show = 10 }: { rows: GroupRow[]; label: string; show?: number }) {
  const [sort, setSort] = useState<'responses' | 'value' | 'delta'>('responses')
  const [n, setN] = useState(show)
  const sorted = useMemo(() => [...rows].sort((a, b) => sort === 'responses' ? b.responses - a.responses
    : sort === 'value' ? (b.value ?? -1) - (a.value ?? -1) : ((b.value ?? 0) - (b.prev ?? 0)) - ((a.value ?? 0) - (a.prev ?? 0))), [rows, sort])
  const sh = (k: typeof sort, txt: string) => (
    <th className={`${th} text-right`}><button onClick={() => setSort(k)} className="uppercase" style={{ letterSpacing: '0.12em', color: sort === k ? T.ink : T.muted }}>{txt}{sort === k ? ' ↓' : ''}</button></th>)
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>{label}</th>{sh('value', 'Visibility')}{sh('delta', 'Change')}{sh('responses', 'Responses')}
            <th className={`${th} text-left`}>Weekly</th>
          </tr></thead>
          <tbody>{sorted.slice(0, n).map(r => (
            <tr key={r.name} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-2.5 min-w-[140px]">{r.name}</td>
              <td className={num} style={mono}>{fmtPct(r.value)}</td>
              <td className={num}><PPDelta c={r.value} p={r.prev} /></td>
              <td className={num} style={{ ...mono, color: T.muted }}>{fmtInt(r.responses)}</td>
              <td className="px-3 py-1.5"><Spark v={r.spark} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rows.length > show && <button onClick={() => setN(n > show ? show : rows.length)} className="self-start text-[14px] underline underline-offset-4" style={{ color: T.muted }}>
        {n > show ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </div>
  )
}

function SentimentChart({ rows }: { rows: { week: string; pos: number; neu: number; neg: number }[] }) {
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="week" tickFormatter={wk} tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={24} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={pctAxis} tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
          <Tooltip cursor={{ stroke: '#B9B5AC', strokeWidth: 1 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload as (typeof rows)[number]
            return (
              <div className="rounded-xl px-3 py-2 text-[13px] flex flex-col gap-0.5" style={{ background: '#fff', border: `1px solid ${T.border}`, ...mono }}>
                <div style={{ color: T.muted }}>Week of {wk(d.week)}</div>
                <div><span style={{ color: SENT.pos }}>●</span> Positive {fmtPct(d.pos)}</div>
                <div><span style={{ color: SENT.neu }}>●</span> Neutral {fmtPct(d.neu)}</div>
                <div><span style={{ color: SENT.neg }}>●</span> Negative {fmtPct(d.neg)}</div>
              </div>
            )
          }} />
          <Area dataKey="neg" stackId="s" stroke="#fff" strokeWidth={2} fill={SENT.neg} fillOpacity={1} isAnimationActive={false} />
          <Area dataKey="neu" stackId="s" stroke="#fff" strokeWidth={2} fill={SENT.neu} fillOpacity={1} isAnimationActive={false} />
          <Area dataKey="pos" stackId="s" stroke="#fff" strokeWidth={2} fill={SENT.pos} fillOpacity={0.85} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Fixed color per entity (by its overall rank across all data), so a filter never repaints a line. */
function colorMap(names: string[]) { return Object.fromEntries(names.map((n, i) => [n, SERIES[i] ?? '#9A968E'])) }

export default function AeoView({ data }: { data: AeoData | null | undefined }) {
  const [platform, setPlatform] = useState<AeoPlatform>('all')
  const [type, setType] = useState<AeoPromptType>('Benchmark')
  const [period, setPeriod] = useState<PeriodId>('13')
  const [showComp, setShowComp] = useState(true)

  const base = data?.slices['all-all']
  const compColors = useMemo(() => colorMap(base ? Object.entries(base.comp).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).map(([k]) => k) : []), [base])
  const domColors = useMemo(() => colorMap(base && data ? Object.entries(base.dom).filter(([k]) => !data.meta.clayDomains.includes(k))
    .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).map(([k]) => k) : []), [base, data])

  if (data === undefined) return <p className="text-[15px]" style={{ color: T.muted }}>Loading AI visibility…</p>
  if (data === null) return <p className="text-[15px]" style={{ color: T.neg }}>AI visibility data isn’t synced yet. Run scripts/sync-aeo.mjs and store its output in this page’s aeo collection.</p>

  const { meta } = data
  const s = data.slices[sliceId(platform, type)]
  const n = Number(period)
  const { cur, prev } = ranges(meta.weeks.length, n)
  const curLabel = `${wk(meta.weeks[cur.i0])} – ${wk(meta.weeks[cur.i1])}`
  const prevLabel = prev ? `the ${prev.i1 - prev.i0 + 1} weeks before` : 'the period before'
  if (!s) return <p className="text-[15px]" style={{ color: T.neg }}>No data for {PLATFORM_LABEL[platform]} · {type}.</p>

  const k = kpis(s, cur), kp = prev ? kpis(s, prev) : null
  const comps = competitorBoard(s, cur, prev)
  const topComp = comps.filter(r => !r.isClay).slice(0, 5).map(r => r.name)
  const doms = domainBoard(meta, s, cur, prev)
  const topDom = doms.filter(r => !r.isClay).slice(0, 5).map(r => r.name)
  const visRows = shareSeries(meta, s, cur, showComp ? topComp : [], 'comp')
  const citRows = shareSeries(meta, s, cur, topDom, 'dom')
  const claygent = weekly(meta, s, cur, r => r[W.claygent])
  const followup = weekly(meta, s, cur, r => r[W.followup])
  const sent = weekly(meta, s, cur, r => r[W.pos] + r[W.neu] + r[W.neg]).map((x, i) => {
    const r = s.w[cur.i0 + i], t = x.v || 1
    return { week: x.week, pos: r[W.pos] / t, neu: r[W.neu] / t, neg: r[W.neg] / t }
  })
  const pmm = groupTable(s.pmm, cur, prev, HIDDEN_PMM)
  const topics = groupTable(s.topic, cur, prev)
  const many = n > 1

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Platform" value={platform} onChange={setPlatform} options={AEO_PLATFORMS.map(p => ({ id: p, label: PLATFORM_LABEL[p] }))} />
        <Segmented ariaLabel="Prompt type" value={type} onChange={setType} options={TYPES} />
        <Segmented ariaLabel="Period" value={period} onChange={setPeriod} options={PERIODS.map(p => ({ id: p.id, label: p.label }))} />
        <span className="text-[14px]" style={{ color: T.muted, ...mono }}>{curLabel} vs {prevLabel}</span>
      </div>
      {meta.sample && (
        <div className="rounded-2xl px-5 py-3 text-[14px] flex flex-wrap items-center gap-3" style={{ background: T.amberBg, color: T.amberInk }}>
          <Pill tone="amber">Sample data</Pill>
          <span>Generated numbers in the shape of the AEO database, for layout review. Not real. The live copy replaces this once the AEO sync runs.</span>
        </div>
      )}

      <Tiles c={k} p={kp} prevLabel={prevLabel} />

      {/* Visibility */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6">
        <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <H2>Visibility by week</H2>
              <p className="text-[15px]" style={{ color: T.muted }}>Share of answers that mention each brand{showComp ? ' · Clay and the five most-mentioned competitors' : ''}</p>
            </div>
            <Segmented ariaLabel="Competitor lines" value={showComp ? 'on' : 'off'} onChange={v => setShowComp(v === 'on')}
              options={[{ id: 'on', label: 'With competitors' }, { id: 'off', label: 'Clay only' }]} />
          </div>
          <LegendRow items={[{ name: 'Clay', color: CLAY, clay: true }, ...(showComp ? topComp.map(c => ({ name: c, color: compColors[c] })) : [])]} />
          <ShareChart rows={visRows} names={showComp ? topComp : []} colors={compColors} />
          {!many && <p className="text-[13px]" style={{ color: T.muted }}>One week selected: pick a longer period to see the trend.</p>}
        </Card>
        <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-1">
            <H2>Most-mentioned brands</H2>
            <p className="text-[15px]" style={{ color: T.muted }}>Share of answers naming each brand, {curLabel}</p>
          </div>
          <Board rows={comps} colors={compColors} what="competitor" />
        </Card>
      </div>

      {/* Citations */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6">
        <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2"><H2>Citations by week</H2>
              <InfoTip label="About citation share"><Def d="Of answers that cite any source, the share citing each domain. Clay's line counts any Clay-owned domain." note="An answer can cite several domains, so shares add up to more than 100%." /></InfoTip></div>
            <p className="text-[15px]" style={{ color: T.muted }}>Clay vs the five most-cited other domains</p>
          </div>
          <LegendRow items={[{ name: 'Clay', color: CLAY, clay: true }, ...topDom.map(d => ({ name: d, color: domColors[d] }))]} />
          <ShareChart rows={citRows} names={topDom} colors={domColors} />
        </Card>
        <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-1">
            <H2>Most-cited domains</H2>
            <p className="text-[15px]" style={{ color: T.muted }}>Share of answers with citations that cite each domain</p>
          </div>
          <Board rows={doms} colors={domColors} what="domain" />
        </Card>
      </div>

      {/* Agent mentions and follow-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6 flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2"><H2>Claygent & MCP mentions</H2>
              <InfoTip label="About Claygent and MCP mentions"><Def d="Answers per week that name Claygent or the Clay MCP server." /></InfoTip></div>
            <p className="text-[15px]" style={{ color: T.muted }}>{fmtInt(k.claygent)} in the period · {fmtPct(k.responses ? k.claygent / k.responses : null)} of answers</p>
          </div>
          <CountChart rows={claygent} />
        </Card>
        <Card className="p-5 sm:p-6 flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2"><H2>Clay recommended as the next step</H2>
              <InfoTip label="About follow-up recommendations"><Def d="Answers per week that suggest trying Clay as the follow-up action, not just listing it." /></InfoTip></div>
            <p className="text-[15px]" style={{ color: T.muted }}>{fmtInt(k.followup)} in the period · {fmtPct(k.mentioned ? k.followup / k.mentioned : null)} of answers that mention Clay</p>
          </div>
          <CountChart rows={followup} />
        </Card>
      </div>

      {/* Sentiment */}
      <Card className="p-5 sm:p-6 flex flex-col gap-3 min-w-0">
        <div className="flex flex-col gap-1">
          <H2>How answers describe Clay</H2>
          <p className="text-[15px]" style={{ color: T.muted }}>Sentiment of answers that mention Clay, by week</p>
        </div>
        <LegendRow items={[{ name: 'Positive', color: SENT.pos }, { name: 'Neutral', color: SENT.neu }, { name: 'Negative', color: SENT.neg }]} />
        <SentimentChart rows={sent} />
      </Card>

      {/* Use cases and topics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6 flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1">
            <H2>By PMM use case</H2>
            <p className="text-[15px]" style={{ color: T.muted }}>Clay’s visibility within each use case’s prompts</p>
          </div>
          <GroupTable rows={pmm} label="Use case" />
        </Card>
        <Card className="p-5 sm:p-6 flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1">
            <H2>By topic</H2>
            <p className="text-[15px]" style={{ color: T.muted }}>Clay’s visibility within each topic’s prompts</p>
          </div>
          <GroupTable rows={topics} label="Topic" />
        </Card>
      </div>

      <p className="text-[13px]" style={{ color: T.muted }}>
        {meta.sample ? 'Sample data. ' : `Synced ${new Date(meta.syncedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. `}
        Each prompt runs once per platform every Monday; weeks are summed, not averaged. The Event Campaigns use case is hidden.
      </p>
    </div>
  )
}

