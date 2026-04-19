// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, CitationDomainRow } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyResponseFilters(query: any, f: FilterParams): any {
  query = query.gte('run_day', f.startDate.split('T')[0]).lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.topics && f.topics.length > 0) query = query.in('topic', f.topics)
  if (f.brandedFilter === 'branded') {
    query = query.ilike('branded_or_non_branded', 'branded')
  } else if (f.brandedFilter === 'non-branded') {
    query = query.not('branded_or_non_branded', 'ilike', 'branded')
  }
  if (f.promptType && f.promptType !== 'all') {
    query = query.filter('prompt_type', 'ilike', f.promptType)
  }
  if (f.tags && f.tags !== 'all') query = query.eq('tags', f.tags)
  return query
}

// For citation_domains table (TIMESTAMPTZ, no run_day column): use exclusive upper bound
function cdDateStr(iso: string): string { return iso.split('T')[0] }
function cdNextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split('T')[0]
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

export async function getCitationShare(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number | null; previous: number | null }> {
  const { data, error } = await sb.rpc('get_citation_share_kpi', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    // Send null (not []) when no platforms selected — PostgREST serializes [] ambiguously
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getCitationShare] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null
  return {
    current:  r?.current_pct  ?? null,
    previous: r?.previous_pct ?? null,
  }
}

export async function getCitationDomains(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CitationDomainRow[]> {
  let query = sb
    .from('citation_domains')
    .select('domain, citation_type, url_type')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms.length > 0) query = query.in('platform', f.platforms)

  const data = await fetchAllPages(query)
  if (!data.length) return []

  const map = new Map<string, { citation_type: string | null; url_type: string | null; count: number }>()
  for (const row of data) {
    const d = row.domain ?? ''
    const cur = map.get(d) ?? { citation_type: row.citation_type, url_type: row.url_type, count: 0 }
    cur.count++
    map.set(d, cur)
  }

  return Array.from(map.entries()).map(([domain, { citation_type, url_type, count }]) => ({
    domain,
    citation_type,
    url_type,
    citation_count: count,
    is_clay: domain.includes('clay.com'),
  })).sort((a, b) => b.citation_count - a.citation_count)
}

export async function getCitationShareTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; platform: string; value: number }[]> {
  const data = await fetchAllPages(applyResponseFilters(
    sb.from('responses').select('run_date, platform, cited_domains'),
    f
  ))
  if (!data.length) return []

  const map = new Map<string, { clayCited: number; total: number }>()
  for (const row of data) {
    const date = row.run_date?.split('T')[0] ?? ''
    const key = `${date}|||${row.platform}`
    const cur = map.get(key) ?? { clayCited: 0, total: 0 }
    cur.total++
    try {
      const domains = Array.isArray(row.cited_domains) ? row.cited_domains : JSON.parse(row.cited_domains ?? '[]')
      if (domains.some((d: string) => typeof d === 'string' && d.includes('clay.com'))) cur.clayCited++
    } catch { /* ignore */ }
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { clayCited, total }]) => {
    const [date, platform] = key.split('|||')
    return { date, platform, value: total > 0 ? (clayCited / total) * 100 : 0 }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getCitationGaps(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; topic: string; prompt_count: number; pct_of_topic: number }[]> {
  // Competitor domains cited when Clay is not mentioned
  let query = sb
    .from('citation_domains')
    .select('domain, citation_type, responses(topic)')
    .eq('citation_type', 'Competition')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms.length > 0) query = query.in('platform', f.platforms)
  const { data } = await (query as any).limit(10000)

  // Also get total per topic to calc pct
  const topicQuery = await applyResponseFilters(
    sb.from('responses').select('topic, clay_mentioned'),
    f
  ).limit(10000)

  const topicTotals = new Map<string, number>()
  for (const r of topicQuery.data ?? []) {
    if (r.topic) topicTotals.set(r.topic, (topicTotals.get(r.topic) ?? 0) + 1)
  }

  if (!data) return []
  const map = new Map<string, { count: number; topic: string }>()
  for (const row of data as any[]) {
    const topic: string = row.responses?.topic ?? 'Unknown'
    const key = `${row.domain}|||${topic}`
    const cur = map.get(key) ?? { count: 0, topic }
    cur.count++
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { count, topic }]) => {
    const [domain] = key.split('|||')
    const topicTotal = topicTotals.get(topic) ?? 0
    return {
      domain,
      topic,
      prompt_count: count,
      pct_of_topic: topicTotal > 0 ? (count / topicTotal) * 100 : 0,
    }
  }).sort((a, b) => b.prompt_count - a.prompt_count)
}

