// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, CompetitorRow } from './types'

// ── helpers ────────────────────────────────────────────────────────────────

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
  const { data } = await sb
    .from('response_competitors')
    .select('competitor_name')
    .not('competitor_name', 'is', null)
  if (!data) return ['Clay']
  const list = [...new Set(data.map(r => r.competitor_name))].sort() as string[]
  return ['Clay', ...list.filter(c => c.toLowerCase() !== 'clay')]
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
  const [cur, prev] = await Promise.all([
    fetchAllPages(applyFilters(sb.from('responses').select('clay_mentioned, clay_mention_position, topic, platform, cited_domains'), f)),
    fetchAllPages(applyFilters(sb.from('responses').select('clay_mentioned, cited_domains'), { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate })),
  ])

  // Visibility
  const mentionedCur = cur.filter(r => r.clay_mentioned === 'Yes')
  const mentionedPrev = prev.filter(r => r.clay_mentioned === 'Yes')
  const visScore = cur.length > 0 ? (mentionedCur.length / cur.length) * 100 : null
  const visPrev = prev.length > 0 ? (mentionedPrev.length / prev.length) * 100 : null
  const deltaVis = visScore !== null && visPrev !== null ? visScore - visPrev : null

  // Avg position
  const positions = cur.filter(r => r.clay_mention_position != null).map(r => r.clay_mention_position as number)
  const avgPosition = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null

  // Top topic / platform
  const topicMap = new Map<string, number>()
  const platformMap = new Map<string, number>()
  for (const r of mentionedCur) {
    if (r.topic) topicMap.set(r.topic, (topicMap.get(r.topic) ?? 0) + 1)
    if (r.platform) platformMap.set(r.platform, (platformMap.get(r.platform) ?? 0) + 1)
  }
  const topTopic = [...topicMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topPlatform = [...platformMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Citation rate — same formula as getCitationShare: clay-cited / responses-with-any-citations
  // Uses responses.cited_domains so it matches the KPI on every other page
  const calcCitRate = (rows: any[]) => {
    let withClayCited = 0
    let withAnyCitations = 0
    for (const r of rows) {
      try {
        const domains = Array.isArray(r.cited_domains) ? r.cited_domains : JSON.parse(r.cited_domains ?? '[]')
        if (domains.length > 0) {
          withAnyCitations++
          if (domains.some((d: string) => typeof d === 'string' && d.includes('clay.com'))) withClayCited++
        }
      } catch { /* ignore */ }
    }
    return withAnyCitations > 0 ? (withClayCited / withAnyCitations) * 100 : null
  }
  const citRate = calcCitRate(cur)
  const citRatePrev = calcCitRate(prev)
  const deltaCitRate = citRate !== null && citRatePrev !== null ? citRate - citRatePrev : null

  return {
    visibilityScore: visScore,
    deltaVisibility: deltaVis,
    citationRate: citRate,
    deltaCitationRate: deltaCitRate,
    avgPosition,
    mentionCount: mentionedCur.length,
    topTopic,
    topPlatform,
  }
}

export async function getClayVisibilityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const data = await fetchAllPages(applyFilters(
    sb.from('responses').select('run_date, clay_mentioned'),
    f
  ))
  if (!data.length) return []

  const map = new Map<string, { total: number; yes: number }>()
  for (const r of data) {
    const d = (r.run_date ?? '').substring(0, 10)
    if (!d) continue
    const cur = map.get(d) ?? { total: 0, yes: 0 }
    cur.total++
    if (r.clay_mentioned === 'Yes') cur.yes++
    map.set(d, cur)
  }
  return Array.from(map.entries())
    .map(([date, { total, yes }]) => ({ date, value: total > 0 ? (yes / total) * 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Competitor-specific citation rate ───────────────────────────────────────

export async function getCompetitorCitationRate(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ rate: number | null; count: number; deltaRate: number | null }> {
  const slug = domainSlug(competitor)

  const [citCur, citPrev, totalCur, totalPrev] = await Promise.all([
    sb.from('citation_domains').select('domain')
      .gte('run_date', f.startDate).lte('run_date', f.endDate)
      .ilike('domain', `%${slug}%`),
    sb.from('citation_domains').select('domain')
      .gte('run_date', f.prevStartDate).lte('run_date', f.prevEndDate)
      .ilike('domain', `%${slug}%`),
    sb.from('responses').select('id', { count: 'exact', head: true })
      .gte('run_date', f.startDate).lte('run_date', f.endDate),
    sb.from('responses').select('id', { count: 'exact', head: true })
      .gte('run_date', f.prevStartDate).lte('run_date', f.prevEndDate),
  ])

  const curCitations = citCur.data?.length ?? 0
  const prevCitations = citPrev.data?.length ?? 0
  const curTotal = totalCur.count ?? 0
  const prevTotal = totalPrev.count ?? 0

  const rate = curTotal > 0 ? (curCitations / curTotal) * 100 : null
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
  const [rcCurData, rcPrevData, totalCur, totalPrev] = await Promise.all([
    fetchAllPages(sb.from('response_competitors')
      .select('competitor_name, response_id')
      .gte('run_date', f.startDate).lte('run_date', f.endDate)),
    fetchAllPages(sb.from('response_competitors')
      .select('competitor_name, response_id')
      .gte('run_date', f.prevStartDate).lte('run_date', f.prevEndDate)),
    fetchAllPages(applyFilters(sb.from('responses').select('id'), f)),
    fetchAllPages(applyFilters(sb.from('responses').select('id'), { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate })),
  ])

  const totalNow = totalCur.length
  const totalPrevCount = totalPrev.length

  const curCounts = new Map<string, Set<string>>()
  for (const r of rcCurData) {
    if (!curCounts.has(r.competitor_name)) curCounts.set(r.competitor_name, new Set())
    curCounts.get(r.competitor_name)!.add(r.response_id)
  }

  const prevCounts = new Map<string, Set<string>>()
  for (const r of rcPrevData) {
    if (!prevCounts.has(r.competitor_name)) prevCounts.set(r.competitor_name, new Set())
    prevCounts.get(r.competitor_name)!.add(r.response_id)
  }

  const allNames = new Set([...curCounts.keys(), ...prevCounts.keys()])

  return Array.from(allNames).map(competitor_name => {
    const curIds = curCounts.get(competitor_name)?.size ?? 0
    const prevIds = prevCounts.get(competitor_name)?.size ?? 0
    const current = totalNow > 0 ? (curIds / totalNow) * 100 : 0
    const previous = totalPrevCount > 0 ? (prevIds / totalPrevCount) * 100 : null
    const delta = previous !== null ? current - previous : null
    const isNew = (previous === null || previous === 0) && current > 0
    return { competitor_name, current, previous, delta, isNew }
  }).sort((a, b) => (b.delta ?? b.current) - (a.delta ?? a.current))
}

// ── PMM topic breakdown ─────────────────────────────────────────────────────

export async function getCompetitorByPMMTopic(
  sb: SupabaseClient,
  f: FilterParams,
  competitor: string
): Promise<{ pmm_use_case: string; visibility_score: number; mention_count: number }[]> {
  // For Clay, compute from responses.clay_mentioned = 'Yes'
  if (competitor === 'Clay') {
    const { data } = await sb.from('responses')
      .select('pmm_use_case, clay_mentioned')
      .gte('run_date', f.startDate).lte('run_date', f.endDate)
      .not('pmm_use_case', 'is', null)
    if (!data?.length) return []

    const totalsMap = new Map<string, number>()
    const mentionsMap = new Map<string, number>()
    for (const r of data) {
      if (!r.pmm_use_case) continue
      totalsMap.set(r.pmm_use_case, (totalsMap.get(r.pmm_use_case) ?? 0) + 1)
      if (r.clay_mentioned === 'Yes') {
        mentionsMap.set(r.pmm_use_case, (mentionsMap.get(r.pmm_use_case) ?? 0) + 1)
      }
    }
    return Array.from(totalsMap.entries()).map(([pmm_use_case, total]) => {
      const mention_count = mentionsMap.get(pmm_use_case) ?? 0
      return { pmm_use_case, visibility_score: total > 0 ? (mention_count / total) * 100 : 0, mention_count }
    }).sort((a, b) => b.visibility_score - a.visibility_score)
  }

  // For a real competitor, look at response_competitors
  const { data: rcData } = await sb
    .from('response_competitors')
    .select('response_id')
    .eq('competitor_name', competitor)
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

  const competitorResponseIds = new Set((rcData ?? []).map(r => r.response_id))

  const { data: allResponses } = await sb
    .from('responses')
    .select('id, pmm_use_case')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .not('pmm_use_case', 'is', null)

  if (!allResponses?.length) return []

  const totalsMap = new Map<string, number>()
  const mentionsMap = new Map<string, number>()
  for (const r of allResponses) {
    const uc = r.pmm_use_case
    if (!uc) continue
    totalsMap.set(uc, (totalsMap.get(uc) ?? 0) + 1)
    if (competitorResponseIds.has(r.id)) {
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
  const [rcData, total, prevRcData, prevTotal] = await Promise.all([
    fetchAllPages(sb.from('response_competitors')
      .select('response_id, platform, topic')
      .eq('competitor_name', competitor)
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)),
    fetchAllPages(sb.from('responses').select('id').gte('run_date', f.startDate).lte('run_date', f.endDate)),
    fetchAllPages(sb.from('response_competitors')
      .select('response_id')
      .eq('competitor_name', competitor)
      .gte('run_date', f.prevStartDate)
      .lte('run_date', f.prevEndDate)),
    fetchAllPages(sb.from('responses').select('id').gte('run_date', f.prevStartDate).lte('run_date', f.prevEndDate)),
  ])

  if (!rcData.length) return { visibilityScore: null, mentionCount: 0, avgPosition: null, topTopic: null, topPlatform: null, deltaVisibility: null }

  const topicMap = new Map<string, number>()
  const platformMap = new Map<string, number>()
  for (const r of rcData) {
    if (r.topic) topicMap.set(r.topic, (topicMap.get(r.topic) ?? 0) + 1)
    if (r.platform) platformMap.set(r.platform, (platformMap.get(r.platform) ?? 0) + 1)
  }

  const topTopic = [...topicMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topPlatform = [...platformMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const currentVis = total.length ? (rcData.length / total.length) * 100 : null
  const prevVis = prevTotal.length ? (prevRcData.length / prevTotal.length) * 100 : null
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
  const [rc, totalData] = await Promise.all([
    fetchAllPages(sb.from('response_competitors')
      .select('competitor_name, platform')
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)),
    fetchAllPages(sb.from('responses')
      .select('platform')
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)),
  ])

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
  const [rcData, clayData] = await Promise.all([
    fetchAllPages(sb.from('response_competitors')
      .select('run_date, response_id')
      .eq('competitor_name', competitor)
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)),
    fetchAllPages(sb.from('responses')
      .select('run_date, clay_mentioned')
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)),
  ])

  const compByDate = new Map<string, number>()
  for (const r of rcData) {
    const d = r.run_date?.split('T')[0] ?? ''
    compByDate.set(d, (compByDate.get(d) ?? 0) + 1)
  }

  const clayByDate = new Map<string, { total: number; yes: number }>()
  for (const r of clayData) {
    const d = r.run_date?.split('T')[0] ?? ''
    const cur = clayByDate.get(d) ?? { total: 0, yes: 0 }
    cur.total++
    if (r.clay_mentioned === 'Yes') cur.yes++
    clayByDate.set(d, cur)
  }

  const allDates = new Set([...compByDate.keys(), ...clayByDate.keys()])
  return Array.from(allDates).sort().map(date => {
    const totalForDate = clayByDate.get(date)?.total ?? 0
    const clayScore = totalForDate > 0 ? ((clayByDate.get(date)?.yes ?? 0) / totalForDate) * 100 : 0
    const compScore = totalForDate > 0 ? ((compByDate.get(date) ?? 0) / totalForDate) * 100 : 0
    return { date, clay: clayScore, competitor: compScore }
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

  const { data: prompts } = await sb
    .from('prompts')
    .select('prompt_id, prompt_text')
    .in('prompt_id', promptIds)

  const textMap = new Map((prompts ?? []).map(p => [p.prompt_id, p.prompt_text]))

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

  const responses = await fetchAllPages(sb
    .from('responses')
    .select('id, pmm_use_case, clay_mentioned')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .not('pmm_use_case', 'is', null))

  if (!responses.length) return []

  let compIds = new Set<string>()

  if (!isClay) {
    const rcData = await fetchAllPages(sb
      .from('response_competitors')
      .select('response_id')
      .eq('competitor_name', competitor)
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate))
    compIds = new Set(rcData.map(r => r.response_id))
  }

  const topicMap = new Map<string, { total: number; clay: number; comp: number }>()
  for (const r of responses) {
    if (!r.pmm_use_case) continue
    const cur = topicMap.get(r.pmm_use_case) ?? { total: 0, clay: 0, comp: 0 }
    cur.total++
    if (r.clay_mentioned === 'Yes') cur.clay++
    if (isClay ? r.clay_mentioned === 'Yes' : compIds.has(r.id)) cur.comp++
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

  const { data: responses } = await sb
    .from('responses')
    .select('id, prompt_id, platform, run_date, clay_mentioned, clay_mention_snippet, response_text')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .eq('pmm_use_case', pmmUseCase)

  if (!responses?.length) return []

  let compIds = new Set<string>()
  if (!isClay) {
    const { data: rcData } = await sb
      .from('response_competitors')
      .select('response_id')
      .eq('competitor_name', competitor)
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)
    compIds = new Set((rcData ?? []).map(r => r.response_id))
  }

  const promptIds = [...new Set(responses.map(r => r.prompt_id).filter(Boolean))]
  const { data: prompts } = await sb
    .from('prompts')
    .select('prompt_id, prompt_text')
    .in('prompt_id', promptIds)
  const textMap = new Map((prompts ?? []).map(p => [p.prompt_id, p.prompt_text]))

  const promptMap = new Map<string, { prompt_text: string; total: number; clay: number; comp: number; responses: PMMCompResponseRow[] }>()
  for (const r of responses) {
    const pid = r.prompt_id
    if (!pid) continue
    const cur = promptMap.get(pid) ?? {
      prompt_text: textMap.get(pid) ?? '(unknown prompt)',
      total: 0, clay: 0, comp: 0, responses: [],
    }
    cur.total++
    if (r.clay_mentioned === 'Yes') cur.clay++
    const compMentioned = isClay ? r.clay_mentioned === 'Yes' : compIds.has(r.id)
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
  const { data } = await sb
    .from('responses')
    .select('claygent_or_mcp_mentioned, clay_followup_snippet, platform, topic, run_date')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

  if (!data?.length) return { rate: null, byPlatform: [], byTopic: [], snippets: [] }

  const overall = data.filter(r => r.claygent_or_mcp_mentioned === 'Yes').length
  const rate = (overall / data.length) * 100

  const platformMap = new Map<string, { yes: number; total: number }>()
  const topicMap = new Map<string, { yes: number; total: number }>()

  for (const r of data) {
    const p = r.platform ?? ''
    const t = r.topic ?? 'Unknown'
    const pc = platformMap.get(p) ?? { yes: 0, total: 0 }
    const tc = topicMap.get(t) ?? { yes: 0, total: 0 }
    pc.total++; tc.total++
    if (r.claygent_or_mcp_mentioned === 'Yes') { pc.yes++; tc.yes++ }
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
      .filter(r => r.claygent_or_mcp_mentioned === 'Yes' && r.clay_followup_snippet)
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

  // Get competitor's response_ids for co-mention filtering
  let compResponseIds: Set<string> | null = null
  if (!isClay) {
    const { data: rcData } = await sb
      .from('response_competitors')
      .select('response_id')
      .eq('competitor_name', competitor)
      .gte('run_date', f.startDate)
      .lte('run_date', f.endDate)
    if (!rcData?.length) return null
    compResponseIds = new Set(rcData.map(r => r.response_id))
  }

  // Pull Clay-mentioned responses with sentiment + themes fields
  let query = sb
    .from('responses')
    .select('id, prompt_id, platform, run_date, brand_sentiment, brand_sentiment_score, positioning_vs_competitors, clay_mention_snippet, response_text, themes')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .eq('clay_mentioned', 'Yes')

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return null

  // For competitor view, filter to co-mentioned responses only
  const relevant = isClay ? data : data.filter(r => compResponseIds!.has(r.id))
  if (!relevant.length) return null

  // Resolve prompt texts
  const promptIds = [...new Set(relevant.map(r => r.prompt_id).filter(Boolean))]
  const promptTextMap = new Map<string, string>()
  if (promptIds.length) {
    const { data: prompts } = await sb
      .from('prompts')
      .select('prompt_id, prompt_text')
      .in('prompt_id', promptIds)
    for (const p of prompts ?? []) promptTextMap.set(p.prompt_id, p.prompt_text)
  }

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
