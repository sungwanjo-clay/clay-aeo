'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { TimeseriesRow } from '@/lib/queries/types'
import { PLATFORM_COLORS, CHART_COLORS } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'

interface VisibilityLineChartProps {
  data: TimeseriesRow[]
  groupKey?: 'platform' | 'topic' | 'pmm_use_case'
  height?: number
  yLabel?: string
  compareData?: TimeseriesRow[]  // optional prior period data (rendered dashed)
}

function pivot(data: TimeseriesRow[], groupKey: string) {
  const map = new Map<string, Record<string, number>>()
  const keys = new Set<string>()

  for (const row of data) {
    const group = (row as any)[groupKey] as string | undefined ?? 'Unknown'
    const entry = map.get(row.date) ?? {}
    entry[group] = row.value
    map.set(row.date, entry)
    keys.add(group)
  }

  return {
    chartData: Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals })),
    keys: Array.from(keys),
  }
}

const fmtVal = ((val: any, name: string) => [`${Number(val).toFixed(1)}%`, name]) as any
const fmtLabel = (label: any) => formatShortDate(String(label))

export default function VisibilityLineChart({
  data,
  groupKey = 'platform',
  height = 280,
  yLabel,
  compareData,
}: VisibilityLineChartProps) {
  const { chartData, keys } = pivot(data, groupKey)

  // Dynamic Y-axis max: 20% headroom above max value, rounded to nearest 5, capped at 100
  const allVals = chartData.flatMap(r => Object.entries(r).filter(([k]) => k !== 'date').map(([, v]) => Number(v)))
  const yMax = Math.min(100, Math.ceil(Math.max(...allVals, 1) * 1.2 / 5) * 5)

  // Merge compare data as separate keys with _prev suffix
  let mergedData = chartData
  const compareKeys: string[] = []
  if (compareData && compareData.length > 0) {
    const { chartData: prevChart, keys: prevKeys } = pivot(compareData, groupKey)
    compareKeys.push(...prevKeys.map(k => `${k}_prev`))
    // Align compare data by index position (day offset), not actual date
    const merged = chartData.map((row, i) => {
      const prevRow = prevChart[i]
      const extra: Record<string, number> = {}
      if (prevRow) {
        for (const k of prevKeys) {
          const prevVal = (prevRow as Record<string, unknown>)[k]
          if (prevVal !== undefined) extra[`${k}_prev`] = prevVal as number
        }
      }
      return { ...row, ...extra }
    })
    mergedData = merged
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={mergedData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.5)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={v => `${Number(v).toFixed(0)}%`}
          tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.5)' }}
          tickLine={false}
          axisLine={false}
          domain={[0, yMax]}
          label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined}
        />
        <Tooltip
          formatter={fmtVal}
          labelFormatter={fmtLabel}
          contentStyle={{ fontSize: 12, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border-dashed)', borderRadius: '8px' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
          formatter={(value) => value.replace('_prev', ' (prev)')}
        />
        {keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={
              groupKey === 'platform'
                ? (PLATFORM_COLORS[k] ?? CHART_COLORS[i % CHART_COLORS.length])
                : CHART_COLORS[i % CHART_COLORS.length]
            }
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        ))}
        {compareKeys.map((k, i) => {
          const baseKey = k.replace('_prev', '')
          const color = groupKey === 'platform'
            ? (PLATFORM_COLORS[baseKey] ?? CHART_COLORS[i % CHART_COLORS.length])
            : CHART_COLORS[i % CHART_COLORS.length]
          return (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 3 }}
            />
          )
        })}
      </LineChart>
    </ResponsiveContainer>
  )
}
