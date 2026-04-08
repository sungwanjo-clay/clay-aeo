// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, TimeseriesRow, CompetitorRow } from './types'

function applyFilters(query: any, f: FilterParams): any {
  query = query.gte('run_day', f.startDate.split('T')[0]).lte('run_day', f.endDate.split('T')[0])
  if (f.platforms && f.platforms.length > 0) query = query.in('platform', f.platforms)
  if (f.topics && f.topics.length > 0) query = query.in('topic', f.topics)
  if (f.brandedFilter === 'branded') {
    // ilike for case-insensitive exact match — works regardless of 'Branded'/'branded' casing in DB
    query = query.ilike('branded_or_non_branded', 'branded')
  } else if (f.brandedFilter === 'non-branded') {
    // everything that is NOT an exact 'branded' match (covers 'Non Branded', 'Non-Branded', etc.)
    query = query.not('branded_or_non_branded', 'ilike', 'branded')
  }
  if (f.promptType === 'benchmark') {
    query = query.filter('prompt_type', 'ilike', 'benchmark')
  } else if (f.promptType === 'campaign') {
    query = query.not('prompt_type', 'is', null).filter('prompt_type', 'not.ilike', 'benchmark')
  }
  if (f.tags && f.tags !== 'all') {
    query = query.eq('tags', f.tags)
  }
  return query
}

// Server-side count query — returns 0 rows, just the count header.
// Completely bypasses Supabase's max_rows limit.
async function countResponses(sb: SupabaseClient, f: FilterParams, extraFilter?: (q: any) => any): Promise<number> {
  let q = applyFilters(sb.from('responses').select('*', { count: 'exact', head: true }), f)
  if (extraFilter) q = extraFilter(q)
  const { count } = await q
  return count ?? 0
}

export async function getVisibilityScore(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number | null; previous: number | null; total: number }> {
  const prevF = { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate }

  const [mentionedCur, totalCur, mentionedPrev, totalPrev, promptCount] = await Promise.all([
    countResponses(sb, f, q => q.eq('clay_mentioned', 'Yes')),
    countResponses(sb, f),
    countResponses(sb, prevF, q => q.eq('clay_mentioned', 'Yes')),
    countResponses(sb, prevF),
    (() => {
      let q = sb.from('prompts').select('*', { count: 'exact', head: true }).eq('is_active', true)
      if (f.promptType === 'benchmark') q = q.filter('prompt_type', 'ilike', 'benchmark')
      else if (f.promptType === 'campaign') q = q.not('prompt_type', 'is', null).filter('prompt_type', 'not.ilike', 'benchmark')
      if (f.brandedFilter === 'branded') q = q.ilike('branded_or_non_branded', 'branded')
      else if (f.brandedFilter === 'non-branded') q = q.not('branded_or_non_branded', 'ilike', 'branded')
      if (f.tags && f.tags !== 'all') q = q.eq('tags', f.tags)
      return q.then((r: any) => r.count ?? 0)
    })(),
  ])

  const current = totalCur > 0 ? (mentionedCur / totalCur) * 100 : null
  const previous = totalPrev > 0 ? (mentionedPrev / totalPrev) * 100 : null
  return { current, previous, total: promptCount }
}

