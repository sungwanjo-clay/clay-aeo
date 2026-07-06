// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, CompetitorRow } from './types'
import { HIDDEN_PMM_USE_CASES } from './types'

// ── helpers ────────────────────────────────────────────────────────────────

function applyFilters(query: any, f: FilterParams): any {
  // Use run_day (DATE) not run_date (TIMESTAMPTZ) for reliable date matching
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

export interface ResponseMeta { id: string; topic: string | null; platform: string | null }

/** Fetch id+topic+platform for all matching responses. Pre-fetch once and share across callers. */
export async function getFilteredResponses(sb: SupabaseClient, f: FilterParams): Promise<ResponseMeta[]> {
  const rows = await fetchAllPages(applyFilters(sb.from('responses').select('id, topic, platform'), f))
  return rows.map((r: any) => ({ id: String(r.id), topic: r.topic ?? null, platform: r.platform ?? null }))
}

/** Get all valid response IDs matching the filter (with pagination). */
async function getValidResponseIds(sb: SupabaseClient, f: FilterParams): Promise<string[]> {
  return (await getFilteredResponses(sb, f)).map(r => r.id)
}

/** Fetch response_competitors for a set of response IDs via batched IN() queries. */
async function fetchCompetitorsByIds(
  sb: SupabaseClient,
  ids: string[],
  extraFilter?: (q: any) => any
): Promise<any[]> {
  if (!ids.length) return []
  // BATCH capped at 100: response_competitors has ~8 rows per response, so 100×8=800 rows/request
  // safely under Supabase's hard 1000-row cap. 500 would silently truncate ~75% of data.
  // NOTE: response_competitors does NOT have a `topic` column — topic lives on responses.
  const BATCH = 100
  return (await Promise.all(
    Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => {
      let q = sb.from('response_competitors')
        .select('competitor_name, response_id, platform, run_date')
        .in('response_id', ids.slice(i * BATCH, (i + 1) * BATCH))
      if (extraFilter) q = extraFilter(q)
      return q.then(({ data }) => data ?? [])
    })
  )).flat()
}

/** Fetch prompt texts for a set of prompt IDs via batched IN() queries.
 *  Avoids PostgREST URL length limits when there are hundreds of IDs. */
