'use client'

import { useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
  type MouseHandlerDataParam,
} from 'recharts'
import type { DashboardPayload } from '@/lib/plg/load'
import { addDays, fmtRange, type ISODate } from '@/lib/plg/dates'
import type { DailyMetric, DailySeries } from '@/lib/plg/daily'
import { Card, H2, T, fmtInt, fmtK, fmtPct } from './ui'

/**
 * Metrics for the cumulative chart, the headline tiles' numbers. Counts are running totals; rates are running ratios
 * (e.g. visitor → HQ = HQ workspaces so far ÷ visits so far). Tier 1–3 workspaces is the goal metric (the one official
 * goal, straight-line over the quarter); the rest show the period before instead. Visits are daily unique visitors summed over days (not unique over the range, like the tile).
 */
type MetricId = 'ws' | 'vis' | 't13' | 'np' | 'paid' | 'visHq' | 'trialPaid' | 'activation' | 'npShare'
const METRICS: { id: MetricId; label: string; num: DailyMetric; den?: DailyMetric; rate?: boolean }[] = [
  { id: 't13', label: 'Tier 1–3 workspaces vs goal', num: 't13' },
  { id: 'ws', label: 'New workspaces', num: 'ws' },
  { id: 'vis', label: 'Visits (daily unique visitors)', num: 'vis' },
  { id: 'np', label: 'Non-personal workspaces', num: 'np' },
  { id: 'paid', label: 'New paid workspaces', num: 'paid' },
  { id: 'npShare', label: 'Non-personal share', num: 'np', den: 'ws', rate: true },
  { id: 'visHq', label: 'Visitor → HQ trial user', num: 'hq', den: 'vis', rate: true },
  { id: 'trialPaid', label: 'Trial → paid', num: 'paid', den: 'hq', rate: true },
  { id: 'activation', label: 'Activation (7 days)', num: 'act', den: 'mat', rate: true },
]

type Pt = DashboardPayload['cumulative']['points'][number]

function LegendSwatch({ dash, color, label }: { dash?: string; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[15px]" style={{ color: T.ink }}>
      <svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={color} strokeWidth="3" strokeDasharray={dash} /></svg>
      {label}
    </span>
  )
}

/** Running totals (or ratios) of a daily series for each chart bucket, this period and the one before. */
function series(v: DashboardPayload, daily: DailySeries, m: (typeof METRICS)[number]) {
  const run = (from: string, k: number, key: DailyMetric) => { let s = 0; for (let i = 0; i <= k; i++) s += daily[key].get(addDays(from as ISODate, i)) ?? 0; return s }
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
  const prevLen = days(v.range.prevStart, v.range.prevEnd)
  return v.cumulative.points.map(p => {
    const k = days(v.range.start, p.end)
    const val = (from: string) => { const n = run(from, k, m.num); if (!m.den) return n; const dd = run(from, k, m.den); return dd ? n / dd : null }
    return { ...p, actual: val(v.range.start), prev: k <= prevLen ? val(v.range.prevStart) : null, goal: m.id === 't13' ? p.goal : null }
  })
}

