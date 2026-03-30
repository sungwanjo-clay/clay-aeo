'use client'

import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts'
import type { PMMCompRow } from '@/lib/queries/competitive'
import { SkeletonChart } from '@/components/shared/Skeleton'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const COMP_COLORS = ['#4A5AFF', '#FF6B35', '#CC3D8A', '#3DB8CC', '#3DAA6A']

interface Props {
  allRows: Record<string, PMMCompRow[]>
  selectedComps: string[]
  loading: boolean
}

export default function CompTopicGap({ allRows, selectedComps, loading }: Props) {
  const nonClayComps = selectedComps.filter(c => c !== 'Clay')

  if (loading) {
    return (
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">Topic Visibility Gap</div>
        <SkeletonChart />
      </div>
    )
  }

  if (nonClayComps.length === 0 || Object.keys(allRows).length === 0) {
    return null
  }

  // Build data: for each topic, compute Clay% - Competitor% per competitor
  const allTopics = new Set<string>()
  for (const rows of Object.values(allRows)) {
    for (const r of rows) allTopics.add(r.pmm_use_case)
  }

  const chartData = Array.from(allTopics).map(topic => {
    const row: Record<string, string | number> = { topic }
    let clayVis = 0
    for (const [comp, rows] of Object.entries(allRows)) {
      const r = rows.find(x => x.pmm_use_case === topic)
      if (r?.clay_visibility) clayVis = r.clay_visibility
      if (comp !== 'Clay' && r) {
        row[comp] = parseFloat((r.clay_visibility - r.competitor_visibility).toFixed(1))
      }
    }
    row._clayVis = clayVis
    return row
  }).sort((a, b) => {
    // Sort by average gap across competitors (descending)
    const avgA = nonClayComps.reduce((s, c) => s + (Number(a[c]) || 0), 0) / nonClayComps.length
    const avgB = nonClayComps.reduce((s, c) => s + (Number(b[c]) || 0), 0) / nonClayComps.length
    return avgB - avgA
  })

  const maxAbs = Math.max(
    ...chartData.flatMap(d => nonClayComps.map(c => Math.abs(Number(d[c]) || 0))),
    5
  )

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#fff', border: '1px solid var(--clay-border)', borderRadius: '8px', padding: '8px 12px', fontSize: 11 }}>
        <p className="font-bold mb-1" style={{ color: 'var(--clay-black)' }}>{label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="font-bold" style={{ color: p.fill }}>
              {p.value >= 0 ? `+${p.value}` : p.value}%
            </span>
            <span style={{ color: 'rgba(26,25,21,0.6)' }}>Clay vs {p.dataKey}</span>
          </div>
        ))}
        <p className="mt-1 text-[10px]" style={{ color: 'rgba(26,25,21,0.4)' }}>Positive = Clay leads · Negative = competitor leads</p>
      </div>
    )
  }

  return (
    <div style={CARD} className="p-4">
      <div style={LABEL} className="mb-1">Topic Visibility Gap</div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
        Clay's visibility advantage (+) or disadvantage (−) vs each competitor per PMM topic.
        Green bars = Clay is winning. Colored bars = competitor is winning.
      </p>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: '#3DAA6A' }} />
          <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.6)' }}>Clay leads</span>
        </div>
        {nonClayComps.map((comp, i) => (
          <div key={comp} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ background: COMP_COLORS[i % COMP_COLORS.length] }} />
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.6)' }}>{comp} leads</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * (nonClayComps.length > 1 ? 28 : 22))}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
          barCategoryGap={nonClayComps.length > 1 ? '20%' : '40%'}
          barGap={2}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(26,25,21,0.06)" />
          <XAxis
            type="number"
            domain={[-maxAbs, maxAbs]}
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`}
            tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="topic"
            width={160}
            tick={{ fontSize: 11, fill: 'rgba(26,25,21,0.7)', fontWeight: 500 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(26,25,21,0.03)' }} />
          <ReferenceLine x={0} stroke="rgba(26,25,21,0.2)" strokeWidth={1.5} />
          {nonClayComps.map((comp, idx) => (
            <Bar key={comp} dataKey={comp} radius={[0, 3, 3, 0]} maxBarSize={18}>
              {chartData.map((entry, i) => {
                const val = Number(entry[comp]) || 0
                const color = val >= 0 ? '#3DAA6A' : COMP_COLORS[idx % COMP_COLORS.length]
                return <Cell key={i} fill={color} fillOpacity={0.85} />
              })}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
