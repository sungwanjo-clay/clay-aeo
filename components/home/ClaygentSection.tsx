'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatShortDate } from '@/lib/utils/formatters'
import { generateDateRange } from '@/lib/utils/dateRange'

interface Props {
  claygentData: { date: string; count: number }[]
  followupData: { date: string; count: number }[]
  startDate: string
  endDate: string
}

const cardStyle = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const labelStyle = { color: 'rgba(26,25,21,0.45)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

function CountChart({
  data,
  title,
  subtitle,
  color,
  startDate,
  endDate,
}: {
  data: { date: string; count: number }[]
  title: string
  subtitle: string
  color: string
  startDate: string
  endDate: string
}) {
  const total = data.reduce((s, d) => s + d.count, 0)

  // Build full-range chart data — dates without data omit the key (renders as gap)
  const dataLookup = new Map(data.map(r => [r.date, r.count]))
  const allDates = generateDateRange(startDate, endDate)
  const chartData = allDates.map(date => {
    const row: Record<string, string | number> = { date }
    if (dataLookup.has(date)) row['count'] = dataLookup.get(date)!
    return row
  })

  return (
    <div className="p-5 space-y-5" style={cardStyle}>
      {/* Header + total */}
      <div>
        <div className="flex items-start justify-between mb-1">
          <h2 style={labelStyle}>{title}</h2>
          <span className="text-2xl font-extrabold tabular-nums" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
            {total.toLocaleString()}
          </span>
        </div>
        <p className="text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>{subtitle}</p>
      </div>

      {/* Line chart */}
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(val: any) => [Number(val).toLocaleString(), 'Mentions']}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(l: any) => formatShortDate(String(l))}
              contentStyle={{
                fontSize: 11,
                fontFamily: 'Plus Jakarta Sans',
                border: '1px solid var(--clay-border-dashed)',
                borderRadius: '8px',
              }}
              cursor={{ stroke: 'rgba(26,25,21,0.08)' }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 0, fill: color }}
              activeDot={{ r: 6, strokeWidth: 0, fill: color }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : data.length === 1 ? (
        <div className="py-3 text-center">
          <p className="text-xl font-bold" style={{ color: 'var(--clay-black)' }}>{data[0].count} mentions</p>
          <p style={{ ...labelStyle, marginTop: '4px', display: 'block' }}>Only 1 data point — run again tomorrow to see a trend</p>
        </div>
      ) : (
        <p className="py-3 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No data yet</p>
      )}
    </div>
  )
}

export default function ClaygentSection({ claygentData, followupData, startDate, endDate }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
      <CountChart
        data={claygentData}
        title="ClayMCP & Agent Mentions"
        subtitle="Times ClayMCP or Clay Agent was mentioned per day"
        color="#4A5AFF"
        startDate={startDate}
        endDate={endDate}
      />
      <CountChart
        data={followupData}
        title="Clay Recommended as Follow-up"
        subtitle="Times Clay was recommended as a follow-up action per day"
        color="#3DAA6A"
        startDate={startDate}
        endDate={endDate}
      />
    </div>
  )
}
