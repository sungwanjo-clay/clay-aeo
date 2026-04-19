'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { formatShortDate } from '@/lib/utils/formatters'
import { CHART_COLORS } from '@/lib/utils/colors'
import { generateDateRange } from '@/lib/utils/dateRange'

interface CompetitorComparisonChartProps {
  clayData: { date: string; value: number }[]
  competitorData: { date: string; competitor: string; value: number }[]
  height?: number
  startDate: string
  endDate: string
}

const CLAY_COLOR = '#1A1915'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtVal = ((val: any, name: string) => [`${Number(val).toFixed(1)}%`, name]) as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtLabel = (label: any) => formatShortDate(String(label))

export default function CompetitorComparisonChart({
  clayData,
  competitorData,
  height = 280,
  startDate,
  endDate,
}: CompetitorComparisonChartProps) {
  // Get all unique competitor names
  const competitors = [...new Set(competitorData.map(d => d.competitor))].sort()

  // Span the full filter date range — dates without data are gaps, not zeros
  const allDates = generateDateRange(startDate, endDate)

  // Build competitor lookup: date+competitor → value
  const compLookup = new Map<string, number>()
  for (const row of competitorData) {
    compLookup.set(`${row.date}|||${row.competitor}`, row.value)
  }

  // Build clay lookup
  const clayLookup = new Map<string, number>()
  for (const row of clayData) {
    clayLookup.set(row.date, row.value)
  }

  // Pivot into flat chart data
  const chartData = allDates.map(date => {
    const row: Record<string, string | number> = { date }
    if (clayLookup.has(date)) row['Clay'] = clayLookup.get(date)!
    for (const comp of competitors) {
      if (compLookup.has(`${date}|||${comp}`)) row[comp] = compLookup.get(`${date}|||${comp}`)!
    }
    return row
  })

  const allKeys = ['Clay', ...competitors]

  // Dynamic Y-axis max: 20% headroom, rounded to nearest 5, capped at 100
  const allVals = chartData.flatMap(r => allKeys.map(k => Number(r[k] ?? 0)))
  const yMax = Math.min(100, Math.ceil(Math.max(...allVals, 1) * 1.2 / 5) * 5)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
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
        />
        <Tooltip
          formatter={fmtVal}
          labelFormatter={fmtLabel}
          contentStyle={{
            fontSize: 12,
            fontFamily: 'Plus Jakarta Sans',
            border: '1px solid var(--clay-border-dashed)',
            borderRadius: '8px',
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
        />
        {allKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={key === 'Clay' ? CLAY_COLOR : CHART_COLORS[(i) % CHART_COLORS.length]}
            strokeWidth={key === 'Clay' ? 2.5 : 1.5}
            dot={{ r: key === 'Clay' ? 3.5 : 2.5, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