export async function getCitationTypeBreakdown(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ type: string; count: number; pct: number }[]> {
  // Fast path: read from aeo_cache_domains (pre-aggregated, indexed).
  // Each domain already has a canonical citation_type and a response_count.
  // Summing response_count by type gives citation-weighted totals without
  // scanning the raw citation_domains table.
  let query = sb
    .from('aeo_cache_domains')
    .select('citation_type, response_count')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') query = query.ilike('prompt_type', f.promptType)

  const data = await fetchAllPages(query)
  if (!data.length) return []

  const map = new Map<string, number>()
  for (const row of data) {
    const t = row.citation_type ?? 'Other'
    map.set(t, (map.get(t) ?? 0) + Number(row.response_count))
  }
  const total = [...map.values()].reduce((s, n) => s + n, 0)
  return Array.from(map.entries()).map(([type, count]) => ({
    type, count, pct: total > 0 ? (count / total) * 100 : 0,
  })).sort((a, b) => b.count - a.count)
}

export async function getCitationCount(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number; previous: number }> {
  // Single RPC call replaces two parallel paginated fetches (was 10–20 round trips).
  const { data, error } = await sb.rpc('get_citation_count_kpi', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getCitationCount] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null
  return {
    current:  r?.current_count  ?? 0,
    previous: r?.previous_count ?? 0,
  }
}

export async function getCompetitorCitationTimeseries(
  sb: SupabaseClient,
  f: FilterParams,
  topN = 5
): Promise<{ date: string; domain: string; value: number }[]> {
  const startDay = f.startDate.split('T')[0]
  const endDay   = f.endDate.split('T')[0]

  // Fetch domain counts + daily totals in parallel
  let domainsQ = sb.from('aeo_cache_domains')
    .select('run_day,domain,citation_type,response_count')
    .gte('run_day', startDay).lte('run_day', endDay)
  if (f.platforms && f.platforms.length > 0) domainsQ = domainsQ.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') domainsQ = domainsQ.ilike('prompt_type', f.promptType)

  let dailyQ = sb.from('aeo_cache_daily')
    .select('run_day,platform,total_with_citations')
    .gte('run_day', startDay).lte('run_day', endDay)
    .eq('prompt_type', 'Benchmark')
  if (f.platforms && f.platforms.length > 0) dailyQ = dailyQ.in('platform', f.platforms)

  const [{ data, error }, { data: dailyData }] = await Promise.all([
    domainsQ.limit(10000),
    dailyQ.limit(2000),
  ])

  if (error) { console.error('[getCompetitorCitationTimeseries] cache error:', error); return [] }
  if (!data?.length) return []

  // Build daily total_with_citations denominator (same as Clay's citation rate metric)
  const dailyTotals = new Map<string, number>()
  for (const r of dailyData ?? []) {
    const day = String(r.run_day).substring(0, 10)
    dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + (r.total_with_citations ?? 0))
  }

  const compTotals = new Map<string, number>()
  const domainDay  = new Map<string, Map<string, number>>()

  for (const r of data) {
    const day    = String(r.run_day).substring(0, 10)
    const cnt    = r.response_count ?? 0
    const dom    = (r.domain ?? '').toLowerCase()

    if (r.citation_type === 'Competition' && !dom.includes('clay')) {
      compTotals.set(dom, (compTotals.get(dom) ?? 0) + cnt)
    }

    if (!domainDay.has(dom)) domainDay.set(dom, new Map())
    domainDay.get(dom)!.set(day, (domainDay.get(dom)!.get(day) ?? 0) + cnt)
  }

  const topCompetitors = [...compTotals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([d]) => d)

  const result: { date: string; domain: string; value: number }[] = []

  for (const domain of topCompetitors) {
    const byDay = domainDay.get(domain)
    if (!byDay) continue
    for (const [day, cnt] of byDay) {
      const total = dailyTotals.get(day) ?? 0
      result.push({ date: day, domain, value: total > 0 ? (cnt / total) * 100 : 0 })
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.domain.localeCompare(b.domain))
}