export async function getClayOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, clay_mentioned'),
    f
  )
  if (!data) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    const cur = map.get(date) ?? { total: 0, mentioned: 0 }
    cur.total++
    if (row.clay_mentioned === 'Yes') cur.mentioned++
    map.set(date, cur)
  }

  return Array.from(map.entries()).map(([date, { total, mentioned }]) => ({
    date,
    value: total > 0 ? (mentioned / total) * 100 : 0,
  })).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getFullLeaderboard(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CompetitorRow[]> {
  const [clayScore, competitors] = await Promise.all([
    getVisibilityScore(sb, f),
    getCompetitorLeaderboard(sb, f),
  ])

  const entries = [...competitors]

  if (clayScore.current != null) {
    const clayDelta = clayScore.current != null && clayScore.previous != null
      ? clayScore.current - clayScore.previous : null
    entries.push({
      competitor_name: 'Clay',
      mention_count: 0,
      sov_pct: clayScore.current,
      visibility_score: clayScore.current,
      delta: clayDelta,
      isOwned: true,
    })
  }

  return entries.sort((a, b) => (b.visibility_score ?? 0) - (a.visibility_score ?? 0))
}

export async function getDistinctPromptTypes(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from('responses').select('prompt_type').not('prompt_type', 'is', null).limit(5000)
  if (!data) return []
  // Normalize whitespace and case before deduplicating
  const normalized = data.map(r => (r.prompt_type ?? '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(normalized)].sort() as string[]
}

export async function getVisibilityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, platform, clay_mentioned'),
    f
  )
  if (!data) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    const key = `${date}|||${row.platform}`
    const cur = map.get(key) ?? { total: 0, mentioned: 0 }
    cur.total++
    if (row.clay_mentioned === 'Yes') cur.mentioned++
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { total, mentioned }]) => {
    const [date, platform] = key.split('|||')
    return { date, platform, value: total > 0 ? (mentioned / total) * 100 : 0 }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getCompetitorVisibilityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; competitor: string; value: number }[]> {
  // Get total responses per day for denominator (also used to enforce platform/topic filters)
  const { data: responses } = await applyFilters(
    sb.from('responses').select('id, run_date'),
    f
  ).limit(20000)
  if (!responses?.length) return []

  const totalByDate = new Map<string, number>()
  const responseIdToDate = new Map<string, string>()
  for (const r of responses) {
    const date = (r.run_date ?? '').substring(0, 10)
    if (!date) continue
    totalByDate.set(date, (totalByDate.get(date) ?? 0) + 1)
    responseIdToDate.set(r.id, date)
  }

  // Fetch competitor rows by date range directly — avoids huge in() with thousands of IDs
  const { data: rc } = await sb
    .from('response_competitors')
    .select('response_id, competitor_name')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .limit(20000)

  if (!rc?.length) return []

  // Filter to only responses that passed the platform/topic/etc filters
  const validIds = new Set(responses.map((r: any) => r.id))

  const map = new Map<string, number>()
  for (const row of rc) {
    if (!validIds.has(row.response_id)) continue
    const date = responseIdToDate.get(row.response_id) ?? ''
    if (!date) continue
    const key = `${date}|||${row.competitor_name}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return Array.from(map.entries()).map(([key, count]) => {
    const [date, competitor] = key.split('|||')
    const total = totalByDate.get(date) ?? 0
    return { date, competitor, value: total > 0 ? (count / total) * 100 : 0 }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getCompetitorLeaderboard(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CompetitorRow[]> {
  const { data, error } = await (sb as any).rpc('get_competitor_leaderboard', {
    p_start_day:   f.startDate.split('T')[0],
    p_end_day:     f.endDate.split('T')[0],
    p_prompt_type: f.promptType === 'benchmark' ? 'benchmark'
                 : f.promptType === 'campaign'  ? null : null,
    p_branded:     f.brandedFilter !== 'all' ? f.brandedFilter : null,
    p_platforms:   f.platforms?.length ? f.platforms : null,
    p_tags:        f.tags !== 'all' ? f.tags : null,
    p_prev_start:  f.prevStartDate?.split('T')[0] ?? null,
    p_prev_end:    f.prevEndDate?.split('T')[0] ?? null,
  })
  if (error) { console.error('getCompetitorLeaderboard RPC', error); return [] }
  return (data ?? []).map((r: any) => ({
    competitor_name: r.competitor_name,
    mention_count:   Number(r.mention_count),
    sov_pct:         Number(r.visibility_score),
    visibility_score: Number(r.visibility_score),
    delta: r.prev_score != null ? Number(r.visibility_score) - Number(r.prev_score) : null,
  }))
}

export async function getVisibilityByPMM(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, pmm_use_case, clay_mentioned'),
    f
  )
  if (!data) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const row of data) {
    if (!row.pmm_use_case) continue
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    const key = `${date}|||${row.pmm_use_case}`
    const cur = map.get(key) ?? { total: 0, mentioned: 0 }
    cur.total++
    if (row.clay_mentioned === 'Yes') cur.mentioned++
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { total, mentioned }]) => {
    const [date, pmm_use_case] = key.split('|||')
    return { date, pmm_use_case, value: total > 0 ? (mentioned / total) * 100 : 0 }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getPMMTable(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ pmm_use_case: string; visibility_score: number; delta: number | null; citation_share: number | null; avg_position: number | null; total_responses: number; timeseries: { date: string; value: number }[] }[]> {
  const [cur, prev] = await Promise.all([
    applyFilters(sb.from('responses').select('run_date, pmm_use_case, clay_mentioned, cited_domains, clay_mention_position'), f).then((r: any) => r.data ?? []),
    applyFilters(sb.from('responses').select('pmm_use_case, clay_mentioned'), { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate }).then((r: any) => r.data ?? []),
  ])

  const curMap = new Map<string, { mentioned: number; total: number; cited: number; positions: number[]; byDate: Map<string, { m: number; t: number }> }>()
  for (const row of cur) {
    if (!row.pmm_use_case) continue
    const date = (row.run_date ?? '').substring(0, 10)
    if (!curMap.has(row.pmm_use_case)) curMap.set(row.pmm_use_case, { mentioned: 0, total: 0, cited: 0, positions: [], byDate: new Map() })
    const entry = curMap.get(row.pmm_use_case)!
    entry.total++
    if (row.clay_mentioned === 'Yes') entry.mentioned++
    if (row.clay_mention_position != null) entry.positions.push(row.clay_mention_position)
    try {
      const domains = Array.isArray(row.cited_domains) ? row.cited_domains : JSON.parse(row.cited_domains ?? '[]')
      if (domains.some((d: string) => typeof d === 'string' && d.toLowerCase().includes('clay.com'))) entry.cited++
    } catch { /* ignore */ }
    const d = entry.byDate.get(date) ?? { m: 0, t: 0 }
    d.t++
    if (row.clay_mentioned === 'Yes') d.m++
    entry.byDate.set(date, d)
  }

  const prevMap = new Map<string, { mentioned: number; total: number }>()
  for (const row of prev) {
    if (!row.pmm_use_case) continue
    const entry = prevMap.get(row.pmm_use_case) ?? { mentioned: 0, total: 0 }
    entry.total++
    if (row.clay_mentioned === 'Yes') entry.mentioned++
    prevMap.set(row.pmm_use_case, entry)
  }

  return Array.from(curMap.entries()).map(([pmm_use_case, { mentioned, total, cited, positions, byDate }]) => {
    const curScore = total > 0 ? (mentioned / total) * 100 : 0
    const prev = prevMap.get(pmm_use_case)
    const prevScore = prev && prev.total > 0 ? (prev.mentioned / prev.total) * 100 : null
    const timeseries = Array.from(byDate.entries())
      .map(([date, { m, t }]) => ({ date, value: t > 0 ? (m / t) * 100 : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return {
      pmm_use_case,
      visibility_score: curScore,
      delta: prevScore !== null ? curScore - prevScore : null,
      citation_share: total > 0 ? (cited / total) * 100 : null,
      avg_position: positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
      total_responses: total,
      timeseries,
    }
  }).sort((a, b) => b.visibility_score - a.visibility_score)
}

export async function getVisibilityByTopic(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, topic, clay_mentioned'),
    f
  )
  if (!data) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    const key = `${date}|||${row.topic ?? 'Unknown'}`
    const cur = map.get(key) ?? { total: 0, mentioned: 0 }
    cur.total++
    if (row.clay_mentioned === 'Yes') cur.mentioned++
    map.set(key, cur)
  }

  return Array.from(map.entries()).map(([key, { total, mentioned }]) => {
    const [date, topic] = key.split('|||')
    return { date, topic, value: total > 0 ? (mentioned / total) * 100 : 0 }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getShareOfVoice(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CompetitorRow[]> {
  const { data: responses } = await applyFilters(sb.from('responses').select('id'), f).limit(20000)
  if (!responses?.length) return []
  const idSet = new Set(responses.map((r: any) => r.id))

  const { data } = await sb
    .from('response_competitors')
    .select('competitor_name, response_id')
    .gte('run_date', f.startDate)
    .lte('run_date', f.endDate)
    .limit(20000)

  if (!data?.length) return []

  const counts = new Map<string, number>()
  let total = 0
  for (const row of data) {
    if (!idSet.has(row.response_id)) continue
    const name = row.competitor_name ?? ''
    counts.set(name, (counts.get(name) ?? 0) + 1)
    total++
  }

  return Array.from(counts.entries())
    .map(([competitor_name, mention_count]) => ({
      competitor_name,
      mention_count,
      sov_pct: total > 0 ? (mention_count / total) * 100 : 0,
    }))
    .sort((a, b) => b.mention_count - a.mention_count)
}

export async function getMentionShare(
  sb: SupabaseClient,
  f: FilterParams
): Promise<number | null> {
  const sov = await getShareOfVoice(sb, f)
  const clay = sov.find(r => r.competitor_name.toLowerCase() === 'clay')
  return clay?.sov_pct ?? null
}

export async function getAvgPosition(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number | null; previous: number | null }> {
  const fetch = async (start: string, end: string) => {
    let q = sb
      .from('responses')
      .select('clay_mention_position')
      .gte('run_date', start)
      .lte('run_date', end)
      .eq('clay_mentioned', 'Yes')
      .not('clay_mention_position', 'is', null)

    if (f.platforms && f.platforms.length > 0) q = q.in('platform', f.platforms)
    if (f.topics && f.topics.length > 0) q = q.in('topic', f.topics)
    if (f.brandedFilter !== 'all') {
      const val = f.brandedFilter === 'branded' ? 'Branded' : 'Non-Branded'
      q = q.eq('branded_or_non_branded', val)
    }
    if (f.promptType === 'benchmark') q = q.filter('prompt_type', 'ilike', 'benchmark')
    else if (f.promptType === 'campaign') q = q.not('prompt_type', 'is', null).filter('prompt_type', 'not.ilike', 'benchmark')
    if (f.tags && f.tags !== 'all') q = q.eq('tags', f.tags)

    const { data } = await q
    if (!data?.length) return null
    const sum = data.reduce((acc, r) => acc + (r.clay_mention_position ?? 0), 0)
    return sum / data.length
  }

  const [current, previous] = await Promise.all([
    fetch(f.startDate, f.endDate),
    fetch(f.prevStartDate, f.prevEndDate),
  ])
  return { current, previous }
}

export async function getDistinctTopics(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from('responses').select('topic').not('topic', 'is', null)
  if (!data) return []
  return [...new Set(data.map(r => r.topic).filter(Boolean))].sort() as string[]
}

export async function getDistinctBrandedValues(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from('responses').select('branded_or_non_branded').not('branded_or_non_branded', 'is', null).limit(5000)
  if (!data) return []
  return [...new Set(data.map(r => (r.branded_or_non_branded ?? '').trim()).filter(Boolean))].sort() as string[]
}

export async function getDistinctTags(sb: SupabaseClient, startDate?: string, endDate?: string): Promise<string[]> {
  let query = sb.from('responses').select('tags').not('tags', 'is', null).limit(5000)
  if (startDate) query = query.gte('run_date', startDate)
  if (endDate) query = query.lte('run_date', endDate)
  const { data } = await query
  if (!data) return []
  return [...new Set(data.map(r => (r.tags ?? '').trim()).filter(Boolean))].sort() as string[]
}

export async function getClaygentCount(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number; previous: number }> {
  const [current, previous] = await Promise.all([
    countResponses(sb, f, q => q.eq('claygent_or_mcp_mentioned', 'Yes')),
    countResponses(sb, { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate }, q => q.eq('claygent_or_mcp_mentioned', 'Yes')),
  ])
  return { current, previous }
}

export async function getClaygentTimeseriesByPlatform(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; platform: string; count: number }[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, platform, claygent_or_mcp_mentioned'),
    f
  ).limit(10000)
  if (!data) return []

  const map = new Map<string, number>()
  const allDates = new Set<string>()
  const allPlatforms = new Set<string>()

  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    const platform = row.platform ?? 'Unknown'
    if (!date) continue
    allDates.add(date)
    allPlatforms.add(platform)
    if (row.claygent_or_mcp_mentioned === 'Yes') {
      const key = `${date}|||${platform}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }

  const results: { date: string; platform: string; count: number }[] = []
  for (const date of allDates) {
    for (const platform of allPlatforms) {
      results.push({ date, platform, count: map.get(`${date}|||${platform}`) ?? 0 })
    }
  }
  return results.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getClaygentTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; count: number }[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, claygent_or_mcp_mentioned'),
    f
  )
  if (!data) return []

  const map = new Map<string, number>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    if (row.claygent_or_mcp_mentioned === 'Yes') {
      map.set(date, (map.get(date) ?? 0) + 1)
    }
  }

  // Ensure dates with zero mentions still appear
  const allDates = [...new Set(data.map(r => (r.run_date ?? '').substring(0, 10)).filter(Boolean))]
  return allDates
    .map(date => ({ date, count: map.get(date) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface MentionResponseRow {
  id: string
  platform: string
  run_date: string
  snippet: string | null
  response_text: string | null
  brand_sentiment: string | null
  other_cited_domains: string[]
}

export interface MentionPromptRow {
  prompt_id: string
  prompt_text: string
  topic: string | null
  count: number
  responses: MentionResponseRow[]
}

export interface MentionTopicRow {
  topic: string
  count: number
  prompts: MentionPromptRow[]
}

/**
 * Generic breakdown for any Yes/No column.
 * Returns topics → prompts → response rows where column = 'Yes'.
 */
export async function getMentionBreakdown(
  sb: SupabaseClient,
  f: FilterParams,
  column: 'claygent_or_mcp_mentioned' | 'clay_recommended_followup'
): Promise<MentionTopicRow[]> {
  const snippetCol = column === 'clay_recommended_followup'
    ? 'clay_followup_snippet'
    : 'clay_mention_snippet'

  const { data } = await applyFilters(
    sb.from('responses').select(
      `id, prompt_id, platform, run_date, topic, cited_domains, response_text, brand_sentiment, ${column}, ${snippetCol}`
    ),
    f
  ).eq(column, 'Yes')

  if (!data?.length) return []

  // Collect unique prompt IDs to fetch prompt_text
  const promptIds = [...new Set(data.map((r: any) => r.prompt_id).filter(Boolean))]
  const { data: prompts } = await sb
    .from('prompts')
    .select('prompt_id, prompt_text')
    .in('prompt_id', promptIds)
  const textMap = new Map((prompts ?? []).map((p: any) => [p.prompt_id, p.prompt_text]))

  // Group by topic → prompt
  const topicMap = new Map<string, Map<string, {
    prompt_text: string; topic: string | null; rows: MentionResponseRow[]
  }>>()

  for (const row of data) {
    const topic = row.topic ?? 'Uncategorized'
    const promptId = row.prompt_id ?? ''

    if (!topicMap.has(topic)) topicMap.set(topic, new Map())
    const promptMap = topicMap.get(topic)!

    if (!promptMap.has(promptId)) {
      promptMap.set(promptId, {
        prompt_text: textMap.get(promptId) ?? '(unknown prompt)',
        topic,
        rows: [],
      })
    }

    // Parse cited domains
    let domains: string[] = []
    try {
      domains = Array.isArray(row.cited_domains)
        ? row.cited_domains
        : JSON.parse(row.cited_domains ?? '[]')
    } catch { /* ignore */ }

    const otherDomains = domains
      .filter((d: string) => typeof d === 'string' && !d.toLowerCase().includes('clay.com'))
      .slice(0, 5)

    promptMap.get(promptId)!.rows.push({
      id: row.id,
      platform: row.platform,
      run_date: (row.run_date ?? '').substring(0, 10),
      snippet: row[snippetCol] ?? null,
      response_text: row.response_text ?? null,
      brand_sentiment: row.brand_sentiment ?? null,
      other_cited_domains: otherDomains,
    })
  }

  return Array.from(topicMap.entries())
    .map(([topic, promptMap]) => {
      const promptRows = Array.from(promptMap.entries()).map(([prompt_id, { prompt_text, topic, rows }]) => ({
        prompt_id,
        prompt_text,
        topic,
        count: rows.length,
        responses: rows.sort((a, b) => b.run_date.localeCompare(a.run_date)),
      })).sort((a, b) => b.count - a.count)

      return {
        topic,
        count: promptRows.reduce((s, p) => s + p.count, 0),
        prompts: promptRows,
      }
    })
    .sort((a, b) => b.count - a.count)
}

export async function getFollowupTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; count: number }[]> {
  const { data } = await applyFilters(
    sb.from('responses').select('run_date, clay_recommended_followup'),
    f
  )
  if (!data) return []

  const map = new Map<string, number>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    if (row.clay_recommended_followup === 'Yes') {
      map.set(date, (map.get(date) ?? 0) + 1)
    }
  }

  const allDates = [...new Set(data.map(r => (r.run_date ?? '').substring(0, 10)).filter(Boolean))]
  return allDates
    .map(date => ({ date, count: map.get(date) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface PMMPromptResponseRow {
  id: string
  platform: string
  run_date: string
  clay_mentioned: string | null
  clay_mention_position: number | null
  clay_mention_snippet: string | null
  response_text: string | null
  clay_cited: boolean
  other_cited_domains: string[]
}

export interface PMMPromptDrillRow {
  prompt_id: string
  prompt_text: string
  visibility_pct: number
  avg_position: number | null
  response_count: number
  responses: PMMPromptResponseRow[]
}

export async function getPMMPromptDrilldown(
  sb: SupabaseClient,
  f: FilterParams,
  pmmUseCase: string
): Promise<PMMPromptDrillRow[]> {
  const { data } = await applyFilters(
    sb.from('responses').select(
      'id, prompt_id, platform, run_date, clay_mentioned, clay_mention_position, clay_mention_snippet, response_text, cited_domains, pmm_use_case'
    ),
    { ...f }
  ).eq('pmm_use_case', pmmUseCase)
  if (!data?.length) return []

  // Group by prompt
  const map = new Map<string, {
    mentioned: number; total: number; positions: number[]
    rows: PMMPromptResponseRow[]
  }>()

  for (const row of data) {
    const cur = map.get(row.prompt_id) ?? { mentioned: 0, total: 0, positions: [], rows: [] }
    cur.total++
    if (row.clay_mentioned === 'Yes') cur.mentioned++
    if (row.clay_mention_position != null) cur.positions.push(row.clay_mention_position)

    // Parse cited_domains
    let domains: string[] = []
    try {
      domains = Array.isArray(row.cited_domains)
        ? row.cited_domains
        : JSON.parse(row.cited_domains ?? '[]')
    } catch { /* ignore */ }

    const clayCited = domains.some((d: string) => typeof d === 'string' && d.toLowerCase().includes('clay.com'))
    const otherDomains = domains
      .filter((d: string) => typeof d === 'string' && !d.toLowerCase().includes('clay.com'))
      .slice(0, 5)

    cur.rows.push({
      id: row.id,
      platform: row.platform,
      run_date: (row.run_date ?? '').substring(0, 10),
      clay_mentioned: row.clay_mentioned,
      clay_mention_position: row.clay_mention_position,
      clay_mention_snippet: row.clay_mention_snippet ?? null,
      response_text: row.response_text ?? null,
      clay_cited: clayCited,
      other_cited_domains: otherDomains,
    })
    map.set(row.prompt_id, cur)
  }

  // Fetch prompt texts
  const ids = Array.from(map.keys())
  const { data: prompts } = await sb.from('prompts').select('prompt_id, prompt_text').in('prompt_id', ids)
  const textMap = new Map((prompts ?? []).map((p: any) => [p.prompt_id, p.prompt_text]))

  return Array.from(map.entries()).map(([prompt_id, { mentioned, total, positions, rows }]) => ({
    prompt_id,
    prompt_text: textMap.get(prompt_id) ?? '(unknown prompt)',
    visibility_pct: total > 0 ? (mentioned / total) * 100 : 0,
    avg_position: positions.length > 0 ? positions.reduce((a: number, b: number) => a + b, 0) / positions.length : null,
    response_count: total,
    responses: rows.sort((a, b) => b.run_date.localeCompare(a.run_date)),
  })).sort((a, b) => b.visibility_pct - a.visibility_pct)
}

export async function getLastRunDate(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from('responses')
    .select('run_date')
    .order('run_date', { ascending: false })
    .limit(1)
  return data?.[0]?.run_date ?? null
}

export async function getDataFreshnessStats(
  sb: SupabaseClient
): Promise<{ lastRunDate: string | null; promptCount: number; platformCount: number }> {
  const [dateRes, statsRes] = await Promise.all([
    sb.from('responses').select('run_date').order('run_date', { ascending: false }).limit(1),
    sb.from('responses').select('prompt_id, platform').limit(20000),
  ])
  const lastRunDate = dateRes.data?.[0]?.run_date ?? null
  const promptCount = new Set(statsRes.data?.map(r => r.prompt_id)).size
  const platformCount = new Set(statsRes.data?.map(r => r.platform)).size
  return { lastRunDate, promptCount, platformCount }
}
