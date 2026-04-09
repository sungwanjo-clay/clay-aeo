// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'

export type ExplorerMetric =
  | 'visibility_score'
  | 'mention_share'
  | 'citation_share'
  | 'avg_position'
  | 'positive_sentiment_pct'
  | 'brand_sentiment_score'
  | 'response_quality_score'
  | 'competitor_count'
  | 'tools_recommended'
  | 'claygent_mcp_rate'
  | 'avg_credits'

export type ExplorerDimension =
  | 'platform'
  | 'topic'
  | 'intent'
  | 'pmm_classification'
  | 'branded_or_non_branded'
  | 'prompt_type'
  | 'tags'

export type TimeAggregation = 'day' | 'week' | 'month'

export interface ExplorerParams {
  metric: ExplorerMetric
  dimension: ExplorerDimension
  dimensionValues: string[]
  startDate: string
  endDate: string
  aggregation: TimeAggregation
}

export interface ExplorerRow {
  period: string
  dimensionValue: string
  value: number | null
  responseCount: number
}

async function fetchAllPages(query: any): Promise<any[]> {
  const PAGE = 1000
  const all: any[] = []
  let offset = 0
  while (true) {
    const { data, error } = await query.range(offset, offset + PAGE - 1)
    if (error || !data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

export async function getExplorerData(
  sb: SupabaseClient,
  params: ExplorerParams
): Promise<ExplorerRow[]> {
  const data = await fetchAllPages(sb
    .from('responses')
    .select('*')
    .gte('run_date', params.startDate)
    .lte('run_date', params.endDate))

  if (!data.length) return []

  const filtered =
    params.dimensionValues.length > 0
      ? data.filter(r => params.dimensionValues.includes(r[params.dimension] ?? ''))
      : data

  // Group by period + dimension value
  const map = new Map<string, { rows: typeof data }>()
  for (const row of filtered) {
    const period = toPeriod(row.run_date, params.aggregation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dimVal = (row as any)[params.dimension] ?? 'Unknown'
    const key = `${period}|||${dimVal}`
    const cur = map.get(key) ?? { rows: [] }
    cur.rows.push(row)
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { rows }]) => {
    const [period, dimensionValue] = key.split('|||')
    return {
      period,
      dimensionValue,
      value: computeMetric(params.metric, rows),
      responseCount: rows.length,
    }
  }).sort((a, b) => a.period.localeCompare(b.period) || a.dimensionValue.localeCompare(b.dimensionValue))
}

function toPeriod(runDate: string | null, agg: TimeAggregation): string {
  if (!runDate) return 'Unknown'
  const d = new Date(runDate)
  if (agg === 'day') return d.toISOString().split('T')[0]
  if (agg === 'week') {
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d.setDate(diff))
    return monday.toISOString().split('T')[0]
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function computeMetric(metric: ExplorerMetric, rows: Record<string, unknown>[]): number | null {
  if (!rows.length) return null
  switch (metric) {
    case 'visibility_score': {
      const yes = rows.filter(r => r.clay_mentioned === 'Yes').length
      return (yes / rows.length) * 100
    }
    case 'positive_sentiment_pct': {
      const mentioned = rows.filter(r => r.clay_mentioned === 'Yes')
      if (!mentioned.length) return null
      const pos = mentioned.filter(r => r.brand_sentiment === 'Positive').length
      return (pos / mentioned.length) * 100
    }
    case 'brand_sentiment_score': {
      const scores = rows.map(r => r.brand_sentiment_score).filter((s): s is number => typeof s === 'number')
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    }
    case 'response_quality_score': {
      const scores = rows.map(r => r.sentiment_score).filter((s): s is number => typeof s === 'number')
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    }
    case 'avg_position': {
      const positions = rows.map(r => r.clay_mention_position).filter((p): p is number => typeof p === 'number')
      return positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null
    }
    case 'competitor_count': {
      const counts = rows.map(r => {
        try { return Array.isArray(r.competitors_mentioned) ? r.competitors_mentioned.length : JSON.parse(r.competitors_mentioned as string ?? '[]').length }
        catch { return 0 }
      })
      return counts.reduce((a, b) => a + b, 0) / rows.length
    }
    case 'tools_recommended': {
      const vals = rows.map(r => r.number_of_tools_recommended).filter((v): v is number => typeof v === 'number')
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    case 'claygent_mcp_rate': {
      const yes = rows.filter(r => r.claygent_or_mcp_mentioned === 'Yes').length
      return (yes / rows.length) * 100
    }
    case 'avg_credits': {
      const vals = rows.map(r => r.total_credits_charged).filter((v): v is number => typeof v === 'number')
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    default:
      return null
  }
}

export async function getDistinctDimensionValues(
  sb: SupabaseClient,
  dimension: ExplorerDimension
): Promise<string[]> {
  const { data } = await sb.from('responses').select(dimension).not(dimension, 'is', null)
  if (!data) return []
  return [...new Set(data.map(r => r[dimension]).filter(Boolean))].sort() as string[]
}
