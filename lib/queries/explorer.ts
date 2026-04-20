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
    if (error) { console.error('[fetchAllPages] error:', error); break }
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

// Only fetch columns required for the specific metric + dimension (avoids
// fetching response_text / themes which can be 10KB+ per row).
function buildSelect(metric: ExplorerMetric, dimension: ExplorerDimension): string {
  const metricCols: Record<ExplorerMetric, string[]> = {
    visibility_score:        ['clay_mentioned'],
    mention_share:           ['clay_mentioned'],
    citation_share:          ['clay_mentioned', 'cited_domains'],
    avg_position:            ['clay_mentioned', 'clay_mention_position'],
    positive_sentiment_pct:  ['clay_mentioned', 'brand_sentiment'],
    brand_sentiment_score:   ['clay_mentioned', 'brand_sentiment_score'],
    response_quality_score:  ['brand_sentiment_score'],
    competitor_count:        ['competitors_mentioned'],
    tools_recommended:       ['number_of_tools_recommended'],
    claygent_mcp_rate:       ['claygent_or_mcp_mentioned'],
    avg_credits:             ['total_credits_charged'],
  }
  const cols = new Set(['run_day', dimension, ...(metricCols[metric] ?? [])])
  return [...cols].join(', ')
}

export async function getExplorerData(
  sb: SupabaseClient,
  params: ExplorerParams
): Promise<ExplorerRow[]> {
  const cols = buildSelect(params.metric, params.dimension)
  console.log('[Explorer] params:', JSON.stringify(params))
  console.log('[Explorer] select cols:', cols)

  let query = sb
    .from('responses')
    .select(cols)
    .gte('run_day', params.startDate)
    .lte('run_day', params.endDate)
    .order('run_day', { ascending: true })

  if (params.dimensionValues.length > 0) {
    query = query.in(params.dimension, params.dimensionValues)
  }

  let data: any[]
  try {
    data = await fetchAllPages(query)
  } catch (err) {
    console.error('[Explorer] fetchAllPages threw:', err)
    return []
  }
  console.log('[Explorer] fetchAllPages returned:', data.length, 'rows')
  if (!data.length) {
    // Diagnostic probe — check if run_day has any data in range
    const { data: probe, error: probeErr } = await sb
      .from('responses').select('run_day').gte('run_day', params.startDate).lte('run_day', params.endDate).limit(1)
    console.log('[Explorer] probe (run_day):', probe, 'err:', probeErr)
    const { data: probe2, error: probe2Err } = await sb
      .from('responses').select('run_date').limit(1)
    console.log('[Explorer] any row at all:', probe2, 'err:', probe2Err)
    return []
  }

  // Group by period + dimension value
  const map = new Map<string, { rows: typeof data }>()
  for (const row of data) {
    const period = toPeriod(row.run_day, params.aggregation)
    const dimVal = row[params.dimension] ?? 'Unknown'
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

function toPeriod(runDay: string | null, agg: TimeAggregation): string {
  if (!runDay) return 'Unknown'
  // run_day is a DATE string 'YYYY-MM-DD' — parse as local date to avoid UTC shift
  const [y, m, d] = runDay.split('T')[0].split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (agg === 'day') return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (agg === 'week') {
    const day = dt.getDay()
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(dt); monday.setDate(diff)
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  }
  return `${y}-${String(m).padStart(2, '0')}`
}

function computeMetric(metric: ExplorerMetric, rows: Record<string, unknown>[]): number | null {
  if (!rows.length) return null
  switch (metric) {
    case 'visibility_score':
    case 'mention_share': {
      const yes = rows.filter(r => (r.clay_mentioned as string)?.toLowerCase() === 'yes').length
      return (yes / rows.length) * 100
    }
    case 'citation_share': {
      const cited = rows.filter(r => {
        try {
          const d = Array.isArray(r.cited_domains) ? r.cited_domains : JSON.parse((r.cited_domains as string) ?? '[]')
          return d.length > 0
        } catch { return false }
      }).length
      return (cited / rows.length) * 100
    }
    case 'avg_position': {
      const positions = rows
        .filter(r => (r.clay_mentioned as string)?.toLowerCase() === 'yes')
        .map(r => r.clay_mention_position)
        .filter((p): p is number => typeof p === 'number' && p > 0)
      return positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null
    }
    case 'positive_sentiment_pct': {
      const mentioned = rows.filter(r => (r.clay_mentioned as string)?.toLowerCase() === 'yes')
      if (!mentioned.length) return null
      const pos = mentioned.filter(r => (r.brand_sentiment as string) === 'Positive').length
      return (pos / mentioned.length) * 100
    }
    case 'brand_sentiment_score':
    case 'response_quality_score': {
      const scores = rows.map(r => r.brand_sentiment_score).filter((s): s is number => typeof s === 'number')
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    }
    case 'competitor_count': {
      const counts = rows.map(r => {
        try {
          return Array.isArray(r.competitors_mentioned)
            ? r.competitors_mentioned.length
            : JSON.parse((r.competitors_mentioned as string) ?? '[]').length
        } catch { return 0 }
      })
      return counts.reduce((a, b) => a + b, 0) / rows.length
    }
    case 'tools_recommended': {
      const vals = rows.map(r => r.number_of_tools_recommended).filter((v): v is number => typeof v === 'number')
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    case 'claygent_mcp_rate': {
      const yes = rows.filter(r => (r.claygent_or_mcp_mentioned as string)?.toLowerCase() === 'yes').length
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
  // Sample the most recent 1000 rows — enough to see all distinct values for
  // low-cardinality dimensions (platform, topic, intent, etc.).
  const { data, error } = await sb
    .from('responses')
    .select(dimension)
    .order('run_day', { ascending: false })
    .range(0, 999)
  console.log('[Explorer] dim values for', dimension, '- rows:', data?.length, 'err:', error)
  if (error) { console.error('[Explorer] dim values error:', error); return [] }
  if (!data?.length) return []
  return [...new Set(data.map((r: any) => r[dimension]).filter(Boolean))].sort() as string[]
}
