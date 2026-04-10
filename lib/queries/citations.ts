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
  const calc = async (startDate: string, endDate: string): Promise<number | null> => {
    const ff = { ...f, startDate, endDate }
    const validResponses = await fetchAllPages(applyResponseFilters(sb.from('responses').select('id'), ff))
    if (!validResponses.length) return null
    const validIds = validResponses.map((r: any) => String(r.id))
    const BATCH = 500
    const results = await Promise.all(
      Array.from({ length: Math.ceil(validIds.length / BATCH) }, (_, i) =>
        sb.from('citation_domains').select('response_id, domain')
          .in('response_id', validIds.slice(i * BATCH, (i + 1) * BATCH))
          .then(({ data }) => data ?? [])
      )
    )
    const allCitations = results.flat() as any[]
    if (!allCitations.length) return null
    const distinctAny = new Set(allCitations.map((c: any) => String(c.response_id))).size
    const distinctClay = new Set(
      allCitations
        .filter((c: any) => (c.domain ?? '').toLowerCase().includes('clay'))
        .map((c: any) => String(c.response_id))
    ).size
    return distinctAny > 0 ? (distinctClay / distinctAny) * 100 : null
  }

  const [current, previous] = await Promise.all([
    calc(f.startDate, f.endDate),
    f.prevStartDate && f.prevEndDate ? calc(f.prevStartDate, f.prevEndDate) : Promise.resolve(null),
  ])
  return { current, previous }
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
  const count = async (start: string, end: string) => {
    const data = await fetchAllPages(applyResponseFilters(
      sb.from('responses').select('cited_domains'),
      { ...f, startDate: start, endDate: end }
    ))
    if (!data.length) return 0
    return data.filter(r => {
      try {
        const domains = Array.isArray(r.cited_domains) ? r.cited_domains : JSON.parse(r.cited_domains ?? '[]')
        return domains.some((d: string) => typeof d === 'string' && d.includes('clay.com'))
      } catch { return false }
    }).length
  }
  const [current, previous] = await Promise.all([
    count(f.startDate, f.endDate),
    count(f.prevStartDate, f.prevEndDate),
  ])
  return { current, previous }
}

export async function getCompetitorCitationTimeseries(
  sb: SupabaseClient,
  f: FilterParams,
  topN = 5
): Promise<{ date: string; domain: string; value: number }[]> {
  // Step 1: Get filtered response IDs (applies all filters: topic, branded, promptType, platform)
  const responses = await fetchAllPages(applyResponseFilters(
    sb.from('responses').select('id, run_date'),
    f
  ))
  if (!responses.length) return []

  // Build a map of response_id -> date for fast lookup
  const responseIdToDate = new Map<string, string>()
  for (const r of responses) {
    const date = (r.run_date ?? '').substring(0, 10)
    if (r.id && date) responseIdToDate.set(String(r.id), date)
  }

  // Step 2: Fetch citation_domains via response_id IN() batches — avoids run_date type mismatch
  const validIds = [...responseIdToDate.keys()]
  const BATCH = 500
  const citations = (await Promise.all(
    Array.from({ length: Math.ceil(validIds.length / BATCH) }, (_, i) =>
      sb.from('citation_domains')
        .select('domain, response_id, citation_type')
        .in('response_id', validIds.slice(i * BATCH, (i + 1) * BATCH))
        .then(({ data }) => data ?? [])
    )
  )).flat() as any[]
  if (!citations.length) return []

  // Step 3: Compute per-date unique response counts
  // Denominator: unique response_ids with any citation entry per date
  // Numerator: unique response_ids citing each domain per date
  // For competitor ranking, only count citation_type = 'Competition' rows
  const citingByDate = new Map<string, Set<string>>()       // date -> Set<response_id>
  const domainByDate = new Map<string, Set<string>>()       // `${date}|||${domain}` -> Set<response_id>
  const competitorTotals = new Map<string, number>()         // competitor domain -> total unique responses

  for (const c of citations as any[]) {
    const rid = String(c.response_id)
    const date = responseIdToDate.get(rid)
    if (!date) continue                       // skip responses excluded by topic/branded/promptType filters
    const d = (c.domain ?? '').toLowerCase()
    if (!d) continue
    const isClay = d.includes('clay.com')
    const key = isClay ? 'clay.com' : d

    if (!citingByDate.has(date)) citingByDate.set(date, new Set())
    citingByDate.get(date)!.add(rid)

    const dk = `${date}|||${key}`
    if (!domainByDate.has(dk)) domainByDate.set(dk, new Set())
    const wasNew = !domainByDate.get(dk)!.has(rid)
    domainByDate.get(dk)!.add(rid)

    // Only rank non-clay domains that have citation_type = 'Competition'
    if (wasNew && !isClay && c.citation_type === 'Competition') {
      competitorTotals.set(key, (competitorTotals.get(key) ?? 0) + 1)
    }
  }

  // Top N competitor domains (Competition type only) + always include clay.com
  const topNonClay = [...competitorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([d]) => d)
  const topDomains = new Set([...topNonClay, 'clay.com'])

  const result: { date: string; domain: string; value: number }[] = []
  for (const date of [...citingByDate.keys()].sort()) {
    const total = citingByDate.get(date)!.size
    if (total === 0) continue
    for (const domain of topDomains) {
      const count = domainByDate.get(`${date}|||${domain}`)?.size ?? 0
      result.push({ date, domain, value: (count / total) * 100 })
    }
  }
  return result
}

