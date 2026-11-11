'use client'

import { useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
  type MouseHandlerDataParam,
} from 'recharts'
import type { DashboardPayload } from '@/lib/plg/load'
import { fmtRange } from '@/lib/plg/dates'
import { Card, H2, T, fmtInt, fmtK } from './ui'

type Pt = DashboardPayload['cumulative']['points'][number]

function LegendSwatch({ dash, color, label }: { dash?: string; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[15px]" style={{ color: T.ink }}>
      <svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={color} strokeWidth="3" strokeDasharray={dash} /></svg>
      {label}
    </span>
  )
}

export default function CumulativeChart({ v, onZoom }: { v: DashboardPayload; onZoom: (start: string, end: string) => void }) {
  const pts = v.cumulative.points
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
        <H2>Cumulative workspaces vs goal</H2>
        <p className="text-[15px] sm:text-[16px]" style={{ color: T.muted }}>
          {v.cumulative.goalTotal != null ? <>Goal <span style={{ fontFamily: T.mono }}>{fmtInt(v.cumulative.goalTotal)}</span> for these dates</> : 'No goal for these dates'}
        </p>
      </div>
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
            <YAxis tickFormatter={fmtK} tickLine={false} axisLine={false} width={44}
              tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <Tooltip
              cursor={{ stroke: '#D9D6CF' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as Pt
                return (
                  <div className="rounded-xl px-3 py-2 text-[13px] shadow-sm" style={{ background: '#fff', border: `1px solid ${T.border}`, fontFamily: T.mono }}>
                    <p className="mb-1" style={{ color: T.muted }}>{p.start === p.end ? fmtRange(p.start, p.end).split(',')[0].split(' – ')[0] : fmtRange(p.start, p.end)}</p>
                    <p style={{ color: T.pos }}>Actual {fmtInt(p.actual)}</p>
                    {p.prev != null && <p style={{ color: '#5B8DEF' }}>Previous {fmtInt(p.prev)}</p>}
                    {p.goal != null && <p style={{ color: T.muted }}>Goal {fmtInt(p.goal)}</p>}
                  </div>
                )
              }}
            />
            <Line type="linear" dataKey="goal" stroke="#7A7770" strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} connectNulls />
            <Line type="linear" dataKey="prev" stroke="#5B8DEF" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
            <Line type="linear" dataKey="actual" stroke={T.pos} strokeWidth={3} isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === lastIdx && props.cx != null && props.cy != null
                  ? <circle key="last" cx={props.cx} cy={props.cy} r={5} fill={T.pos} />
                  : <g key={props.index} />}
            >
              <LabelList dataKey="actual" content={(p: { x?: number | string; y?: number | string; index?: number; value?: unknown }) =>
                p.index === lastIdx
                  ? <text x={Number(p.x)} y={Number(p.y) - 12} textAnchor="middle" fontSize={12} fontFamily={T.mono} fill={T.ink}>{fmtK(Number(p.value))}</text>
                  : null} />
            </Line>
            {drag && drag.a !== drag.b && (
              <ReferenceArea x1={pts[Math.min(drag.a, drag.b)]?.label} x2={pts[Math.max(drag.a, drag.b)]?.label} fill={T.pos} fillOpacity={0.08} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-6">
          <LegendSwatch color={T.pos} label="Actual" />
          <LegendSwatch color="#5B8DEF" dash="4 3" label={v.range.compare === 'previous_year' ? 'Last year' : 'Previous period'} />
          <LegendSwatch color="#7A7770" dash="5 4" label="Goal" />
        </div>
        <p className="text-[14px]" style={{ color: T.muted }}>Drag across the chart to zoom into those dates.</p>
      </div>
    </Card>
  )
}
