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

export async function getExplorerData(
  sb: SupabaseClient,
  params: ExplorerParams
): Promise<ExplorerRow[]> {
  const { data, error } = await sb.rpc('get_explorer_data', {
    p_metric:            params.metric,
    p_dimension:         params.dimension,
    p_start_date:        params.startDate,
    p_end_date:          params.endDate,
    p_aggregation:       params.aggregation,
    p_dimension_values:  params.dimensionValues.length > 0 ? params.dimensionValues : null,
  })

  if (error) {
    console.error('[Explorer] get_explorer_data error:', error)
    return []
  }
  if (!data?.length) return []

  return (data as any[]).map(r => ({
    period:         r.period,
    dimensionValue: r.dimension_value,
    value:          r.value ?? null,
    responseCount:  Number(r.response_count),
  }))
}

export async function getDistinctDimensionValues(
  sb: SupabaseClient,
  dimension: ExplorerDimension
): Promise<string[]> {
  const { data, error } = await sb.rpc('get_explorer_dimension_values', {
    p_dimension: dimension,
  })
  if (error) {
    console.error('[Explorer] get_explorer_dimension_values error:', error)
    return []
  }
  return Array.isArray(data) ? data.filter(Boolean) : []
}
