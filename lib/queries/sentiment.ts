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
    query = query.eq('prompt_type', 'benchmark')
  } else if (f.promptType === 'campaign') {
    query = query.not('prompt_type', 'is', null).neq('prompt_type', 'benchmark')
  }
  if (f.tags && f.tags !== 'all') query = query.eq('tags', f.tags)
  return query
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
  const data = await fetchFiltered(sb.from('responses').select('brand_sentiment, brand_sentiment_score, clay_mentioned'), f)
  if (!data?.length) return { positive: null, neutral: null, negative: null, notMentioned: null, avgScore: null }

  const mentioned = data.filter(r => r.clay_mentioned === 'Yes')
  if (!mentioned.length) return { positive: null, neutral: null, negative: null, notMentioned: null, avgScore: null }

  const pos = mentioned.filter(r => r.brand_sentiment === 'Positive').length
  const neu = mentioned.filter(r => r.brand_sentiment === 'Neutral').length
  const neg = mentioned.filter(r => r.brand_sentiment === 'Negative').length
  const scores = mentioned.map(r => r.brand_sentiment_score).filter((s): s is number => s != null)
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  return {
    positive: (pos / mentioned.length) * 100,
    neutral: (neu / mentioned.length) * 100,
    negative: (neg / mentioned.length) * 100,
    notMentioned: ((data.length - mentioned.length) / data.length) * 100,
    avgScore,
  }
}

export async function getSentimentTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; positive: number; neutral: number; negative: number }[]> {
  const data = await fetchFiltered(sb.from('responses').select('run_date, brand_sentiment, clay_mentioned'), f)
  if (!data.length) return []

  const map = new Map<string, { pos: number; neu: number; neg: number; total: number }>()
  for (const row of data) {
    if (row.clay_mentioned !== 'Yes') continue
    const date = row.run_date?.split('T')[0] ?? ''
    const cur = map.get(date) ?? { pos: 0, neu: 0, neg: 0, total: 0 }
    cur.total++
    if (row.brand_sentiment === 'Positive') cur.pos++
    else if (row.brand_sentiment === 'Neutral') cur.neu++
    else if (row.brand_sentiment === 'Negative') cur.neg++
    map.set(date, cur)
  }

  return Array.from(map.entries())
    .map(([date, { pos, neu, neg, total }]) => ({
      date,
      positive: total > 0 ? (pos / total) * 100 : 0,
      neutral: total > 0 ? (neu / total) * 100 : 0,
      negative: total > 0 ? (neg / total) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
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
  const data = await fetchFiltered(sb.from('responses').select('primary_use_case_attributed, platform, topic, clay_mentioned'), f)
  if (!data.length) return []

  const mentioned = data.filter(r => r.clay_mentioned === 'Yes' && r.primary_use_case_attributed)
  const map = new Map<string, { count: number; platforms: Map<string, number>; topics: Map<string, number> }>()
  for (const row of mentioned) {
    const uc = row.primary_use_case_attributed!
    const cur = map.get(uc) ?? { count: 0, platforms: new Map(), topics: new Map() }
    cur.count++
    cur.platforms.set(row.platform, (cur.platforms.get(row.platform) ?? 0) + 1)
    if (row.topic) cur.topics.set(row.topic, (cur.topics.get(row.topic) ?? 0) + 1)
    map.set(uc, cur)
  }

  return Array.from(map.entries()).map(([use_case, { count, platforms, topics }]) => {
    const top_platform = [...platforms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const top_topic = [...topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return {
      use_case,
      count,
      pct: mentioned.length > 0 ? (count / mentioned.length) * 100 : 0,
      top_platform,
      top_topic,
    }
  }).sort((a, b) => b.count - a.count)
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
