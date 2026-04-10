// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, ThemeRow, TimeseriesRow } from './types'

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

async function fetchFiltered(query: any, f: FilterParams): Promise<any[]> {
  return fetchAllPages(applyFilters(query, f))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, f: FilterParams): any {
  query = query.gte('run_date', f.startDate).lte('run_date', f.endDate)
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.topics && f.topics.length > 0) query = query.in('topic', f.topics)
  if (f.brandedFilter !== 'all') {
    const val = f.brandedFilter === 'branded' ? 'Branded' : 'Non-Branded'
    query = query.eq('branded_or_non_branded', val)
  }
  if (f.promptType === 'benchmark') {
    query = query.filter('prompt_type', 'ilike', 'benchmark')
  } else if (f.promptType === 'campaign') {
    query = query.not('prompt_type', 'is', null).filter('prompt_type', 'not.ilike', 'benchmark')
  }
  if (f.tags && f.tags !== 'all') query = query.eq('tags', f.tags)
  return query
}

function sentimentRpcParams(f: FilterParams) {
  return {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  }
}

export async function getSentimentBreakdown(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{
  positive: number | null
  neutral: number | null
  negative: number | null
  notMentioned: number | null
  avgScore: number | null
}> {
  const { data, error } = await sb.rpc('get_sentiment_breakdown_rpc', sentimentRpcParams(f))
  if (error) console.error('[getSentimentBreakdown] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null
  if (!r || !r.mentioned_count) return { positive: null, neutral: null, negative: null, notMentioned: null, avgScore: null }
  const m = Number(r.mentioned_count)
  const t = Number(r.total_count)
  return {
    positive:     m > 0 ? (Number(r.positive_count) / m) * 100 : null,
    neutral:      m > 0 ? (Number(r.neutral_count)  / m) * 100 : null,
    negative:     m > 0 ? (Number(r.negative_count) / m) * 100 : null,
    notMentioned: t > 0 ? ((t - m) / t) * 100 : null,
    avgScore:     r.avg_score ?? null,
  }
}

export async function getSentimentTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; positive: number; neutral: number; negative: number }[]> {
  const { data, error } = await sb.rpc('get_sentiment_timeseries_rpc', sentimentRpcParams(f))
  if (error) console.error('[getSentimentTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    date:     String(r.date),
    positive: r.positive ?? 0,
    neutral:  r.neutral  ?? 0,
    negative: r.negative ?? 0,
  }))
}

export async function getThemes(
  sb: SupabaseClient,
  f: FilterParams
): Promise<ThemeRow[]> {
  const data = await fetchFiltered(sb.from('responses').select('themes, clay_mentioned'), f)
  if (!data.length) return []

  const map = new Map<string, { sentiment: string; occurrences: number; snippets: string[] }>()
  for (const row of data) {
    if (row.clay_mentioned !== 'Yes') continue
    const themes = Array.isArray(row.themes) ? row.themes : []
    for (const t of themes) {
      const key = `${t.theme}|||${t.sentiment}`
      const cur = map.get(key) ?? { sentiment: t.sentiment, occurrences: 0, snippets: [] }
      cur.occurrences++
      if (t.snippet) cur.snippets.push(t.snippet)
      map.set(key, cur)
    }
  }

  return Array.from(map.entries()).map(([key, val]) => {
    const [theme] = key.split('|||')
    return { theme, ...val }
  }).sort((a, b) => b.occurrences - a.occurrences)
}

export async function getUseCaseAttribution(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ use_case: string; count: number; pct: number; top_platform: string; top_topic: string }[]> {
  const { data, error } = await sb.rpc('get_use_case_attribution_rpc', sentimentRpcParams(f))
  if (error) console.error('[getUseCaseAttribution] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    use_case:     r.use_case,
    count:        r.count    ?? 0,
    pct:          r.pct      ?? 0,
    top_platform: r.top_platform ?? '—',
    top_topic:    r.top_topic    ?? '—',
  }))
}

export async function getPositioningSnippets(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ topic: string; platform: string; snippet: string; prompt_text: string }[]> {
  const data = await fetchFiltered(
    sb.from('responses').select('positioning_vs_competitors, topic, platform, clay_mentioned'),
    { ...f }
  )
  if (!data.length) return []
  return data
    .filter(r => r.clay_mentioned === 'Yes' && r.positioning_vs_competitors)
    .map(r => ({
      topic: r.topic ?? 'Unknown',
      platform: r.platform,
      snippet: r.positioning_vs_competitors,
      prompt_text: '',
    }))
}

export interface NarrativeGroup {
  theme: string
  sentiment: 'Positive' | 'Neutral' | 'Negative'
  occurrences: number
  snippets: Array<{
    text: string
    platform: string
    topic: string
    date: string
  }>
}

export interface PositioningEntry {
  topic: string
  platform: string
  snippet: string
  date: string
}

export async function getSentimentNarratives(
  sb: SupabaseClient,
  f: FilterParams
): Promise<NarrativeGroup[]> {
  const data = await fetchFiltered(sb.from('responses').select('brand_sentiment, themes, topic, platform, run_date, clay_mentioned'), f)
  if (!data.length) return []

  const map = new Map<string, { sentiment: string; occurrences: number; snippets: Array<{ text: string; platform: string; topic: string; date: string }> }>()

  for (const row of data.filter((r: any) => r.clay_mentioned === 'Yes')) {
    const themes = Array.isArray(row.themes) ? row.themes : []
    for (const t of themes) {
      if (!t.theme) continue
      const sentiment = (t.sentiment ?? row.brand_sentiment ?? 'Neutral') as string
      const key = `${t.theme}|||${sentiment}`
      if (!map.has(key)) map.set(key, { sentiment, occurrences: 0, snippets: [] })
      const cur = map.get(key)!
      cur.occurrences++
      if (t.snippet) {
        cur.snippets.push({
          text: t.snippet,
          platform: row.platform ?? '',
          topic: row.topic ?? '',
          date: row.run_date?.split('T')[0] ?? '',
        })
      }
    }
  }

  const ORDER: Record<string, number> = { Negative: 0, Neutral: 1, Positive: 2 }
  return Array.from(map.entries())
    .map(([key, val]) => {
      const [theme] = key.split('|||')
      return { theme, sentiment: val.sentiment as 'Positive' | 'Neutral' | 'Negative', occurrences: val.occurrences, snippets: val.snippets }
    })
    .sort((a, b) => {
      const so = (ORDER[a.sentiment] ?? 1) - (ORDER[b.sentiment] ?? 1)
      return so !== 0 ? so : b.occurrences - a.occurrences
    })
}

export async function getCompetitivePositioningEntries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<PositioningEntry[]> {
  const data = await fetchFiltered(sb.from('responses').select('positioning_vs_competitors, topic, platform, run_date, clay_mentioned'), f)
  if (!data.length) return []
  return data
    .filter((r: any) => r.clay_mentioned === 'Yes' && r.positioning_vs_competitors)
    .map((r: any) => ({
      topic: r.topic ?? 'General',
      platform: r.platform ?? '',
      snippet: r.positioning_vs_competitors,
      date: r.run_date?.split('T')[0] ?? '',
    }))
    .sort((a: any, b: any) => b.date.localeCompare(a.date))
}
