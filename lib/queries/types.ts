export interface FilterParams {
  promptType: string // 'benchmark' | 'campaign' | 'all'
  tags: string       // specific tag or 'all'
  startDate: string  // ISO string
  endDate: string
  prevStartDate: string
  prevEndDate: string
  platforms: string[]  // [] means all platforms
  topics: string[]
  brandedFilter: string // 'all' | 'branded' | 'non-branded'
}

export interface KpiMetrics {
  visibilityScore: number | null
  mentionShare: number | null
  citationShare: number | null
  avgPosition: number | null
  positiveSentimentPct: number | null
  neutralSentimentPct: number | null
  negativeSentimentPct: number | null
  avgBrandSentimentScore: number | null
  shareOfVoice: number | null
}

export interface TimeseriesRow {
  date: string
  value: number
  platform?: string
  topic?: string
  pmm_use_case?: string
}

export interface CompetitorRow {
  competitor_name: string
  mention_count: number
  sov_pct: number
  visibility_score?: number
  avg_position?: number
  delta?: number | null
  isOwned?: boolean
}

export interface CitationDomainRow {
  domain: string
  citation_type: string | null
  url_type: string | null
  citation_count: number
  is_clay: boolean
}

export interface ThemeRow {
  theme: string
  sentiment: string
  occurrences: number
  snippets: string[]
}

export interface InsightRow {
  id: string
  run_date: string
  insight_text: string
  insight_type: string | null
  supporting_data: Record<string, unknown> | null
}

export interface AnomalyRow {
  id: string
  detected_at: string
  run_date: string
  metric: string
  platform: string | null
  topic: string | null
  current_value: number
  previous_value: number
  delta: number
  direction: string
  severity: string
  message: string
  dismissed: boolean
}
