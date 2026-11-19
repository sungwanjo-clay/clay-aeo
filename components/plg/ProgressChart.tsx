'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, H2, T, fmtK } from './ui'

/** One selectable metric: its line (and optionally the previous period's, aligned point by point). */
export type ProgressMetric = {
  id: string
  label: string
  points: { label: string; v: number | null }[]
  prev?: { label: string; v: number | null }[]
  fmt: (n: number) => string
  /** Short line under the title (e.g. the latest value and the change). */
  summary?: React.ReactNode
  /** Shown in place of the chart when the metric has no data yet. */
  empty?: string
  note?: React.ReactNode
}

function Swatch({ dash, color, label }: { dash?: string; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[14px]" style={{ color: T.ink }}>
      <svg width="24" height="6" aria-hidden><line x1="0" y1="3" x2="24" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} /></svg>
      {label}
    </span>
  )
}

const PREV = '#7A7770'

/** Progress over time with a metric picker, in the style of the Media tab's trend. */
export default function ProgressChart({ title, metrics, initial, curLabel = 'This period', prevLabel = 'Previous period' }: {
  title: string; metrics: ProgressMetric[]; initial?: string; curLabel?: string; prevLabel?: string
}) {
  const [id, setId] = useState(initial ?? metrics[0]?.id)
  const m = metrics.find(x => x.id === id) ?? metrics[0]
  if (!m) return null
  const hasPrev = !!m.prev?.some(p => p.v != null)
  const data = m.points.map((p, i) => ({ label: p.label, cur: p.v, prev: hasPrev ? m.prev?.[i]?.v ?? null : null, prevLabel: m.prev?.[i]?.label }))
  const hasData = m.points.some(p => p.v != null)
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <H2>{title}</H2>
          {m.summary && <p className="text-[15px] mt-1" style={{ color: T.muted }}>{m.summary}</p>}
        </div>
        <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>Metric
          <select value={m.id} onChange={e => setId(e.target.value)} className="rounded-xl px-3 py-2 text-[15px]"
            style={{ border: `1px solid ${T.border}`, background: '#fff', fontFamily: T.mono, color: T.ink }}>
            {metrics.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </div>
      {!hasData ? (
        <p className="h-[240px] flex items-center justify-center text-center text-[15px] px-6" style={{ color: T.faint, fontStyle: 'italic' }}>{m.empty ?? 'No data for this range yet.'}</p>
      ) : (
        <div className="h-[240px]" aria-label={`${title}: ${m.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#ECEAE5" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={24} interval="preserveStartEnd"
                tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
              <YAxis tickFormatter={v => (m.fmt === undefined ? fmtK(v) : m.fmt(Number(v)))} tickLine={false} axisLine={false} width={56}
                tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
              <Tooltip
                formatter={(v: unknown, n: unknown) => [v == null ? 'no data' : m.fmt(Number(v)), n === 'cur' ? curLabel : prevLabel]}
                labelFormatter={(l: unknown, p: readonly { payload?: { prevLabel?: string } }[]) => {
                  const pl = p?.[0]?.payload?.prevLabel
                  return hasPrev && pl ? `${l} (previous: ${pl})` : String(l)
                }}
                contentStyle={{ fontFamily: T.mono, fontSize: 13, borderRadius: 12, border: `1px solid ${T.border}` }} />
              {hasPrev && <Line dataKey="prev" stroke={PREV} strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
              <Line dataKey="cur" stroke={T.pos} strokeWidth={2} dot={data.length <= 12 ? { r: 4 } : false} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasPrev ? <div className="flex flex-wrap gap-5"><Swatch color={T.pos} label={curLabel} /><Swatch color={PREV} dash="4 4" label={prevLabel} /></div> : <span />}
        {m.note && <p className="text-[13px]" style={{ color: T.muted }}>{m.note}</p>}
      </div>
    </Card>
  )
}