export async function getCitationOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const responses = await fetchAllPages(applyResponseFilters(sb.from('responses').select('id, run_day'), f))
  if (!responses.length) return []

  const responseIdToDate = new Map<string, string>()
  for (const r of responses) {
    const date = String(r.run_day ?? '').substring(0, 10)
    if (date) responseIdToDate.set(String(r.id), date)
  }
  const validIds = [...responseIdToDate.keys()]

  const BATCH = 500
  const allCitations = (await Promise.all(
    Array.from({ length: Math.ceil(validIds.length / BATCH) }, (_, i) =>
      sb.from('citation_domains').select('response_id, domain')
        .in('response_id', validIds.slice(i * BATCH, (i + 1) * BATCH))
        .then(({ data }) => data ?? [])
    )
  )).flat() as any[]

  if (!allCitations.length) return []

  const byDate = new Map<string, { clayCited: Set<string>; total: Set<string> }>()
  for (const c of allCitations) {
    const rid = String(c.response_id)
    const date = responseIdToDate.get(rid)
    if (!date) continue
    if (!byDate.has(date)) byDate.set(date, { clayCited: new Set(), total: new Set() })
    const entry = byDate.get(date)!
    entry.total.add(rid)
    if ((c.domain ?? '').toLowerCase().includes('clay')) entry.clayCited.add(rid)
  }

  return Array.from(byDate.entries())
    .map(([date, { clayCited, total }]) => ({
      date,
      value: total.size > 0 ? (clayCited.size / total.size) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getTopCitedDomainsWithURLs(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[]> {
  // Filter via responses.run_day (not citation_domains.run_date) to avoid timestamp mismatch.
  // citation_domains.run_date may not align with the filter window, but response_id always does.

  // Step 1: get valid response IDs using run_day filter on responses
  const validResponses = await fetchAllPages(applyResponseFilters(sb.from('responses').select('id'), f))
  if (!validResponses.length) return []
  const validIds = validResponses.map((r: any) => String(r.id))

  // Step 2: fetch citation_domains for those response IDs in parallel batches of 500
  const BATCH = 500
  const allCitations = (await Promise.all(
    Array.from({ length: Math.ceil(validIds.length / BATCH) }, (_, i) =>
      sb.from('citation_domains')
        .select('domain, url, title, citation_type, response_id')
        .in('response_id', validIds.slice(i * BATCH, (i + 1) * BATCH))
        .then(({ data }) => data ?? [])
    )
  )).flat() as any[]
  if (!allCitations.length) return []

  // Step 3: aggregate by domain
  const domainMap = new Map<string, {
    count: number; is_clay: boolean; citation_type: string | null
    urls: Map<string, { title: string | null; count: number }>
  }>()
  for (const row of allCitations) {
    const d = (row.domain ?? '').toLowerCase()
    if (!d) continue
    if (!domainMap.has(d)) domainMap.set(d, { count: 0, is_clay: d.includes('clay.com'), citation_type: row.citation_type ?? null, urls: new Map() })
    const entry = domainMap.get(d)!
    entry.count++
    if (row.url) {
      const u = entry.urls.get(row.url) ?? { title: row.title ?? null, count: 0 }
      u.count++
      entry.urls.set(row.url, u)
    }
  }

  const total = allCitations.length
  return Array.from(domainMap.entries())
    .map(([domain, { count, is_clay, citation_type, urls }]) => ({
      domain,
      citation_count: count,
      share_pct: total > 0 ? (count / total) * 100 : 0,
      is_clay,
      citation_type,
      top_urls: Array.from(urls.entries())
        .map(([url, { title, count }]) => ({ url, title, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    }))
    .sort((a, b) => b.citation_count - a.citation_count)
    .slice(0, 20)
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
  // Fetch citation rows and total response count in parallel
  let query = sb
    .from('citation_domains')
    .select('domain, url, title, citation_type, url_type, response_id, responses(topic)')
    .gte('run_date', cdDateStr(f.startDate))
    .lt('run_date', cdNextDay(cdDateStr(f.endDate)))

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const data = await fetchAllPages(query)

  if (!data.length) return []

  // Denominator = unique response_ids that appear in citation_domains (responses with any citation)
  // This matches the Citation Rate KPI denominator
  const allCitedResponseIds = new Set<string>()
  for (const row of data as any[]) {
    if (row.response_id) allCitedResponseIds.add(String(row.response_id))
  }
  const totalResponses = allCitedResponseIds.size || data.length

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
