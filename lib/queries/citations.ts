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
  let query = sb
    .from('citation_domains')
    .select('citation_type')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))
  if (f.platforms.length > 0) query = query.in('platform', f.platforms)

  const data = await fetchAllPages(query)
  if (!data.length) return []

  const map = new Map<string, number>()
  for (const row of data) {
    const t = row.citation_type ?? 'Other'
    map.set(t, (map.get(t) ?? 0) + 1)
  }
  const total = data.length
  return Array.from(map.entries()).map(([type, count]) => ({
    type, count, pct: (count / total) * 100,
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
  // Single RPC call replaces paginated responses + hundreds of batched citation_domains requests.
  const { data, error } = await sb.rpc('get_competitor_citation_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
    p_top_n:          topN,
  })
  if (error) console.error('[getCompetitorCitationTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    date:   String(r.date),
    domain: r.domain,
    value:  r.value ?? 0,
  }))
}

export async function getCitationOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const { data, error } = await sb.rpc('get_citation_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getCitationOverallTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({ date: String(r.date), value: r.value ?? 0 }))
}

export async function getTopCitedDomainsWithURLs(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[]> {
  // Single RPC call replaces paginated responses + hundreds of batched citation_domains requests.
  // top_urls is returned as JSONB [{url, title, count}] from the RPC.
  const { data, error } = await sb.rpc('get_top_cited_domains_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getTopCitedDomainsWithURLs] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    domain:         r.domain,
    citation_count: r.citation_count,
    share_pct:      r.share_pct ?? 0,
    is_clay:        r.is_clay ?? false,
    citation_type:  r.citation_type ?? null,
    top_urls:       Array.isArray(r.top_urls) ? r.top_urls : [],
  }))
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
  // Fetch citation rows and the canonical denominator (total_with_citations from cache) in parallel.
  // Using aeo_cache_daily.total_with_citations as denominator ensures "Response %" matches
  // the Citation Rate KPI and the line chart — all three use the same denominator.
  let query = sb
    .from('citation_domains')
    .select('domain, url, title, citation_type, url_type, response_id, responses(topic)')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  let cacheQuery = sb
    .from('aeo_cache_daily')
    .select('total_with_citations')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms?.length) cacheQuery = cacheQuery.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') cacheQuery = cacheQuery.ilike('prompt_type', f.promptType)

  const [data, cacheRes] = await Promise.all([
    fetchAllPages(query),
    fetchAllPages(cacheQuery),
  ])

  if (!data.length) return []

  // Denominator: sum of total_with_citations from cache (same source as Citation Rate KPI and line chart)
  const cacheDenominator = (cacheRes as any[]).reduce((s, r) => s + Number(r.total_with_citations ?? 0), 0)
  // Fallback to COUNT DISTINCT if cache is empty
  const allCitedResponseIds = new Set<string>()
  for (const row of data as any[]) {
    if (row.response_id) allCitedResponseIds.add(String(row.response_id))
  }
  const totalResponses = cacheDenominator || allCitedResponseIds.size || data.length

  type DomainAcc = {
    responseIds: Set<string>; is_clay: boolean; typeCounts: Map<string, number>
    urls: Map<string, { title: string | null; count: number; url_type: string | null; topics: Set<string> }>
  }
  const domainMap = new Map<string, DomainAcc>()

  for (const row of data as any[]) {
    const d = (row.domain ?? '').toLowerCase()
    if (!d) continue
    const topic: string | null = row.responses?.topic ?? null
    const cur = domainMap.get(d) ?? { responseIds: new Set(), is_clay: d.includes('clay.com'), typeCounts: new Map(), urls: new Map() }
    if (row.response_id) cur.responseIds.add(row.response_id)
    if (row.citation_type) cur.typeCounts.set(row.citation_type, (cur.typeCounts.get(row.citation_type) ?? 0) + 1)
    if (row.url) {
      const u = cur.urls.get(row.url) ?? { title: row.title ?? null, count: 0, url_type: row.url_type ?? null, topics: new Set<string>() }
      u.count++
      if (topic) u.topics.add(topic)
      cur.urls.set(row.url, u)
    }
    domainMap.set(d, cur)
  }

  return Array.from(domainMap.entries())
    .map(([domain, { responseIds, is_clay, typeCounts, urls }]) => {
      const citation_count = responseIds.size || [...urls.values()].reduce((s, u) => s + u.count, 0)
      const citation_type = typeCounts.size > 0
        ? [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : (is_clay ? 'Clay' : null)
      return {
        domain,
        citation_count,
        share_pct: totalResponses > 0 ? (citation_count / totalResponses) * 100 : 0,
        is_clay,
        citation_type,
        top_urls: Array.from(urls.entries())
          .map(([url, u]) => ({
            url, title: u.title, count: u.count, url_type: u.url_type,
            topics: Array.from(u.topics).sort(),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 15),
      }
    })
    .sort((a, b) => b.citation_count - a.citation_count)
    .slice(0, 30)
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

  const promptMap = new Map<string, string>()
  if (promptIds.length > 0) {
    const { data: prompts } = await sb
      .from('prompts')
      .select('prompt_id, prompt_text')
      .in('prompt_id', promptIds)
    for (const p of prompts ?? []) {
      promptMap.set(p.prompt_id, p.prompt_text)
    }
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
  const data = await fetchAllPages(applyResponseFilters(
    sb.from('responses').select('run_date, topic, cited_domains'),
    f
  ).not('topic', 'is', null))

  if (!data.length) return []

  // Accumulate per date × topic
  const map = new Map<string, { total: number; withClayCit: number }>()

  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    const topic: string = row.topic ?? 'Unknown'
    if (!date || !topic) continue
    const key = `${date}|||${topic}`
    const cur = map.get(key) ?? { total: 0, withClayCit: 0 }
    cur.total++
    try {
      const domains: string[] = Array.isArray(row.cited_domains)
        ? row.cited_domains
        : JSON.parse(row.cited_domains ?? '[]')
      if (domains.some((d: string) => typeof d === 'string' && d.toLowerCase().includes('clay.com'))) {
        cur.withClayCit++
      }
    } catch { /* ignore parse errors */ }
    map.set(key, cur)
  }

  // Filter topics with too few total responses (across all dates)
  const topicTotals = new Map<string, number>()
  for (const [key, { total }] of map) {
    const topic = key.split('|||')[1]
    topicTotals.set(topic, (topicTotals.get(topic) ?? 0) + total)
  }

  return Array.from(map.entries())
    .filter(([key]) => (topicTotals.get(key.split('|||')[1]) ?? 0) >= 5)
    .map(([key, { total, withClayCit }]) => {
      const [date, topic] = key.split('|||')
      return {
        date,
        topic,
        value: total > 0 ? (withClayCit / total) * 100 : 0,
      }
    })
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
  const data = await fetchAllPages(applyResponseFilters(
    sb.from('responses').select('cited_domains'),
    f
  ))
  if (!data.length) return { coveragePct: 0, avgPerCited: 0 }

  let withCitations = 0
  let totalDomains = 0

  for (const r of data) {
    const domains = Array.isArray(r.cited_domains) ? r.cited_domains : []
    if (domains.length > 0) {
      withCitations++
      totalDomains += domains.length
    }
  }

  return {
    coveragePct: (withCitations / data.length) * 100,
    avgPerCited: withCitations > 0 ? totalDomains / withCitations : 0,
  }
}
