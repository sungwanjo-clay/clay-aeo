// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, CitationDomainRow } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyResponseFilters(query: any, f: FilterParams): any {
  query = query.gte('run_date', f.startDate).lte('run_date', f.endDate)
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.topics && f.topics.length > 0) query = query.in('topic', f.topics)
  if (f.promptType === 'benchmark') {
    query = query.eq('prompt_type', 'benchmark')
  } else if (f.promptType === 'campaign') {
    query = query.not('prompt_type', 'is', null).neq('prompt_type', 'benchmark')
  }
  if (f.tags && f.tags !== 'all') query = query.eq('tags', f.tags)
  return query
}

export async function getCitationShare(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number | null; previous: number | null }> {
  // Citation rate: clay-cited responses / responses-with-any-citations
  const calc = async (start: string, end: string) => {
    const { data, error } = await applyResponseFilters(
      sb.from('responses').select('cited_domains'),
      { ...f, startDate: start, endDate: end }
    ).limit(10000)
    if (error) { console.error('getCitationShare', error); return null }
    if (!data?.length) return null
    let withClayCited = 0
    let withAnyCitations = 0
    for (const r of data) {
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

  const [current, previous] = await Promise.all([
    calc(f.startDate, f.endDate),
    calc(f.prevStartDate, f.prevEndDate),
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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

  if (f.platforms.length > 0) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data) return []

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
  const { data } = await applyResponseFilters(
    sb.from('responses').select('run_date, platform, cited_domains'),
    f
  ).limit(50000)
  if (!data) return []

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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
  if (f.platforms.length > 0) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return []

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
    const { data, error } = await applyResponseFilters(
      sb.from('responses').select('cited_domains'),
      { ...f, startDate: start, endDate: end }
    ).limit(10000)
    if (error) { console.error('getCitationCount', error); return 0 }
    if (!data?.length) return 0
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
  // Use responses table so all filters (topic, branded, promptType) apply consistently.
  // Citation rate per domain per day = responses_citing_domain / responses_with_any_citations
  const { data } = await applyResponseFilters(
    sb.from('responses').select('run_date, cited_domains'),
    f
  ).limit(50000)
  if (!data?.length) return []

  const citingByDate = new Map<string, number>()         // date -> responses with any citations
  const domainByDate = new Map<string, number>()         // `${date}|||${domain}` -> count
  const domainTotals = new Map<string, number>()         // domain -> total across all dates

  for (const r of data) {
    const date = (r.run_date ?? '').substring(0, 10)
    if (!date) continue
    const domains: string[] = Array.isArray(r.cited_domains) ? r.cited_domains : []
    if (domains.length === 0) continue

    citingByDate.set(date, (citingByDate.get(date) ?? 0) + 1)

    for (const rawDomain of domains) {
      const d = String(rawDomain).toLowerCase()
      const key = d.includes('clay') ? 'clay.com' : d
      const dk = `${date}|||${key}`
      domainByDate.set(dk, (domainByDate.get(dk) ?? 0) + 1)
      domainTotals.set(key, (domainTotals.get(key) ?? 0) + 1)
    }
  }

  // Top N non-clay domains by total citations + always include clay.com
  const topNonClay = [...domainTotals.entries()]
    .filter(([d]) => !d.includes('clay'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([d]) => d)
  const topDomains = new Set([...topNonClay, 'clay.com'])

  const result: { date: string; domain: string; value: number }[] = []
  for (const date of [...citingByDate.keys()].sort()) {
    const total = citingByDate.get(date) ?? 0
    if (total === 0) continue
    for (const domain of topDomains) {
      const count = domainByDate.get(`${date}|||${domain}`) ?? 0
      result.push({ date, domain, value: (count / total) * 100 })
    }
  }
  return result
}

export async function getCitationOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const { data, error } = await applyResponseFilters(
    sb.from('responses').select('run_date, cited_domains'),
    f
  ).limit(10000)
  if (error) { console.error('getCitationOverallTimeseries', error); return [] }
  if (!data) return []

  // Citation rate per day: clay-cited / responses-with-any-citations
  const map = new Map<string, { clayCited: number; withCitations: number }>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    try {
      const domains = Array.isArray(row.cited_domains) ? row.cited_domains : JSON.parse(row.cited_domains ?? '[]')
      if (domains.length > 0) {
        const cur = map.get(date) ?? { clayCited: 0, withCitations: 0 }
        cur.withCitations++
        if (domains.some((d: string) => typeof d === 'string' && d.includes('clay.com'))) cur.clayCited++
        map.set(date, cur)
      }
    } catch { /* ignore */ }
  }

  return Array.from(map.entries())
    .map(([date, { clayCited, withCitations }]) => ({ date, value: withCitations > 0 ? (clayCited / withCitations) * 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getTopCitedDomainsWithURLs(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[]> {
  let query = sb
    .from('citation_domains')
    .select('domain, url, title, citation_type')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)

  const { data } = await query
  if (!data?.length) return []

  const total = data.length
  const domainMap = new Map<string, { count: number; is_clay: boolean; typeCounts: Map<string, number>; urls: Map<string, { title: string | null; count: number }> }>()

  for (const row of data) {
    const d = (row.domain ?? '').toLowerCase()
    if (!d) continue
    const cur = domainMap.get(d) ?? { count: 0, is_clay: d.includes('clay.com'), typeCounts: new Map(), urls: new Map() }
    cur.count++
    if (row.citation_type) cur.typeCounts.set(row.citation_type, (cur.typeCounts.get(row.citation_type) ?? 0) + 1)
    if (row.url) {
      const u = cur.urls.get(row.url) ?? { title: row.title ?? null, count: 0 }
      u.count++
      cur.urls.set(row.url, u)
    }
    domainMap.set(d, cur)
  }

  return Array.from(domainMap.entries())
    .map(([domain, { count, is_clay, typeCounts, urls }]) => {
      // Pick most frequent citation_type for this domain
      const citation_type = typeCounts.size > 0
        ? [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : (is_clay ? 'Clay' : null)
      return {
        domain,
        citation_count: count,
        share_pct: total > 0 ? (count / total) * 100 : 0,
        is_clay,
        citation_type,
        top_urls: Array.from(urls.entries())
          .map(([url, { title, count }]) => ({ url, title, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      }
    })
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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

  if (f.platforms?.length) query = query.in('platform', f.platforms)

  const [{ data, error }, totalRes] = await Promise.all([
    query.limit(5000),
    applyResponseFilters(sb.from('responses').select('id'), f).limit(20000),
  ])

  if (error) { console.error('getTopCitedDomainsEnhanced', error); return [] }
  if (!data?.length) return []

  // Use total responses as denominator so share_pct matches the Citation Share KPI
  const totalResponses = totalRes.data?.length ?? data.length

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
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)

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
  const { data, error } = await applyResponseFilters(
    sb.from('responses').select('cited_domains'),
    f
  ).limit(10000)
  if (error || !data?.length) return { coveragePct: 0, avgPerCited: 0 }

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