export default function CumulativeChart({ v, onZoom, daily }: { v: DashboardPayload; onZoom: (start: string, end: string) => void; daily?: DailySeries | null }) {
  const [mid, setMid] = useState<MetricId>('t13')
  const m = METRICS.find(x => x.id === mid)!
  const useGoal = mid === 't13'
  const pts: (Omit<Pt, 'actual'> & { actual: number | null; prev?: number | null })[] = daily ? series(v, daily, m) : []
  const fmtV = (n: number) => (m.rate ? fmtPct(n, 1) : fmtK(n))
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const idx = (s: MouseHandlerDataParam) => (typeof s?.activeTooltipIndex === 'number' ? s.activeTooltipIndex : Number(s?.activeTooltipIndex))
  const lastIdx = pts.length - 1

  const finishDrag = () => {
    if (drag && drag.a !== drag.b && Number.isFinite(drag.a) && Number.isFinite(drag.b)) {
      const lo = Math.min(drag.a, drag.b); const hi = Math.max(drag.a, drag.b)
      onZoom(pts[lo].start, pts[hi].end)
    }
    setDrag(null)
  }

  return (
    <Card className="p-5 sm:p-10 flex flex-col gap-6 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <H2>{useGoal ? 'Cumulative Tier 1–3 workspaces vs goal' : `${m.rate ? 'Running' : 'Cumulative'} ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`}</H2>
          <select aria-label="Metric" value={mid} onChange={e => setMid(e.target.value as MetricId)} disabled={!daily}
            title={daily ? undefined : 'The other metrics load with the daily series (Clay Sigma or the saved copy)'}
            className="rounded-full px-3 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {METRICS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
        <p className="text-[15px] sm:text-[16px]" style={{ color: T.muted }}>
          {useGoal ? (v.cumulative.goalTotal != null ? <>Goal <span style={{ fontFamily: T.mono }}>{fmtInt(v.cumulative.goalTotal)}</span> for these dates</> : 'No goal for these dates')
            : <>Dashed: {v.range.prevLabel ?? 'the period before'}</>}
        </p>
      </div>
      {!daily ? <p className="h-[300px] text-[15px]" style={{ color: T.muted }}>Loading the daily series (Clay Sigma, or the saved copy)…</p> :
      <div className="h-[300px] select-none" aria-label="Cumulative workspaces chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={pts}
            margin={{ top: 24, right: 28, bottom: 4, left: 0 }}
            onMouseDown={s => { const i = idx(s); if (Number.isFinite(i)) setDrag({ a: i, b: i }) }}
            onMouseMove={s => { if (drag) { const i = idx(s); if (Number.isFinite(i)) setDrag({ ...drag, b: i }) } }}
            onMouseUp={finishDrag}
            onMouseLeave={() => setDrag(null)}
          >
            <CartesianGrid vertical={false} stroke="#ECEAE5" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#D9D6CF' }} interval="preserveStartEnd" minTickGap={24}
              tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <YAxis tickFormatter={fmtV} tickLine={false} axisLine={false} width={44}
              tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <Tooltip
              cursor={{ stroke: '#D9D6CF' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as Pt
                return (
                  <div className="rounded-xl px-3 py-2 text-[13px] shadow-sm" style={{ background: '#fff', border: `1px solid ${T.border}`, fontFamily: T.mono }}>
                    <p className="mb-1" style={{ color: T.muted }}>{p.start === p.end ? fmtRange(p.start, p.end).split(',')[0].split(' – ')[0] : fmtRange(p.start, p.end)}</p>
                    <p style={{ color: T.pos }}>{useGoal ? 'Actual' : 'This period'} {p.actual == null ? '–' : !m.rate ? fmtInt(p.actual) : fmtPct(p.actual, 1)}</p>
                    {p.goal != null && <p style={{ color: T.muted }}>Goal {fmtInt(p.goal)}</p>}
                    {!useGoal && p.prev != null && <p style={{ color: T.muted }}>Period before {m.rate ? fmtPct(p.prev, 1) : fmtInt(p.prev)}</p>}
                  </div>
                )
              }}
            />
            <Line type="linear" dataKey={useGoal ? 'goal' : 'prev'} stroke="#7A7770" strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls />
            <Line type="linear" dataKey="actual" stroke={T.pos} strokeWidth={3} isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === lastIdx && props.cx != null && props.cy != null
                  ? <circle key="last" cx={props.cx} cy={props.cy} r={5} fill={T.pos} />
                  : <g key={props.index} />}
            >
              <LabelList dataKey="actual" content={(p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) =>
                p.index === lastIdx
                  ? <text x={Number(p.x)} y={Number(p.y) - 12} textAnchor="middle" fontSize={12} fontFamily={T.mono} fill={T.ink}>{fmtV(Number(p.value))}</text>
                  : null} />
            </Line>
            {drag && drag.a !== drag.b && (
              <ReferenceArea x1={pts[Math.min(drag.a, drag.b)]?.label} x2={pts[Math.max(drag.a, drag.b)]?.label} fill={T.pos} fillOpacity={0.08} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-6">
          <LegendSwatch color={T.pos} label={useGoal ? 'Actual' : 'This period'} />
          <LegendSwatch color="#7A7770" dash="5 4" label={useGoal ? 'Goal' : 'Period before'} />
        </div>
        <p className="text-[14px]" style={{ color: T.muted }}>Drag across the chart to zoom into those dates.</p>
      </div>
    </Card>
  )
}