export async function getCitationOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const startDay = f.startDate.split('T')[0]
  const endDay   = f.endDate.split('T')[0]

  // Fast path: query aeo_cache_daily directly
  let q = sb.from('aeo_cache_daily')
    .select('run_day,clay_cited_responses,total_with_citations')
    .gte('run_day', startDay)
    .lte('run_day', endDay)
    .eq('prompt_type', 'Benchmark')
  if (f.platforms && f.platforms.length > 0) q = q.in('platform', f.platforms)

  const { data, error } = await q.limit(2000)
  if (error) { console.error('[getCitationOverallTimeseries] cache error:', error); return [] }
  if (!data?.length) return []

  // Aggregate across platforms per day
  const byDay = new Map<string, { cited: number; withCit: number }>()
  for (const r of data) {
    const day = String(r.run_day).substring(0, 10)
    const cur = byDay.get(day) ?? { cited: 0, withCit: 0 }
    cur.cited  += r.clay_cited_responses ?? 0
    cur.withCit += r.total_with_citations ?? 0
    byDay.set(day, cur)
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { cited, withCit }]) => ({
      date,
      value: withCit > 0 ? (cited / withCit) * 100 : 0,
    }))
}

// Fast cache-only read for the home-page sidebar.
// Queries aeo_cache_domains directly — no top-20 RPC cutoff — so Competition domains
// that are outranked overall by Other/Earned domains still appear correctly.
// Returns top 5 Competition domains + clay.com, sorted by share_pct descending.
export async function getSidebarCitedDomains(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; share_pct: number; is_clay: boolean; citation_type: string | null }[]> {
  // Fetch all domains (for share denominator) and competition domains in parallel
  let allQ = sb
    .from('aeo_cache_domains')
    .select('domain,citation_type,response_count')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) allQ = allQ.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') allQ = allQ.ilike('prompt_type', f.promptType)

  const { data, error } = await allQ.limit(2000)
  if (error || !data?.length) return []

  // Aggregate totals per domain
  const totals = new Map<string, { count: number; citation_type: string | null }>()
  for (const r of data) {
    const d = (r.domain ?? '').toLowerCase()
    if (!d) continue
    const cur = totals.get(d) ?? { count: 0, citation_type: r.citation_type ?? null }
    cur.count += Number(r.response_count ?? 0)
    // Keep the citation_type from the highest-count row (first occurrence wins since we process in response_count order)
    totals.set(d, cur)
  }

  const grandTotal = [...totals.values()].reduce((s, v) => s + v.count, 0)

  const competition = [...totals.entries()]
    .filter(([, v]) => v.citation_type?.toLowerCase() === 'competition')
    .map(([domain, { count, citation_type }]) => ({
      domain,
      share_pct: grandTotal > 0 ? (count / grandTotal) * 100 : 0,
      is_clay: false,
      citation_type,
    }))
    .sort((a, b) => b.share_pct - a.share_pct)
    .slice(0, 5)

  const clayEntry = totals.get('clay.com')
  const clay = {
    domain: 'clay.com',
    share_pct: grandTotal > 0 ? ((clayEntry?.count ?? 0) / grandTotal) * 100 : 0,
    is_clay: true,
    citation_type: 'Owned',
  }

  return [...competition, clay].sort((a, b) => b.share_pct - a.share_pct)
}

