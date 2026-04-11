// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, CompetitorRow } from './types'

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

/** Get all valid response IDs matching the filter (with pagination). */
async function getValidResponseIds(sb: SupabaseClient, f: FilterParams): Promise<string[]> {
  const rows = await fetchAllPages(applyFilters(sb.from('responses').select('id'), f))
  return rows.map((r: any) => String(r.id))
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
  // Use aeo_cache_competitors: already deduplicated, no 1000-row PostgREST cap issue.
  // Sort by total mention_count DESC so most relevant competitors appear first in the dropdown.
  const data = await fetchAllPages(
    sb.from('aeo_cache_competitors')
      .select('competitor_name, mention_count')
      .not('competitor_name', 'is', null)
  )
  if (!data.length) return ['Clay']

  // Sum mention_count per competitor name across all days/platforms
  const totals = new Map<string, number>()
  for (const r of data) {
    const name = r.competitor_name as string
    totals.set(name, (totals.get(name) ?? 0) + Number(r.mention_count))
  }

  const sorted = Array.from(totals.keys())
    .filter(c => c.toLowerCase() !== 'clay')
    .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))

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
  // Fast path: read from aeo_cache_competitors + aeo_cache_daily.
  // Replaces: full responses scan + hundreds of batched response_competitors requests.
  const applyCache = (q: any, start: string, end: string) => {
    q = q.gte('run_day', start).lte('run_day', end)
    if (f.platforms?.length) q = q.in('platform', f.platforms)
    if (f.promptType && f.promptType !== 'all') q = q.ilike('prompt_type', f.promptType)
    return q
  }
  const curStart  = f.startDate.split('T')[0]
  const curEnd    = f.endDate.split('T')[0]
  const prevStart = (f.prevStartDate || f.startDate).split('T')[0]
  const prevEnd   = (f.prevEndDate   || f.endDate).split('T')[0]

  const [curComp, prevComp, curDaily, prevDaily] = await Promise.all([
    fetchAllPages(applyCache(sb.from('aeo_cache_competitors').select('competitor_name, mention_count'), curStart, curEnd)),
    fetchAllPages(applyCache(sb.from('aeo_cache_competitors').select('competitor_name, mention_count'), prevStart, prevEnd)),
    fetchAllPages(applyCache(sb.from('aeo_cache_daily').select('total_responses'), curStart, curEnd)),
    fetchAllPages(applyCache(sb.from('aeo_cache_daily').select('total_responses'), prevStart, prevEnd)),
  ])

  const totalNow  = curDaily.reduce((s: number, r: any)  => s + Number(r.total_responses), 0)
  const totalPrev = prevDaily.reduce((s: number, r: any) => s + Number(r.total_responses), 0)

  const curCounts  = new Map<string, number>()
  const prevCounts = new Map<string, number>()
  for (const r of curComp)  curCounts.set(r.competitor_name,  (curCounts.get(r.competitor_name)  ?? 0) + Number(r.mention_count))
  for (const r of prevComp) prevCounts.set(r.competitor_name, (prevCounts.get(r.competitor_name) ?? 0) + Number(r.mention_count))

  const allNames = new Set([...curCounts.keys(), ...prevCounts.keys()])
  return Array.from(allNames).map(competitor_name => {
    const cur  = curCounts.get(competitor_name)  ?? 0
    const prev = prevCounts.get(competitor_name) ?? 0
    const current  = totalNow  > 0 ? (cur  / totalNow)  * 100 : 0
    const previous = totalPrev > 0 ? (prev / totalPrev) * 100 : null
    const delta    = previous !== null ? current - previous : null
    const isNew    = (previous === null || previous === 0) && current > 0
    return { competitor_name, current, previous, delta, isNew }
  }).sort((a, b) => (b.delta ?? b.current) - (a.delta ?? a.current))
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
  const [curIds, prevIds] = await Promise.all([
    getValidResponseIds(sb, f),
    getValidResponseIds(sb, { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate }),
  ])
  const [rcData, prevRcData] = await Promise.all([
    fetchCompetitorsByIds(sb, curIds, q => q.eq('competitor_name', competitor)),
    fetchCompetitorsByIds(sb, prevIds, q => q.eq('competitor_name', competitor)),
  ])

  if (!rcData.length) return { visibilityScore: null, mentionCount: 0, avgPosition: null, topTopic: null, topPlatform: null, deltaVisibility: null }

  const platformMap = new Map<string, number>()
  for (const r of rcData) {
    if (r.platform) platformMap.set(r.platform, (platformMap.get(r.platform) ?? 0) + 1)
  }

  // Compute top topic by sampling up to 200 response IDs (2 batches of 100)
  // — enough to determine the dominant topic without full table scan
  let topTopic: string | null = null
  const sampleIds = [...new Set(rcData.map((r: any) => String(r.response_id)))].slice(0, 200)
  const topicResults = (await Promise.all(
    Array.from({ length: Math.ceil(sampleIds.length / 100) }, (_, i) =>
      sb.from('responses')
        .select('topic')
        .in('id', sampleIds.slice(i * 100, (i + 1) * 100))
        .not('topic', 'is', null)
        .then(({ data }) => data ?? [])
    )
  )).flat()
  const topicCounts = new Map<string, number>()
  for (const r of topicResults) {
    if (r.topic) topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1)
  }
  topTopic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const topPlatform = [...platformMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const currentVis = curIds.length ? (rcData.length / curIds.length) * 100 : null
  const prevVis = prevIds.length ? (prevRcData.length / prevIds.length) * 100 : null
  const deltaVisibility = currentVis !== null && prevVis !== null ? currentVis - prevVis : null

  return {
    visibilityScore: currentVis,
    mentionCount: rcData.length,
    avgPosition: null,
    topTopic,
    topPlatform,
    deltaVisibility,
  }
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

export async function getPlatformHeatmap(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ competitor: string; platform: string; visibility_score: number }[]> {
  const [validIds, totalData] = await Promise.all([
    getValidResponseIds(sb, f),
    fetchAllPages(applyFilters(sb.from('responses').select('platform'), f)),
  ])
  const rc = await fetchCompetitorsByIds(sb, validIds)

  const totals = new Map<string, number>()
  for (const r of totalData) {
    totals.set(r.platform, (totals.get(r.platform) ?? 0) + 1)
  }

  const map = new Map<string, number>()
  for (const r of rc) {
    const key = `${r.competitor_name}|||${r.platform}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return Array.from(map.entries()).map(([key, count]) => {
    const [competitor, platform] = key.split('|||')
    return {
      competitor,
      platform,
      visibility_score: totals.get(platform) ? (count / totals.get(platform)!) * 100 : 0,
    }
  })
}

// ── Timeseries ───────────────────────────────────────────────────────────────

export async function getCompetitorVsClayTimeseries(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ date: string; clay: number; competitor: number }[]> {
  // Fast path: read from aeo_cache_competitors + aeo_cache_daily.
  // Replaces: full responses scan + batched response_competitors per-date aggregation.
  const start = f.startDate.split('T')[0]
  const end   = f.endDate.split('T')[0]
  const applyCache = (q: any) => {
    q = q.gte('run_day', start).lte('run_day', end)
    if (f.platforms?.length) q = q.in('platform', f.platforms)
    if (f.promptType && f.promptType !== 'all') q = q.ilike('prompt_type', f.promptType)
    return q
  }

  const [compData, dailyData] = await Promise.all([
    fetchAllPages(applyCache(
      sb.from('aeo_cache_competitors')
        .select('run_day, mention_count')
        .eq('competitor_name', competitor)
    )),
    fetchAllPages(applyCache(
      sb.from('aeo_cache_daily')
        .select('run_day, total_responses, clay_mentioned')
    )),
  ])

  // Aggregate daily totals (sum across platforms/prompt_types)
  const dailyMap = new Map<string, { total: number; clay: number }>()
  for (const r of dailyData) {
    const d = String(r.run_day)
    const cur = dailyMap.get(d) ?? { total: 0, clay: 0 }
    cur.total += Number(r.total_responses)
    cur.clay  += Number(r.clay_mentioned)
    dailyMap.set(d, cur)
  }

  const compMap = new Map<string, number>()
  for (const r of compData) {
    const d = String(r.run_day)
    compMap.set(d, (compMap.get(d) ?? 0) + Number(r.mention_count))
  }

  const allDates = new Set([...dailyMap.keys(), ...compMap.keys()])
  return Array.from(allDates).sort().map(date => {
    const { total, clay } = dailyMap.get(date) ?? { total: 0, clay: 0 }
    const comp = compMap.get(date) ?? 0
    return {
      date,
      clay:       total > 0 ? (clay / total) * 100 : 0,
      competitor: total > 0 ? (comp / total) * 100 : 0,
    }
  })
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
  response_text: string | null
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
    .select('id, prompt_id, platform, run_date, clay_mentioned, clay_mention_snippet, response_text')
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
      response_text: r.response_text ?? null,
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
  const responses = await fetchAllPages(applyFilters(
    sb.from('responses')
      .select('id, prompt_id, platform, run_date, clay_mentioned, clay_mention_snippet, response_text, competitors_mentioned')
      .eq('pmm_use_case', pmmUseCase),
    f
  ))

  if (!responses?.length) return []

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

  const promptMap = new Map<string, { prompt_text: string; total: number; clay: number; comp: number; responses: PMMCompResponseRow[] }>()
  for (const r of responses) {
    const pid = r.prompt_id
    if (!pid) continue
    const cur = promptMap.get(pid) ?? {
      prompt_text: textMap.get(pid) ?? '(unknown prompt)',
      total: 0, clay: 0, comp: 0, responses: [],
    }
    cur.total++
    const clayMentioned2 = (r.clay_mentioned ?? '').toLowerCase() === 'yes'
    if (clayMentioned2) cur.clay++
    const compMentioned = isCompMentioned(r)
    if (compMentioned) cur.comp++
    cur.responses.push({
      id: r.id,
      platform: r.platform ?? '',
      run_date: (r.run_date ?? '').substring(0, 10),
      clay_mentioned: r.clay_mentioned ?? null,
      competitor_mentioned: compMentioned,
      clay_mention_snippet: r.clay_mention_snippet ?? null,
      response_text: r.response_text ?? null,
    })
    promptMap.set(pid, cur)
  }

  return Array.from(promptMap.entries()).map(([prompt_id, { prompt_text, total, clay, comp, responses }]) => ({
    prompt_id,
    prompt_text,
    total_responses: total,
    competitor_visibility: total > 0 ? (comp / total) * 100 : 0,
    clay_visibility: total > 0 ? (clay / total) * 100 : 0,
    delta: total > 0 ? ((comp - clay) / total) * 100 : 0,
    responses: responses.sort((a, b) => b.run_date.localeCompare(a.run_date)),
  })).sort((a, b) => b.competitor_visibility - a.competitor_visibility)
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