async function fetchPromptTexts(sb: SupabaseClient, promptIds: string[]): Promise<Map<string, string>> {
  if (!promptIds.length) return new Map()
  const BATCH = 100
  const all = (await Promise.all(
    Array.from({ length: Math.ceil(promptIds.length / BATCH) }, (_, i) =>
      sb.from('prompts')
        .select('prompt_id, prompt_text')
        .in('prompt_id', promptIds.slice(i * BATCH, (i + 1) * BATCH))
        .then(({ data }) => data ?? [])
    )
  )).flat()
  return new Map(all.map((p: any) => [p.prompt_id, p.prompt_text]))
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

/** Derive a search slug from a competitor name for domain matching.
 *  "Apollo.io" → "apollo", "Clay" → "clay", "HubSpot" → "hubspot" */
function domainSlug(competitor: string): string {
  return competitor.toLowerCase().replace(/\.(?:com|io|co|net|org|ai).*$/, '').replace(/[^a-z0-9]/g, '')
}

// ── list ────────────────────────────────────────────────────────────────────

export async function getCompetitorList(sb: SupabaseClient): Promise<string[]> {
  // Server-side aggregation via RPC: returns the top-N competitor names ranked by
  // total mention_count. Replaces a full-table crawl of aeo_cache_competitors
  // (~321k rows / 300+ paginated round trips, ~40s) with one GROUP BY (~3s).
  const { data, error } = await sb.rpc('get_competitor_list_rpc', { p_limit: 200 })
  if (error) console.error('[getCompetitorList] RPC error:', error)
  if (error || !data?.length) return ['Clay']

  const sorted = (data as { competitor_name: string }[])
    .map(r => r.competitor_name)
    .filter(c => c && c.toLowerCase() !== 'clay')

  return ['Clay', ...sorted]
}

// ── Clay-specific KPIs ──────────────────────────────────────────────────────

export async function getClayKPIs(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{
  visibilityScore: number | null
  deltaVisibility: number | null
  citationRate: number | null
  deltaCitationRate: number | null
  avgPosition: number | null
  mentionCount: number
  topTopic: string | null
  topPlatform: string | null
}> {
  // Single RPC call replaces two parallel paginated fetches (was 10–20 round trips).
  const { data, error } = await sb.rpc('get_clay_kpis_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getClayKPIs] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null

  const visCur  = r?.visibility_current  ?? null
  const visPrev = r?.visibility_previous ?? null
  const citCur  = r?.citation_rate_cur   ?? null
  const citPrev = r?.citation_rate_prev  ?? null

  return {
    visibilityScore:   visCur,
    deltaVisibility:   visCur !== null && visPrev !== null ? visCur - visPrev : null,
    citationRate:      citCur,
    deltaCitationRate: citCur !== null && citPrev !== null ? citCur - citPrev : null,
    avgPosition:       r?.avg_position  ?? null,
    mentionCount:      r?.mention_count ?? 0,
    topTopic:          r?.top_topic     ?? null,
    topPlatform:       r?.top_platform  ?? null,
  }
}

export async function getClayVisibilityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  // Fast path: read from aeo_cache_daily instead of scanning responses
  let q = sb.from('aeo_cache_daily')
    .select('run_day, clay_mentioned, total_responses')
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])
  if (f.platforms?.length) q = q.in('platform', f.platforms)
  if (f.promptType && f.promptType !== 'all') q = q.ilike('prompt_type', f.promptType)

  const data = await fetchAllPages(q)
  if (!data.length) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const r of data) {
    const d = String(r.run_day)
    const cur = map.get(d) ?? { total: 0, mentioned: 0 }
    cur.total     += Number(r.total_responses)
    cur.mentioned += Number(r.clay_mentioned)
    map.set(d, cur)
  }
  return Array.from(map.entries())
    .map(([date, { total, mentioned }]) => ({ date, value: total > 0 ? (mentioned / total) * 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Competitor-specific citation rate ───────────────────────────────────────

export async function getCompetitorCitationRate(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ rate: number | null; count: number; deltaRate: number | null }> {
  const slug = domainSlug(competitor)
  const curStart  = f.startDate.split('T')[0]
  const curEnd    = f.endDate.split('T')[0]
  const prevStart = f.prevStartDate.split('T')[0]
  const prevEnd   = f.prevEndDate.split('T')[0]

  // Use pre-aggregated cache tables — avoids full scan of citation_domains
  // with a leading-% ilike which causes timeouts on large tables.
  function cacheFilter(q: any, start: string, end: string) {
    q = q.gte('run_day', start).lte('run_day', end)
    if (f.platforms?.length) q = q.in('platform', f.platforms)
    if (f.promptType && f.promptType !== 'all') q = q.ilike('prompt_type', f.promptType)
    return q
  }

  const [citCurRows, citPrevRows, dailyCurRows, dailyPrevRows] = await Promise.all([
    fetchAllPages(cacheFilter(
      sb.from('aeo_cache_domains').select('response_count').ilike('domain', `%${slug}%`),
      curStart, curEnd
    )),
    fetchAllPages(cacheFilter(
      sb.from('aeo_cache_domains').select('response_count').ilike('domain', `%${slug}%`),
      prevStart, prevEnd
    )),
    fetchAllPages(cacheFilter(
      sb.from('aeo_cache_daily').select('total_responses'),
      curStart, curEnd
    )),
    fetchAllPages(cacheFilter(
      sb.from('aeo_cache_daily').select('total_responses'),
      prevStart, prevEnd
    )),
  ])

  const curCitations  = citCurRows.reduce((s, r) => s + Number(r.response_count), 0)
  const prevCitations = citPrevRows.reduce((s, r) => s + Number(r.response_count), 0)
  const curTotal      = dailyCurRows.reduce((s, r) => s + Number(r.total_responses), 0)
  const prevTotal     = dailyPrevRows.reduce((s, r) => s + Number(r.total_responses), 0)

  const rate     = curTotal  > 0 ? (curCitations  / curTotal)  * 100 : null
  const prevRate = prevTotal > 0 ? (prevCitations / prevTotal) * 100 : null
  const deltaRate = rate !== null && prevRate !== null ? rate - prevRate : null

  return { rate, count: curCitations, deltaRate }
}

// ── Citation profile (top cited URLs for a domain) ──────────────────────────

export async function getCompetitorCitationProfile(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ url: string; title: string | null; domain: string; count: number; citation_type: string | null }[]> {
  const slug = domainSlug(competitor)

  let query = sb.from('citation_domains')
    .select('url, title, domain, citation_type')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .ilike('domain', `%${slug}%`)

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return []

  // Group by URL
  const urlMap = new Map<string, { title: string | null; domain: string; citation_type: string | null; count: number }>()
  for (const row of data) {
    if (!row.url) continue
    const cur = urlMap.get(row.url) ?? { title: row.title ?? null, domain: row.domain ?? '', citation_type: row.citation_type ?? null, count: 0 }
    cur.count++
    urlMap.set(row.url, cur)
  }

  return Array.from(urlMap.entries())
    .map(([url, { title, domain, citation_type, count }]) => ({ url, title, domain, citation_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
}

// ── Winners & Losers ────────────────────────────────────────────────────────

export async function getWinnersAndLosers(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ competitor_name: string; current: number; previous: number | null; delta: number | null; isNew: boolean }[]> {
  // Server-side aggregation from cache tables via RPC. Replaces a client-side
  // crawl that paginated aeo_cache_competitors twice (cur+prev, ~40 pages).
  // Scoped to top-250 competitors by current mention share (the 23k+ distinct
  // names are mostly LLM one-offs; the UI shows top-5 winners / losers).
  const { data, error } = await sb.rpc('get_winners_losers_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  })
  if (error) { console.error('[getWinnersAndLosers] RPC error:', error); return [] }
  return (data ?? []).map((r: any) => ({
    competitor_name: r.competitor_name,
    current:  Number(r.current),
    previous: r.previous != null ? Number(r.previous) : null,
    delta:    r.delta != null ? Number(r.delta) : null,
    isNew:    !!r.is_new,
  }))
}

// ── PMM topic breakdown ─────────────────────────────────────────────────────

export async function getCompetitorByPMMTopic(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ pmm_use_case: string; visibility_score: number; mention_count: number }[]> {
  // Fetch all valid responses with filter applied
  const allResponses = await fetchAllPages(applyFilters(
    sb.from('responses').select('id, pmm_use_case, clay_mentioned').not('pmm_use_case', 'is', null),
    f
  ))

  // For Clay, compute from responses.clay_mentioned
  if (competitor === 'Clay') {
    const totalsMap = new Map<string, number>()
    const mentionsMap = new Map<string, number>()
    for (const r of allResponses) {
      if (!r.pmm_use_case) continue
      totalsMap.set(r.pmm_use_case, (totalsMap.get(r.pmm_use_case) ?? 0) + 1)
      if ((r.clay_mentioned ?? '').toLowerCase() === 'yes') {
        mentionsMap.set(r.pmm_use_case, (mentionsMap.get(r.pmm_use_case) ?? 0) + 1)
      }
    }
    return Array.from(totalsMap.entries()).map(([pmm_use_case, total]) => {
      const mention_count = mentionsMap.get(pmm_use_case) ?? 0
      return { pmm_use_case, visibility_score: total > 0 ? (mention_count / total) * 100 : 0, mention_count }
    }).sort((a, b) => b.visibility_score - a.visibility_score)
  }

  // For a real competitor, fetch response_competitors via IN() batching
  const validIds = allResponses.map((r: any) => String(r.id))
  const rcData = await fetchCompetitorsByIds(sb, validIds, q => q.eq('competitor_name', competitor))
  const competitorResponseIds = new Set(rcData.map((r: any) => String(r.response_id)))

  if (!allResponses?.length) return []

  const totalsMap = new Map<string, number>()
  const mentionsMap = new Map<string, number>()
  for (const r of allResponses) {
    const uc = r.pmm_use_case
    if (!uc) continue
    totalsMap.set(uc, (totalsMap.get(uc) ?? 0) + 1)
    if (competitorResponseIds.has(String(r.id))) {
      mentionsMap.set(uc, (mentionsMap.get(uc) ?? 0) + 1)
    }
  }

  return Array.from(totalsMap.entries()).map(([pmm_use_case, total]) => {
    const mention_count = mentionsMap.get(pmm_use_case) ?? 0
    return { pmm_use_case, visibility_score: total > 0 ? (mention_count / total) * 100 : 0, mention_count }
  }).sort((a, b) => b.visibility_score - a.visibility_score)
}

// ── Co-cited domains ────────────────────────────────────────────────────────

export async function getCompetitorCoCitedDomains(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ domain: string; count: number; share_pct: number; is_own_domain: boolean }[]> {
  const { data: rcData } = await sb
    .from('response_competitors')
    .select('response_id')
    .eq('competitor_name', competitor)
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

  if (!rcData?.length) return []

  const responseIds = rcData.map(r => r.response_id)

  const { data: responses } = await sb
    .from('responses')
    .select('id, cited_domains')
    .in('id', responseIds.slice(0, 500))

  if (!responses?.length) return []

  const domainCounts = new Map<string, number>()
  let responsesWithCitations = 0

  for (const r of responses) {
    if (!r.cited_domains) continue
    let domains: string[] = []
    try {
      domains = Array.isArray(r.cited_domains) ? r.cited_domains : JSON.parse(r.cited_domains)
    } catch { continue }
    if (!domains.length) continue
    responsesWithCitations++
    for (const d of domains) {
      if (typeof d !== 'string' || !d) continue
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1)
    }
  }

  if (!domainCounts.size) return []

  const slug = domainSlug(competitor)

  return Array.from(domainCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      share_pct: responsesWithCitations > 0 ? (count / responsesWithCitations) * 100 : 0,
      is_own_domain: domain.toLowerCase().includes(slug),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
}

// ── KPIs ────────────────────────────────────────────────────────────────────

export async function getCompetitorKPIs(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ visibilityScore: number | null; mentionCount: number; avgPosition: number | null; topTopic: string | null; topPlatform: string | null; deltaVisibility: number | null }> {
  // Server-side aggregation from the cache tables (aeo_cache_competitors /
  // aeo_cache_daily) — same source as getWinnersAndLosers. Replaces a crawl of
  // ~30k `responses` rows (x2 cur+prev) + batched response_competitors lookups.
  // visibility/mention/top_platform are byte-identical to the old path in the
  // default view; topTopic is dropped (it required a 4.4M-row responses join and
  // was uselessly constant across competitors).
  const { data, error } = await sb.rpc('get_competitor_kpis_rpc', {
    p_competitor:     competitor,
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  })
  if (error) console.error('[getCompetitorKPIs] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null

  const cur  = r?.visibility_current  ?? null
  const prev = r?.visibility_previous ?? null
  return {
    visibilityScore: cur,
    mentionCount:    r?.mention_count != null ? Number(r.mention_count) : 0,
    avgPosition:     null,
    topTopic:        null,
    topPlatform:     r?.top_platform ?? null,
    deltaVisibility: cur !== null && prev !== null ? cur - prev : null,
  }
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

export async function getPlatformHeatmap(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ competitor: string; platform: string; visibility_score: number }[]> {
  // Server-side aggregation from cache tables. Replaces a crawl of all filtered
  // response ids + batched response_competitors lookups (which also silently
  // undercounted, since the unfiltered batches hit PostgREST's 1000-row cap).
  // Scoped to the top-100 competitors by mentions (the UI shows top 50).
  const { data, error } = await sb.rpc('get_platform_heatmap_rpc', {
    p_start_day:   f.startDate.split('T')[0],
    p_end_day:     f.endDate.split('T')[0],
    p_prompt_type: f.promptType || 'all',
    p_platforms:   (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  })
  if (error) { console.error('[getPlatformHeatmap] RPC error:', error); return [] }
  return (data ?? []).map((r: any) => ({
    competitor: r.competitor,
    platform: r.platform,
    visibility_score: Number(r.visibility_score),
  }))
}

// ── Timeseries ───────────────────────────────────────────────────────────────

export async function getCompetitorVsClayTimeseries(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ date: string; clay: number; competitor: number }[]> {
  // Server-side aggregation from cache tables via RPC. Replaces client-side
  // pagination of aeo_cache_competitors + aeo_cache_daily.
  const { data, error } = await sb.rpc('get_competitor_timeseries_rpc', {
    p_competitor:  competitor,
    p_start_day:   f.startDate.split('T')[0],
    p_end_day:     f.endDate.split('T')[0],
    p_prompt_type: f.promptType || 'all',
    p_platforms:   (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  })
  if (error) { console.error('[getCompetitorVsClayTimeseries] RPC error:', error); return [] }
  return (data ?? []).map((r: any) => ({
    date: r.date,
    clay: Number(r.clay),
    competitor: Number(r.competitor),
  }))
}

/**
 * Timeseries for MANY competitors in a single RPC call — one scan of
 * aeo_cache_competitors instead of N concurrent scans. Returns a map of
 * competitor → { date → visibility% }. Used by the competitive chart.
 */
export async function getCompetitorTimeseriesMulti(
  sb: SupabaseClient,
  f: FilterParams,
  competitors: string[]
): Promise<Record<string, Record<string, number>>> {
  if (!competitors.length) return {}
  const { data, error } = await sb.rpc('get_competitor_timeseries_multi_rpc', {
    p_competitors: competitors,
    p_start_day:   f.startDate.split('T')[0],
    p_end_day:     f.endDate.split('T')[0],
    p_prompt_type: f.promptType || 'all',
    p_platforms:   (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  })
  if (error) { console.error('[getCompetitorTimeseriesMulti] RPC error:', error); return {} }
  const map: Record<string, Record<string, number>> = {}
  for (const r of (data ?? []) as any[]) {
    ;(map[r.competitor] ??= {})[r.date] = Number(r.competitor_vis)
  }
  return map
}

// ── Citation profile grouped by type (with response_id linkage) ─────────────

export interface CitationItem {
  url: string
  title: string | null
  domain: string
  count: number
  response_ids: string[]
}

export interface CitationTypeGroup {
  citation_type: string
  total: number
  citations: CitationItem[]
}

export async function getCompetitorCitationsByType(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<CitationTypeGroup[]> {
  const slug = domainSlug(competitor)

  let query = sb.from('citation_domains')
    .select('url, title, domain, citation_type, response_id')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .ilike('domain', `%${slug}%`)

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return []

  // Group by citation_type → url
  const typeMap = new Map<string, Map<string, CitationItem>>()

  for (const row of data) {
    const type = row.citation_type ?? 'Other'
    const url = row.url ?? ''
    if (!url) continue

    if (!typeMap.has(type)) typeMap.set(type, new Map())
    const urlMap = typeMap.get(type)!

    const cur = urlMap.get(url) ?? {
      url, title: row.title ?? null, domain: (row.domain ?? '').toLowerCase(), count: 0, response_ids: [],
    }
    cur.count++
    if (row.response_id) cur.response_ids.push(row.response_id)
    urlMap.set(url, cur)
  }

  return Array.from(typeMap.entries())
    .map(([citation_type, urlMap]) => ({
      citation_type,
      total: Array.from(urlMap.values()).reduce((s, v) => s + v.count, 0),
      citations: Array.from(urlMap.values()).sort((a, b) => b.count - a.count).slice(0, 20),
    }))
    .sort((a, b) => b.total - a.total)
}

// ── Prompts/responses that drove a given citation ────────────────────────────

// ── Flat citation list (no type grouping) ────────────────────────────────────

export interface CitationFlatItem {
  url: string
  title: string | null
  domain: string
  count: number
  citation_type: string
  response_ids: string[]
}

export async function getCompetitorCitationsFlat(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<CitationFlatItem[]> {
  const slug = domainSlug(competitor)

  let query = sb.from('citation_domains')
    .select('url, title, domain, citation_type, response_id')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .ilike('domain', `%${slug}%`)
    .limit(2000)

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return []

  const urlMap = new Map<string, CitationFlatItem>()
  for (const row of data) {
    const url = row.url ?? ''
    if (!url) continue
    const cur = urlMap.get(url) ?? {
      url, title: row.title ?? null, domain: (row.domain ?? '').toLowerCase(),
      count: 0, citation_type: row.citation_type ?? 'Other', response_ids: [],
    }
    cur.count++
    if (row.response_id) cur.response_ids.push(row.response_id)
    urlMap.set(url, cur)
  }

  return Array.from(urlMap.values()).sort((a, b) => b.count - a.count).slice(0, 50)
}

// ── Prompts/responses that drove a given citation ────────────────────────────

export interface CitationResponseRow {
  id: string
  platform: string
  run_date: string
  clay_mentioned: string | null
  clay_mention_snippet: string | null
}

export interface CitationPromptRow {
  prompt_id: string
  prompt_text: string
  responses: CitationResponseRow[]
}

export async function getPromptsForCitation(
  sb: SupabaseClient,
  responseIds: string[]
): Promise<CitationPromptRow[]> {
  if (!responseIds.length) return []

  const { data: responses } = await sb
    .from('responses')
    .select('id, prompt_id, platform, run_date, clay_mentioned, clay_mention_snippet')
    .in('id', responseIds.slice(0, 300))

  if (!responses?.length) return []

  const promptIds = [...new Set(responses.map(r => r.prompt_id).filter(Boolean))]
  if (!promptIds.length) return []

  const textMap = await fetchPromptTexts(sb, promptIds)

  const promptMap = new Map<string, CitationPromptRow>()
  for (const r of responses) {
    const pid = r.prompt_id
    if (!pid) continue
    const cur = promptMap.get(pid) ?? { prompt_id: pid, prompt_text: textMap.get(pid) ?? '(unknown prompt)', responses: [] }
    cur.responses.push({
      id: r.id,
      platform: r.platform ?? '',
      run_date: (r.run_date ?? '').substring(0, 10),
      clay_mentioned: r.clay_mentioned ?? null,
      clay_mention_snippet: r.clay_mention_snippet ?? null,
    })
    promptMap.set(pid, cur)
  }

  return Array.from(promptMap.values()).sort((a, b) => b.responses.length - a.responses.length)
}

// ── PMM topic comparison: competitor vs Clay ──────────────────────────────────

export interface PMMCompRow {
  pmm_use_case: string
  total_responses: number
  competitor_visibility: number
  clay_visibility: number
  delta: number
}

/** Fetch responses once, compute PMM breakdown for all competitors. Avoids N redundant fetches. */
export async function getCompetitorPMMComparisonBatch(
  sb: SupabaseClient,
  f: FilterParams,
  competitors: string[]
): Promise<Record<string, PMMCompRow[]>> {
  if (!competitors.length) return {}

  // Server-side aggregation via RPC, one call per competitor (parallel). Replaces
  // a crawl of ~30k `responses` rows. Clay reads from aeo_cache_pmm (~150ms);
  // competitors do a server-side responses scan with the same normalized-substring
  // match on competitors_mentioned (verified identical to the old client logic).
  const params = {
    p_start_day:   f.startDate.split('T')[0],
    p_end_day:     f.endDate.split('T')[0],
    p_prompt_type: f.promptType || 'all',
    p_platforms:   (f.platforms && f.platforms.length > 0) ? f.platforms : null,
  }
  const entries = await Promise.all(competitors.map(async (competitor) => {
    const { data, error } = await sb.rpc('get_pmm_comparison_rpc', { p_competitor: competitor, ...params })
    if (error) { console.error('[getCompetitorPMMComparisonBatch] RPC error:', error); return [competitor, []] as const }
    const rows: PMMCompRow[] = (data ?? []).filter((r: any) => !HIDDEN_PMM_USE_CASES.has(r.pmm_use_case)).map((r: any) => ({
      pmm_use_case:          r.pmm_use_case,
      total_responses:       Number(r.total_responses),
      competitor_visibility: Number(r.competitor_visibility),
      clay_visibility:       Number(r.clay_visibility),
      delta:                 Number(r.delta),
    }))
    return [competitor, rows] as const
  }))
  return Object.fromEntries(entries)
}

export async function getCompetitorPMMComparison(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<PMMCompRow[]> {
  const isClay = competitor === 'Clay'
  const compSlug = competitor.toLowerCase()

  // Fetch competitors_mentioned alongside pmm_use_case so we don't need a
  // separate join to response_competitors (which can lag behind ingestion)
  const responses = await fetchAllPages(applyFilters(
    sb.from('responses')
      .select('pmm_use_case, clay_mentioned, competitors_mentioned')
      .not('pmm_use_case', 'is', null),
    f
  ))

  if (!responses.length) return []

  function parseCompArr(raw: any): string[] {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string' && raw) { try { return JSON.parse(raw) } catch { return [] } }
    return []
  }

  const topicMap = new Map<string, { total: number; clay: number; comp: number }>()
  for (const r of responses) {
    if (!r.pmm_use_case) continue
    const cur = topicMap.get(r.pmm_use_case) ?? { total: 0, clay: 0, comp: 0 }
    cur.total++
    const clayMentioned = (r.clay_mentioned ?? '').toLowerCase() === 'yes'
    if (clayMentioned) cur.clay++
    const compMentioned = isClay ? clayMentioned : parseCompArr(r.competitors_mentioned)
      .some((c: string) => c.toLowerCase() === compSlug ||
        c.toLowerCase().replace(/[^a-z0-9]/g, '').includes(compSlug.replace(/[^a-z0-9]/g, '')))
    if (compMentioned) cur.comp++
    topicMap.set(r.pmm_use_case, cur)
  }

  return Array.from(topicMap.entries()).map(([pmm_use_case, { total, clay, comp }]) => ({
    pmm_use_case,
    total_responses: total,
    competitor_visibility: total > 0 ? (comp / total) * 100 : 0,
    clay_visibility: total > 0 ? (clay / total) * 100 : 0,
    delta: total > 0 ? ((comp - clay) / total) * 100 : 0,
  })).sort((a, b) => b.competitor_visibility - a.competitor_visibility)
}

// ── PMM prompt drill-down: competitor vs Clay per prompt ─────────────────────

export interface PMMCompResponseRow {
  id: string
  platform: string
  run_date: string
  clay_mentioned: string | null
  competitor_mentioned: boolean
  clay_mention_snippet: string | null
  response_text: string | null
}

export interface PMMCompPromptRow {
  prompt_id: string
  prompt_text: string
  total_responses: number
  competitor_visibility: number
  clay_visibility: number
  delta: number
  responses: PMMCompResponseRow[]
  // How many of the top competitors show up in this prompt's responses, and which.
  // Drives the "Opportunity" sort: contested prompts where Clay is absent rank first.
  top_comp_hits: number
  top_comps_present: string[]
}

export async function getCompetitorPMMPromptDrilldown(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string,
  pmmUseCase: string
): Promise<PMMCompPromptRow[]> {
  const isClay = competitor === 'Clay'

  // Include competitors_mentioned (JSONB array) so we can check per-response without
  // a separate join to response_competitors (which can lag behind ingestion)
  // NOTE: response_text is intentionally NOT selected here. It is the heaviest
  // column (full LLM output) and fetching it for every response made this
  // drill-down take ~20s. The list view only needs counts + snippets; the full
  // text is lazy-loaded per response by id when a row is expanded (see
  // CompPMMComparison → CompResponseRow).
  const responses = await fetchAllPages(applyFilters(
    sb.from('responses')
      .select('id, prompt_id, platform, run_date, clay_mentioned, clay_mention_snippet, competitors_mentioned')
      .eq('pmm_use_case', pmmUseCase),
    f
  ))

  if (!responses?.length) return []

  // Top competitors (the "Top Mentioned Competitors" set) — used to score each
  // prompt by how many big competitors show up. Cheap read from mv_competitor_ranks.
  const { data: topList } = await sb.rpc('get_competitor_list_rpc', { p_limit: 12 })
  const topCompAlpha = ((topList ?? []) as { competitor_name: string }[])
    .map(r => r.competitor_name)
    .filter(c => c && c.toLowerCase() !== 'clay')
    .slice(0, 8)
    .map(name => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]/g, '') }))

  // Helper: check if a response's competitors_mentioned field includes the competitor.
  // Supabase can return JSONB columns as either a parsed array OR a JSON string —
  // handle both. Falls back to false if null/empty.
  const compSlug = competitor.toLowerCase()
  const compSlugAlpha = compSlug.replace(/[^a-z0-9]/g, '')
  function parseCompArr(raw: any): string[] {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string' && raw) { try { return JSON.parse(raw) } catch { return [] } }
    return []
  }
  function isCompMentioned(r: any): boolean {
    if (isClay) return (r.clay_mentioned ?? '').toLowerCase() === 'yes'
    return parseCompArr(r.competitors_mentioned)
      .some((c: string) => {
        const cl = c.toLowerCase()
        return cl === compSlug || cl.replace(/[^a-z0-9]/g, '').includes(compSlugAlpha)
      })
  }

  const promptIds = [...new Set(responses.map(r => r.prompt_id).filter(Boolean))]
  const textMap = await fetchPromptTexts(sb, promptIds)

  const promptMap = new Map<string, { prompt_text: string; total: number; clay: number; comp: number; responses: PMMCompResponseRow[]; topComps: Set<string> }>()
  for (const r of responses) {
    const pid = r.prompt_id
    if (!pid) continue
    const cur = promptMap.get(pid) ?? {
      prompt_text: textMap.get(pid) ?? '(unknown prompt)',
      total: 0, clay: 0, comp: 0, responses: [], topComps: new Set<string>(),
    }
    cur.total++
    const clayMentioned2 = (r.clay_mentioned ?? '').toLowerCase() === 'yes'
    if (clayMentioned2) cur.clay++
    const compMentioned = isCompMentioned(r)
    if (compMentioned) cur.comp++
    // Which of the top competitors appear in this response (normalized match)
    const respComps = parseCompArr(r.competitors_mentioned).map((c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, ''))
    for (const tc of topCompAlpha) {
      if (respComps.some(rc => rc === tc.slug || (tc.slug.length > 2 && rc.includes(tc.slug)))) cur.topComps.add(tc.name)
    }
    cur.responses.push({
      id: r.id,
      platform: r.platform ?? '',
      run_date: (r.run_date ?? '').substring(0, 10),
      clay_mentioned: r.clay_mentioned ?? null,
      competitor_mentioned: compMentioned,
      clay_mention_snippet: r.clay_mention_snippet ?? null,
      response_text: null,  // lazy-loaded by id on expand (see CompResponseRow)
    })
    promptMap.set(pid, cur)
  }

  return Array.from(promptMap.entries()).map(([prompt_id, { prompt_text, total, clay, comp, responses, topComps }]) => ({
    prompt_id,
    prompt_text,
    total_responses: total,
    competitor_visibility: total > 0 ? (comp / total) * 100 : 0,
    clay_visibility: total > 0 ? (clay / total) * 100 : 0,
    delta: total > 0 ? ((comp - clay) / total) * 100 : 0,
    responses: responses.sort((a, b) => b.run_date.localeCompare(a.run_date)),
    top_comp_hits: topComps.size,
    top_comps_present: [...topComps],
  }))
    // "Opportunity" default: most contested prompts (most top competitors present)
    // first, and within those the ones where Clay is least visible — i.e. the gaps.
    .sort((a, b) => (b.top_comp_hits - a.top_comp_hits) || (a.clay_visibility - b.clay_visibility))
}

// ── Claygent tracker ─────────────────────────────────────────────────────────

export async function getClaygentMcpStats(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{
  rate: number | null
  byPlatform: { platform: string; rate: number }[]
  byTopic: { topic: string; rate: number }[]
  snippets: { platform: string; topic: string; snippet: string; prompt_text: string; run_date: string }[]
}> {
  const data = await fetchAllPages(applyFilters(
    sb.from('responses').select('claygent_or_mcp_mentioned, clay_followup_snippet, platform, topic, run_date'),
    f
  ))

  if (!data?.length) return { rate: null, byPlatform: [], byTopic: [], snippets: [] }

  const overall = data.filter((r: any) => (r.claygent_or_mcp_mentioned ?? '').toLowerCase() === 'yes').length
  const rate = (overall / data.length) * 100

  const platformMap = new Map<string, { yes: number; total: number }>()
  const topicMap = new Map<string, { yes: number; total: number }>()

  for (const r of data) {
    const p = r.platform ?? ''
    const t = r.topic ?? 'Unknown'
    const pc = platformMap.get(p) ?? { yes: 0, total: 0 }
    const tc = topicMap.get(t) ?? { yes: 0, total: 0 }
    pc.total++; tc.total++
    if ((r.claygent_or_mcp_mentioned ?? '').toLowerCase() === 'yes') { pc.yes++; tc.yes++ }
    platformMap.set(p, pc)
    topicMap.set(t, tc)
  }

  return {
    rate,
    byPlatform: [...platformMap.entries()].map(([platform, { yes, total }]) => ({
      platform, rate: total > 0 ? (yes / total) * 100 : 0,
    })),
    byTopic: [...topicMap.entries()].map(([topic, { yes, total }]) => ({
      topic, rate: total > 0 ? (yes / total) * 100 : 0,
    })),
    snippets: data
      .filter((r: any) => (r.claygent_or_mcp_mentioned ?? '').toLowerCase() === 'yes' && r.clay_followup_snippet)
      .slice(0, 20)
      .map(r => ({
        platform: r.platform,
        topic: r.topic ?? 'Unknown',
        snippet: r.clay_followup_snippet,
        prompt_text: '',
        run_date: r.run_date?.split('T')[0] ?? '',
      })),
  }
}

// ── Sentiment vs Clay ─────────────────────────────────────────────────────────

export interface SentimentThemeSnippet {
  id: string
  platform: string
  run_date: string
  brand_sentiment: string | null
  brand_sentiment_score: number | null
  theme_sentiment: string         // sentiment for this specific theme occurrence
  prompt_text: string | null      // the prompt that triggered this response
  positioning_vs_competitors: string | null
  clay_mention_snippet: string | null
  response_text: string | null
}

export interface SentimentThemeGroup {
  theme: string
  total: number             // responses that mention this theme
  positive: number
  neutral: number
  negative: number
  positivePct: number
  neutralPct: number
  negativePct: number
  dominantSentiment: string // Positive | Neutral | Negative
  snippets: SentimentThemeSnippet[]
}

export interface SentimentVsClayData {
  coMentionCount: number
  clayPositivePct: number
  clayNeutralPct: number
  clayNegativePct: number
  clayAvgScore: number | null
  themeGroups: SentimentThemeGroup[]
}

export async function getCompetitorSentimentVsClay(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<SentimentVsClayData | null> {
  const isClay = competitor === 'Clay'

  // Pull Clay-mentioned responses using applyFilters (respects promptType + brandedFilter)
  const allData = await fetchAllPages(applyFilters(
    sb.from('responses')
      .select('id, prompt_id, platform, run_date, brand_sentiment, brand_sentiment_score, positioning_vs_competitors, clay_mention_snippet, response_text, themes, clay_mentioned'),
    f
  ))
  const clayData = allData.filter((r: any) => (r.clay_mentioned ?? '').toLowerCase() === 'yes')
  if (!clayData.length) return null

  // Get competitor's response_ids for co-mention filtering (using IN() batching)
  let compResponseIds: Set<string> | null = null
  if (!isClay) {
    const validIds = allData.map((r: any) => String(r.id))
    const rcData = await fetchCompetitorsByIds(sb, validIds, q => q.eq('competitor_name', competitor))
    if (!rcData.length) return null
    compResponseIds = new Set(rcData.map((r: any) => String(r.response_id)))
  }

  const data = clayData
  // For competitor view, filter to co-mentioned responses only
  const relevant = isClay ? data : data.filter((r: any) => compResponseIds!.has(String(r.id)))
  if (!relevant.length) return null

  // Resolve prompt texts (batched to avoid PostgREST URL length limit)
  const promptIds = [...new Set(relevant.map(r => r.prompt_id).filter(Boolean))]
  const promptTextMap = await fetchPromptTexts(sb, promptIds)

  // Overall sentiment aggregates
  const pos = relevant.filter(r => r.brand_sentiment === 'Positive').length
  const neu = relevant.filter(r => r.brand_sentiment === 'Neutral').length
  const neg = relevant.filter(r => r.brand_sentiment === 'Negative').length
  const scores = relevant.map(r => r.brand_sentiment_score).filter((s): s is number => s != null)
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  // Build theme groups: theme → { pos, neu, neg, snippets[] }
  // Deduplicate snippets by prompt_id within each theme — same prompt won't appear twice in one theme
  type ThemeAcc = { pos: number; neu: number; neg: number; snippets: SentimentThemeSnippet[]; seenPromptIds: Set<string> }
  const themeMap = new Map<string, ThemeAcc>()

  for (const r of relevant) {
    const themes: { theme: string; sentiment: string; snippet?: string }[] =
      Array.isArray(r.themes) ? r.themes : []

    for (const t of themes) {
      if (!t.theme) continue
      const acc = themeMap.get(t.theme) ?? { pos: 0, neu: 0, neg: 0, snippets: [], seenPromptIds: new Set() }

      const ts = t.sentiment ?? ''
      if (ts === 'Positive') acc.pos++
      else if (ts === 'Negative') acc.neg++
      else acc.neu++

      // Deduplicate by prompt_id: only add one snippet per unique prompt per theme
      const promptKey = r.prompt_id ?? r.id
      if (acc.snippets.length < 30 && !acc.seenPromptIds.has(promptKey)) {
        acc.seenPromptIds.add(promptKey)
        acc.snippets.push({
          id: r.id,
          platform: r.platform ?? '',
          run_date: (r.run_date ?? '').substring(0, 10),
          brand_sentiment: r.brand_sentiment ?? null,
          brand_sentiment_score: r.brand_sentiment_score ?? null,
          theme_sentiment: ts,
          prompt_text: promptTextMap.get(r.prompt_id) ?? null,
          positioning_vs_competitors: r.positioning_vs_competitors ?? null,
          clay_mention_snippet: r.clay_mention_snippet ?? null,
          response_text: r.response_text ?? null,
        })
      }
      themeMap.set(t.theme, acc)
    }
  }

  // Convert to sorted groups — sort: negative-dominant first, then by total count
  const themeGroups: SentimentThemeGroup[] = Array.from(themeMap.entries())
    .map(([theme, acc]) => {
      const total = acc.pos + acc.neu + acc.neg
      const posP = total > 0 ? (acc.pos / total) * 100 : 0
      const neuP = total > 0 ? (acc.neu / total) * 100 : 0
      const negP = total > 0 ? (acc.neg / total) * 100 : 0
      const dominantSentiment = acc.neg >= acc.pos && acc.neg >= acc.neu ? 'Negative'
        : acc.pos >= acc.neg && acc.pos >= acc.neu ? 'Positive'
        : 'Neutral'
      return {
        theme, total, positive: acc.pos, neutral: acc.neu, negative: acc.neg,
        positivePct: posP, neutralPct: neuP, negativePct: negP,
        dominantSentiment,
        snippets: acc.snippets.sort((a, b) => {
          // For negative-dominant themes, show negative snippets first
          if (dominantSentiment === 'Negative') {
            if (a.theme_sentiment === 'Negative' && b.theme_sentiment !== 'Negative') return -1
            if (b.theme_sentiment === 'Negative' && a.theme_sentiment !== 'Negative') return 1
          }
          return b.run_date.localeCompare(a.run_date)
        }),
      }
    })
    .sort((a, b) => {
      // Negative-dominant themes first, then by total
      if (a.dominantSentiment === 'Negative' && b.dominantSentiment !== 'Negative') return -1
      if (b.dominantSentiment === 'Negative' && a.dominantSentiment !== 'Negative') return 1
      return b.total - a.total
    })

  return {
    coMentionCount: relevant.length,
    clayPositivePct: relevant.length > 0 ? (pos / relevant.length) * 100 : 0,
    clayNeutralPct: relevant.length > 0 ? (neu / relevant.length) * 100 : 0,
    clayNegativePct: relevant.length > 0 ? (neg / relevant.length) * 100 : 0,
    clayAvgScore: avgScore,
    themeGroups,
  }
}