export async function getTopCitedDomainsWithURLs(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[]> {
  const startDay = f.startDate.split('T')[0]
  const endDay   = f.endDate.split('T')[0]

  const { data, error } = await sb.rpc('get_top_cited_domains_rpc', {
    p_start_day:      startDay,
    p_end_day:        endDay,
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getTopCitedDomainsWithURLs] RPC error:', error)

  const result: { domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[] =
    (data ?? []).map((r: any) => ({
      domain:         r.domain,
      citation_count: r.citation_count,
      share_pct:      r.share_pct ?? 0,
      is_clay:        r.is_clay ?? false,
      citation_type:  r.citation_type ?? null,
      top_urls:       Array.isArray(r.top_urls) ? r.top_urls : [],
    }))

  // If clay.com not in top 20, inject it from aeo_cache_daily
  if (!result.some(r => r.is_clay)) {
    let dq = sb.from('aeo_cache_daily')
      .select('run_day,clay_cited_responses,total_with_citations')
      .gte('run_day', startDay).lte('run_day', endDay)
      .eq('prompt_type', 'Benchmark')
    if (f.platforms && f.platforms.length > 0) dq = dq.in('platform', f.platforms)
    const { data: daily } = await dq.limit(2000)
    if (daily?.length) {
      const clayCnt = daily.reduce((s: number, r: any) => s + (r.clay_cited_responses ?? 0), 0)
      const existingTotal = result.reduce((s, r) => s + r.citation_count, 0)
      const total = existingTotal + clayCnt
      result.push({
        domain: 'clay.com',
        citation_count: clayCnt,
        share_pct: total > 0 ? (clayCnt / total) * 100 : 0,
        is_clay: true,
        citation_type: 'Clay',
        top_urls: [],
      })
      // Rescale share_pct for other domains relative to the new total
      for (const r of result) {
        if (!r.is_clay) r.share_pct = total > 0 ? (r.citation_count / total) * 100 : r.share_pct
      }
    }
  }

  return result
}

// ── Clay citations grouped by URL type ───────────────────────────────────────

export interface ClayURLItem {
  url: string
  title: string | null
  count: number
  topics: string[]
  platforms: string[]
  citation_type: string | null
}

export interface ClayURLTypeGroup {
  url_type: string
  total: number
  share_pct: number   // % of Clay's total citations
  urls: ClayURLItem[]
}

export async function getClayURLsByType(
  sb: SupabaseClient,
  f: FilterParams
): Promise<ClayURLTypeGroup[]> {
  let query = sb
    .from('citation_domains')
    .select('url, title, url_type, citation_type, platform, domain, responses(topic)')
    .ilike('domain', '%clay%')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const { data, error } = await query.limit(5000)
  if (error) { console.error('getClayURLsByType', error); return [] }
  if (!data?.length) return []

  // Also filter client-side for safety
  const clayRows = data.filter((r: any) => (r.domain ?? '').toLowerCase().includes('clay'))

  if (!clayRows.length) return []
  const grandTotal = clayRows.length

  type URLAcc = { count: number; title: string | null; topics: Set<string>; platforms: Set<string>; citation_type: string | null }
  const typeMap = new Map<string, Map<string, URLAcc>>()

  for (const row of clayRows as any[]) {
    const ut = row.url_type ?? 'Other'
    const url = row.url ?? ''
    if (!url) continue
    const topic: string | null = row.responses?.topic ?? null

    if (!typeMap.has(ut)) typeMap.set(ut, new Map())
    const urlMap = typeMap.get(ut)!
    const cur = urlMap.get(url) ?? { count: 0, title: row.title ?? null, topics: new Set(), platforms: new Set(), citation_type: row.citation_type ?? null }
    cur.count++
    if (topic) cur.topics.add(topic)
    if (row.platform) cur.platforms.add(row.platform)
    urlMap.set(url, cur)
  }

  return Array.from(typeMap.entries())
    .map(([url_type, urlMap]) => {
      const urls: ClayURLItem[] = Array.from(urlMap.entries())
        .map(([url, acc]) => ({
          url,
          title: acc.title,
          count: acc.count,
          topics: Array.from(acc.topics).sort(),
          platforms: Array.from(acc.platforms).sort(),
          citation_type: acc.citation_type,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)

      const total = Array.from(urlMap.values()).reduce((s, u) => s + u.count, 0)
      return { url_type, total, share_pct: grandTotal > 0 ? (total / grandTotal) * 100 : 0, urls }
    })
    .sort((a, b) => b.total - a.total)
}

// ── Top cited domains (enhanced, with url_type + topics per URL) ──────────────

export interface TopDomainURL {
  url: string
  title: string | null
  count: number
  url_type: string | null
  topics: string[]
}

export interface TopDomainRow {
  domain: string
  citation_count: number
  share_pct: number
  is_clay: boolean
  citation_type: string | null
  top_urls: TopDomainURL[]
}

export async function getTopCitedDomainsEnhanced(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TopDomainRow[]> {
  // Fast path: single RPC call reads pre-aggregated aeo_cache_domains +
  // aeo_cache_domain_urls (with url_type). Falls back to live citation_domains
  // scan only when branded/tags filters are active.
  const { data, error } = await sb.rpc('get_top_cited_domains_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) { console.error('[getTopCitedDomainsEnhanced] RPC error:', error); return [] }

  return (data ?? []).map((r: any) => ({
    domain:         r.domain,
    citation_count: Number(r.citation_count),
    share_pct:      Number(r.share_pct ?? 0),
    is_clay:        Boolean(r.is_clay),
    citation_type:  r.citation_type ?? null,
    top_urls: (r.top_urls ?? []).map((u: any) => ({
      url:      u.url,
      title:    u.title ?? null,
      count:    Number(u.count),
      url_type: u.url_type ?? null,
      topics:   [], // topics are loaded lazily via getCitationURLContext on expand
    })),
  }))
}

// ── Citation share broken down by platform ────────────────────────────────────
export async function getCitationShareByPlatform(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ platform: string; rate: number; cited: number; total: number }[]> {
  let q = sb
    .from('aeo_cache_daily')
    .select('platform, clay_cited_responses, total_with_citations')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])

  if (f.platforms && f.platforms.length > 0) q = q.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') q = q.ilike('prompt_type', f.promptType)

  const data = await fetchAllPages(q)
  if (!data.length) return []

  const map = new Map<string, { cited: number; total: number }>()
  for (const row of data) {
    const p = row.platform ?? 'Unknown'
    const cur = map.get(p) ?? { cited: 0, total: 0 }
    cur.cited += Number(row.clay_cited_responses ?? 0)
    cur.total += Number(row.total_with_citations ?? 0)
    map.set(p, cur)
  }

  return Array.from(map.entries())
    .map(([platform, { cited, total }]) => ({
      platform,
      cited,
      total,
      rate: total > 0 ? (cited / total) * 100 : 0,
    }))
    .sort((a, b) => b.rate - a.rate)
}

// ── Per-URL prompt context (lazy loaded when URL row is expanded) ──────────────
export interface URLCitationContext {
  prompt_text: string
  clay_position: number | null
  other_domains: string[]
  platform: string
  run_date: string
}

export async function getCitationURLContext(
  sb: SupabaseClient,
  url: string,
  f: FilterParams,
  limit = 8
): Promise<URLCitationContext[]> {
  // Fetch citation_domain rows for this URL in the period, join responses
  const { data, error } = await sb
    .from('citation_domains')
    .select('response_id, platform, run_date, responses(prompt_id, clay_mention_position, cited_domains)')
    .eq('url', url)
    .gte('run_date', f.startDate.split('T')[0])
    .lt('run_date', cdNextDay(f.endDate.split('T')[0]))
    .limit(limit)

  if (error || !data?.length) return []

  // Collect unique prompt IDs
  const promptIds = [...new Set(
    (data as any[])
      .map((r: any) => r.responses?.prompt_id)
      .filter(Boolean)
  )]

  // Batch in groups of 100 to stay under PostgREST URL length limit
  const promptMap = new Map<string, string>()
  if (promptIds.length > 0) {
    const BATCH = 100
    const allPrompts = (await Promise.all(
      Array.from({ length: Math.ceil(promptIds.length / BATCH) }, (_, i) =>
        sb.from('prompts')
          .select('prompt_id, prompt_text')
          .in('prompt_id', promptIds.slice(i * BATCH, (i + 1) * BATCH))
          .then(({ data: d }) => d ?? [])
      )
    )).flat()
    for (const p of allPrompts) promptMap.set(p.prompt_id, p.prompt_text)
  }

  return (data as any[]).map((row: any) => {
    const resp = row.responses ?? {}
    let domains: string[] = []
    try {
      domains = Array.isArray(resp.cited_domains)
        ? resp.cited_domains
        : JSON.parse(resp.cited_domains ?? '[]')
    } catch { /* ignore */ }

    const otherDomains = domains
      .filter((d: string) => typeof d === 'string' && !d.toLowerCase().includes('clay.com'))
      .slice(0, 5)

    return {
      prompt_text: promptMap.get(resp.prompt_id) ?? '(unknown prompt)',
      clay_position: resp.clay_mention_position ?? null,
      other_domains: otherDomains,
      platform: row.platform ?? '',
      run_date: (row.run_date ?? '').substring(0, 10),
    }
  })
}

// ── Citation rate grouped by prompt topic (timeseries) ────────────────────────
// Returns one row per date × topic with Clay citation rate as the value,
// suitable for rendering as a multi-line chart (one line per topic).
export interface TopicCitationRow {
  date: string
  topic: string
  value: number // Clay citation rate % for that date × topic
}

export async function getCitationRateByTopic(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TopicCitationRow[]> {
  // Fast path: read from aeo_cache_topics which now includes clay_cited per
  // (run_day, platform, prompt_type, topic). Replaces a full responses table
  // scan + client-side JSONB parsing.
  // Note: branded/tags filters are not applied here (those are rare combos
  // and the topic-by-citation chart doesn't expose those filter controls).
  let query = sb
    .from('aeo_cache_topics')
    .select('run_day, topic, total_responses, clay_cited')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
    .not('topic', 'is', null)
    .neq('topic', '__none__')
    .neq('topic', 'Unknown')
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') query = query.ilike('prompt_type', f.promptType)
  if (f.topics && f.topics.length > 0) query = query.in('topic', f.topics)

  const data = await fetchAllPages(query)
  if (!data.length) return []

  // Filter topics with too few total responses across all dates (min 5)
  const topicTotals = new Map<string, number>()
  for (const row of data) {
    const t = row.topic as string
    topicTotals.set(t, (topicTotals.get(t) ?? 0) + Number(row.total_responses))
  }

  return data
    .filter(row => (topicTotals.get(row.topic as string) ?? 0) >= 5)
    .map(row => ({
      date:  String(row.run_day),
      topic: row.topic as string,
      value: Number(row.total_responses) > 0
        ? (Number(row.clay_cited) / Number(row.total_responses)) * 100
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Citation activity timeseries from citation_domains ─────────────────────────
// Uses the citation_domains table (not cited_domains on responses) so it works
// even when cited_domains column is unpopulated.
export async function getCitationActivityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; clayShare: number; total: number }[]> {
  let q = sb
    .from('citation_domains')
    .select('run_date, domain')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms?.length) q = q.in('platform', f.platforms)

  const { data, error } = await (q as any).limit(50000)
  if (error) { console.error('getCitationActivityTimeseries', error); return [] }
  if (!data?.length) return []

  const byDate = new Map<string, { total: number; clay: number }>()
  for (const r of data) {
    const date = (r.run_date ?? '').substring(0, 10)
    if (!date) continue
    const cur = byDate.get(date) ?? { total: 0, clay: 0 }
    cur.total++
    if ((r.domain ?? '').toLowerCase().includes('clay')) cur.clay++
    byDate.set(date, cur)
  }

  return [...byDate.entries()]
    .map(([date, { total, clay }]) => ({
      date,
      total,
      clayShare: total > 0 ? (clay / total) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Citation coverage: % of responses with any citation + avg per cited ────────
export async function getCitationCoverage(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ coveragePct: number; avgPerCited: number }> {
  // Fast path: read from pre-aggregated cache tables instead of scanning responses.
  //   coveragePct   = SUM(total_with_citations) / SUM(total_responses)
  //   avgPerCited   = SUM(aeo_cache_domains.response_count) / SUM(total_with_citations)
  //                   (response_count = COUNT DISTINCT responses per domain, so summing
  //                   across all domains gives total domain-response pairs → avg domains
  //                   cited per cited response)
  let dailyQ = sb
    .from('aeo_cache_daily')
    .select('total_responses, total_with_citations')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) dailyQ = dailyQ.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') dailyQ = dailyQ.ilike('prompt_type', f.promptType)

  let domainsQ = sb
    .from('aeo_cache_domains')
    .select('response_count')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) domainsQ = domainsQ.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') domainsQ = domainsQ.ilike('prompt_type', f.promptType)

  const [dailyData, domainsData] = await Promise.all([
    fetchAllPages(dailyQ),
    fetchAllPages(domainsQ),
  ])

  if (!dailyData.length) return { coveragePct: 0, avgPerCited: 0 }

  const totalResponses   = dailyData.reduce((s, r) => s + Number(r.total_responses),   0)
  const withCitations    = dailyData.reduce((s, r) => s + Number(r.total_with_citations), 0)
  const totalDomainPairs = domainsData.reduce((s, r) => s + Number(r.response_count),  0)

  return {
    coveragePct: totalResponses > 0 ? (withCitations / totalResponses) * 100 : 0,
    avgPerCited: withCitations > 0 ? totalDomainPairs / withCitations : 0,
  }
}
