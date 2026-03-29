'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatShortDate } from '@/lib/utils/formatters'
import MentionBreakdownTable from './MentionBreakdownTable'
import type { MentionTopicRow } from '@/lib/queries/visibility'

interface Props {
  claygentData: { date: string; count: number }[]
  followupData: { date: string; count: number }[]
  claygentBreakdown: MentionTopicRow[]
  followupBreakdown: MentionTopicRow[]
}

const cardStyle = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const labelStyle = { color: 'rgba(26,25,21,0.45)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

function CountChart({
  data,
  title,
  subtitle,
  color,
  breakdown,
}: {
  data: { date: string; count: number }[]
  title: string
  subtitle: string
  color: string
  breakdown: MentionTopicRow[]
}) {
  const total = data.reduce((s, d) => s + d.count, 0)

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

      {/* Bar chart */}
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barSize={14}>
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
              cursor={{ fill: 'rgba(26,25,21,0.04)' }}
            />
            <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : data.length === 1 ? (
        <div className="py-3 text-center">
          <p className="text-xl font-bold" style={{ color: 'var(--clay-black)' }}>{data[0].count} mentions</p>
          <p style={{ ...labelStyle, marginTop: '4px', display: 'block' }}>Only 1 data point — run again tomorrow to see a trend</p>
        </div>
      ) : (
        <p className="py-3 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No data yet</p>
      )}

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--clay-border-dashed)' }} />

      {/* Breakdown table */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'rgba(26,25,21,0.45)' }}>
          By topic & prompt — click to expand
        </p>
        <MentionBreakdownTable data={breakdown} accentColor={color} />
      </div>
    </div>
  )
}

export default function ClaygentSection({ claygentData, followupData, claygentBreakdown, followupBreakdown }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
      <CountChart
        data={claygentData}
        title="ClayMCP & Agent Mentions"
        subtitle="Times ClayMCP or Clay Agent was mentioned per day"
        color="#4A5AFF"
        breakdown={claygentBreakdown}
      />
      <CountChart
        data={followupData}
        title="Clay Recommended as Follow-up"
        subtitle="Times Clay was recommended as a follow-up action per day"
        color="#3DAA6A"
        breakdown={followupBreakdown}
      />
    </div>
  )
}
