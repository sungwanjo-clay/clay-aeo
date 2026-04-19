'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import {
  getExplorerData, getDistinctDimensionValues,
  type ExplorerMetric, type ExplorerDimension, type TimeAggregation, type ExplorerRow,
} from '@/lib/queries/explorer'
import VisibilityLineChart from '@/components/charts/VisibilityLineChart'
import ExplorerDataTable from '@/components/tables/ExplorerDataTable'
import { SkeletonChart, SkeletonTable } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import type { TimeseriesRow } from '@/lib/queries/types'

const METRIC_OPTIONS: { value: ExplorerMetric; label: string }[] = [
  { value: 'visibility_score', label: 'Visibility Score' },
  { value: 'mention_share', label: 'Mention Share' },
  { value: 'citation_share', label: 'Citation Share' },
  { value: 'avg_position', label: 'Avg Position' },
  { value: 'positive_sentiment_pct', label: 'Positive Sentiment %' },
  { value: 'brand_sentiment_score', label: 'Brand Sentiment Score' },
  { value: 'response_quality_score', label: 'Response Quality Score' },
  { value: 'competitor_count', label: '# Competitors Mentioned' },
  { value: 'tools_recommended', label: '# Tools Recommended' },
  { value: 'claygent_mcp_rate', label: 'Claygent/MCP Mention Rate' },
  { value: 'avg_credits', label: 'Avg Credits Charged' },
]

const DIMENSION_OPTIONS: { value: ExplorerDimension; label: string }[] = [
  { value: 'platform', label: 'Platform' },
  { value: 'topic', label: 'Topic' },
  { value: 'intent', label: 'Intent' },
  { value: 'pmm_classification', label: 'PMM Classification' },
  { value: 'branded_or_non_branded', label: 'Branded / Non-Branded' },
  { value: 'prompt_type', label: 'Prompt Type' },
  { value: 'tags', label: 'Tag' },
]

const AGG_OPTIONS: { value: TimeAggregation; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export default function ExplorerPage() {
  const [metric, setMetric] = useState<ExplorerMetric>('visibility_score')
  const [dimension, setDimension] = useState<ExplorerDimension>('platform')
  const [aggregation, setAggregation] = useState<TimeAggregation>('day')
  const [dimValues, setDimValues] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [data, setData] = useState<ExplorerRow[]>([])
  const [loading, setLoading] = useState(false)

  // Load dimension values when dimension changes
  useEffect(() => {
    getDistinctDimensionValues(supabase, dimension).then(vals => {
      setDimValues(vals)
      setSelectedValues([]) // reset selection
    })
  }, [dimension])

  const run = useCallback(async () => {
    setLoading(true)
    const result = await getExplorerData(supabase, {
      metric,
      dimension,
      dimensionValues: selectedValues,
      startDate,
      endDate,
      aggregation,
    })
    setData(result)
    setLoading(false)
  }, [metric, dimension, selectedValues, startDate, endDate, aggregation])

  // Convert data to TimeseriesRow format for the line chart
  const chartData: TimeseriesRow[] = data.map(r => ({
    date: r.period,
    value: r.value ?? 0,
    platform: r.dimensionValue,
    topic: r.dimensionValue,
  }))

  const uniqueValues = [...new Set(data.map(r => r.dimensionValue))]
  const tooManyValues = uniqueValues.length > 10

  const metricLabel = METRIC_OPTIONS.find(m => m.value === metric)?.label ?? metric
  const dimLabel = DIMENSION_OPTIONS.find(d => d.value === dimension)?.label ?? dimension
  const dateRange = `${startDate}_${endDate}`

  function toggleValue(v: string) {
    setSelectedValues(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900">Metric Explorer</h1>
      <p className="text-sm text-gray-500 -mt-4">Slice the data yourself — compose your own view</p>

      {/* Filter bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Metric</label>
            <select
              value={metric}
              onChange={e => setMetric(e.target.value as ExplorerMetric)}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Time Aggregation</label>
            <div className="flex gap-1">
              {AGG_OPTIONS.map(a => (
                <button
                  key={a.value}
                  onClick={() => setAggregation(a.value)}
                  className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${aggregation === a.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Dimension</label>
            <select
              value={dimension}
              onChange={e => setDimension(e.target.value as ExplorerDimension)}
              className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {DIMENSION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>

          <div className="flex-1 min-w-48">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Values</label>
            <div className="flex flex-wrap gap-1">
              {dimValues.slice(0, 15).map(v => (
                <button
                  key={v}
                  onClick={() => toggleValue(v)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${selectedValues.includes(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
                >
                  {v || '(blank)'}
                </button>
              ))}
              {dimValues.length > 15 && <span className="text-xs text-gray-400 self-center">+{dimValues.length - 15} more</span>}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Date Range</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <button
            onClick={run}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Run
          </button>
        </div>
      </div>

      {/* Warning for too many values */}
      {tooManyValues && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          More than 10 dimension values selected — chart may be cluttered. Consider filtering down.
        </div>
      )}

      {/* Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">
          {metricLabel} by {dimLabel}
        </h2>
        <p className="text-xs text-gray-400 mb-4">{aggregation} aggregation · {startDate} to {endDate}</p>

        {loading ? (
          <SkeletonChart />
        ) : data.length === 0 ? (
          <EmptyState
            title="No data for this combination"
            description="Try adjusting the dimension, metric, or date range"
          />
        ) : (
          <VisibilityLineChart data={chartData} groupKey="platform" height={300} startDate={startDate} endDate={endDate} />
        )}
      </div>

      {/* Data table */}
      {!loading && data.length > 0 && (
        <ExplorerDataTable
          data={data}
          metric={metricLabel}
          dimension={dimLabel}
          dateRange={dateRange}
        />
      )}
    </div>
  )
}
