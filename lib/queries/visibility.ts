// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams, TimeseriesRow, CompetitorRow } from './types'

/**
 * Supabase projects have a hard 1000-row cap per request regardless of .limit().
 * This helper paginates through all pages using .range() and returns every row.
 */
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

/** Fetch all rows matching filters, paginated. */
async function fetchFiltered(query: any, f: FilterParams): Promise<any[]> {
  return fetchAllPages(applyFilters(query, f))
}

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
  if (f.promptType && f.promptType !== 'all') {
    query = query.filter('prompt_type', 'ilike', f.promptType)
  }
  if (f.tags && f.tags !== 'all') {
    query = query.eq('tags', f.tags)
  }
  return query
}

// Count matching responses by fetching all IDs via pagination (bypasses the 1000-row cap).
async function countResponses(sb: SupabaseClient, f: FilterParams, extraFilter?: (q: any) => any): Promise<number> {
  let q = applyFilters(sb.from('responses').select('id'), f)
  if (extraFilter) q = extraFilter(q)
  const data = await fetchAllPages(q)
  return data.length
}

/** Shared helper: build params for visibility RPCs */
function visRpcParams(f: FilterParams) {
  return {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prev_start_day: (f.prevStartDate || f.startDate).split('T')[0],
    p_prev_end_day:   (f.prevEndDate   || f.endDate).split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    // Send null (not []) when no platforms selected — PostgREST serializes [] ambiguously
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  }
}

/**
 * Single RPC call → all 3 KPIs (visibility score, avg position, claygent count)
 * for both current and previous period. Returns TABLE so data is data[0].column.
 */
export async function getVisibilityKpis(sb: SupabaseClient, f: FilterParams): Promise<{
  visibility:    { current: number | null; previous: number | null; total: number }
  avgPosition:   { current: number | null; previous: number | null }
  claygentCount: { current: number; previous: number }
}> {
  const { data, error } = await sb.rpc('get_visibility_kpis', visRpcParams(f))
  if (error) console.error('[getVisibilityKpis] RPC error:', error)
  const r = !error && data?.[0] ? data[0] : null
  return {
    visibility: {
      current:  r?.vis_current  ?? null,
      previous: r?.vis_previous ?? null,
      total:    r?.vis_total    ?? 0,
    },
    avgPosition: {
      current:  r?.pos_current  ?? null,
      previous: r?.pos_previous ?? null,
    },
    claygentCount: {
      current:  r?.claygent_current  ?? 0,
      previous: r?.claygent_previous ?? 0,
    },
  }
}

export async function getVisibilityScore(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number | null; previous: number | null; total: number }> {
  return (await getVisibilityKpis(sb, f)).visibility
}

export async function getClayOverallTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; value: number }[]> {
  const { data, error } = await sb.rpc('get_visibility_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getClayOverallTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({ date: String(r.date), value: r.value ?? 0 }))
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
  // Query prompts table (small, fast) rather than paginating 9000+ response rows
  const data = await fetchAllPages(sb.from('prompts').select('prompt_type').not('prompt_type', 'is', null))
  const normalized = data.map((r: any) => (r.prompt_type ?? '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(normalized)].sort() as string[]
}

export async function getVisibilityTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const data = await fetchFiltered(sb.from('responses').select('run_date, platform, clay_mentioned'), f)
  if (!data.length) return []

  const map = new Map<string, { total: number; mentioned: number }>()
  for (const row of data) {
    const date = (row.run_date ?? '').substring(0, 10)
    if (!date) continue
    const key = `${date}|||${row.platform}`
    const cur = map.get(key) ?? { total: 0, mentioned: 0 }
    cur.total++
    if ((row.clay_mentioned ?? '').toLowerCase() === 'yes') cur.mentioned++
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
  const { data, error } = await sb.rpc('get_competitor_visibility_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getCompetitorVisibilityTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    date:       String(r.date),
    competitor: r.competitor,
    value:      r.value ?? 0,
  }))
}

export async function getCompetitorLeaderboard(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CompetitorRow[]> {
  const { data, error } = await sb.rpc('get_competitor_leaderboard_rpc', visRpcParams(f))
  if (error) console.error('[getCompetitorLeaderboard] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    competitor_name:  r.competitor_name,
    mention_count:    r.mention_count,
    sov_pct:          r.visibility_score,
    visibility_score: r.visibility_score,
    delta:            r.delta,
  }))
}

export async function getVisibilityByPMM(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const { data, error } = await sb.rpc('get_visibility_by_pmm_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getVisibilityByPMM] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    date:         String(r.date),
    pmm_use_case: r.pmm_use_case,
    value:        r.value ?? 0,
  }))
}

export async function getPMMTable(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ pmm_use_case: string; pmm_classification: string | null; visibility_score: number; delta: number | null; citation_share: number | null; avg_position: number | null; total_responses: number; timeseries: { date: string; value: number }[] }[]> {
  // Single RPC call replaces two parallel paginated fetches (was 10–20 round trips).
  // timeseries is returned as JSONB [{date, value}] from the RPC.
  const { data, error } = await sb.rpc('get_pmm_table_rpc', visRpcParams(f))
  if (error) console.error('[getPMMTable] RPC error:', error)
  if (!data?.length) return []

  return data.map((r: any) => ({
    pmm_use_case:       r.pmm_use_case,
    pmm_classification: r.pmm_classification ?? null,
    visibility_score:   r.visibility_score ?? 0,
    delta:              r.delta            ?? null,
    citation_share:     r.citation_share   ?? null,
    avg_position:       r.avg_position     ?? null,
    total_responses:    r.total_responses  ?? 0,
    timeseries:         Array.isArray(r.timeseries) ? r.timeseries : [],
  }))
}

export async function getVisibilityByTopic(
  sb: SupabaseClient,
  f: FilterParams
): Promise<TimeseriesRow[]> {
  const { data, error } = await sb.rpc('get_visibility_by_topic_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getVisibilityByTopic] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    date:  String(r.date),
    topic: r.topic,
    value: r.value ?? 0,
  }))
}

export async function getShareOfVoice(
  sb: SupabaseClient,
  f: FilterParams
): Promise<CompetitorRow[]> {
  // Single RPC call replaces paginated responses + hundreds of batched response_competitors requests.
  const { data, error } = await sb.rpc('get_share_of_voice_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getShareOfVoice] RPC error:', error)
  return (data ?? []).map((r: any) => ({
    competitor_name: r.competitor_name,
    mention_count:   r.mention_count,
    sov_pct:         r.sov_pct ?? 0,
  }))
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
  return (await getVisibilityKpis(sb, f)).avgPosition
}

export async function getDistinctTopics(sb: SupabaseClient): Promise<string[]> {
  const data = await fetchAllPages(sb.from('responses').select('topic').not('topic', 'is', null))
  return [...new Set(data.map(r => r.topic).filter(Boolean))].sort() as string[]
}

export async function getDistinctBrandedValues(sb: SupabaseClient): Promise<string[]> {
  const data = await fetchAllPages(sb.from('responses').select('branded_or_non_branded').not('branded_or_non_branded', 'is', null))
  return [...new Set(data.map(r => (r.branded_or_non_branded ?? '').trim()).filter(Boolean))].sort() as string[]
}

export async function getDistinctTags(sb: SupabaseClient, startDate?: string, endDate?: string): Promise<string[]> {
  let query = sb.from('responses').select('tags').not('tags', 'is', null)
  if (startDate) query = query.gte('run_date', startDate)
  if (endDate) query = query.lte('run_date', endDate)
  const data = await fetchAllPages(query)
  return [...new Set(data.map(r => (r.tags ?? '').trim()).filter(Boolean))].sort() as string[]
}

export async function getClaygentCount(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ current: number; previous: number }> {
  return (await getVisibilityKpis(sb, f)).claygentCount
}

export async function getClaygentTimeseriesByPlatform(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; platform: string; count: number }[]> {
  const { data, error } = await sb.rpc('get_claygent_platform_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getClaygentTimeseriesByPlatform] RPC error:', error)
  // RPC returns only rows with data; fill zeros for all date×platform combos
  const rows = (data ?? []) as { date: string; platform: string; count: number }[]
  const allDates    = [...new Set(rows.map(r => String(r.date)))]
  const allPlatforms = [...new Set(rows.map(r => r.platform))]
  const lookup = new Map(rows.map(r => [`${String(r.date)}|||${r.platform}`, r.count]))
  const result: { date: string; platform: string; count: number }[] = []
  for (const date of allDates) {
    for (const platform of allPlatforms) {
      result.push({ date, platform, count: lookup.get(`${date}|||${platform}`) ?? 0 })
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getClaygentTimeseries(
  sb: SupabaseClient,
  f: FilterParams
): Promise<{ date: string; count: number }[]> {
  const { data, error } = await sb.rpc('get_claygent_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getClaygentTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({ date: String(r.date), count: r.count ?? 0 }))
}

export interface MentionResponseRow {
  id: string
  platform: string
  run_date: string
  snippet: string | null
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
    : column === 'claygent_or_mcp_mentioned'
      ? 'claygent_or_mcp_snippet'
      : 'clay_mention_snippet'

  // Omit response_text from the bulk fetch — it can be 5-10KB per row.
  // The full text is lazy-loaded per-row when the user expands a card.
  const allData = await fetchAllPages(applyFilters(
    sb.from('responses').select(
      `id, prompt_id, platform, run_date, topic, cited_domains, brand_sentiment, ${column}, ${snippetCol}`
    ).eq(column, 'Yes'),  // DB stores 'Yes'/'No' (capitalized)
    f
  ))
  const data = allData

  if (!data.length) return []

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
  // Use cache-backed RPC (instant for default filters, falls back to live scan)
  const { data, error } = await sb.rpc('get_followup_timeseries_rpc', {
    p_start_day:      f.startDate.split('T')[0],
    p_end_day:        f.endDate.split('T')[0],
    p_prompt_type:    f.promptType    || 'all',
    p_platforms:      (f.platforms && f.platforms.length > 0) ? f.platforms : null,
    p_branded_filter: f.brandedFilter || 'all',
    p_tags:           f.tags          || 'all',
  })
  if (error) console.error('[getFollowupTimeseries] RPC error:', error)
  return (data ?? []).map((r: any) => ({ date: String(r.date), count: r.count ?? 0 }))
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
  pmmUseCase: string,
  pmmClassification?: string | null
): Promise<PMMPromptDrillRow[]> {
  let q = applyFilters(
    sb.from('responses').select(
      'id, prompt_id, platform, run_date, clay_mentioned, clay_mention_position, clay_mention_snippet, response_text, cited_domains, pmm_use_case'
    ),
    { ...f }
  ).eq('pmm_use_case', pmmUseCase)
  if (pmmClassification) q = q.eq('pmm_classification', pmmClassification)
  const data = await fetchAllPages(q)
  if (!data.length) return []

  // Group by prompt
  const map = new Map<string, {
    mentioned: number; total: number; positions: number[]
    rows: PMMPromptResponseRow[]
  }>()

  for (const row of data) {
    const cur = map.get(row.prompt_id) ?? { mentioned: 0, total: 0, positions: [], rows: [] }
    cur.total++
    if ((row.clay_mentioned ?? '').toLowerCase() === 'yes') cur.mentioned++
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

  // Fetch prompt texts (batched to avoid PostgREST URL length limit)
  const ids = Array.from(map.keys())
  const BATCH = 100
  const allPrompts = (await Promise.all(
    Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) =>
      sb.from('prompts')
        .select('prompt_id, prompt_text')
        .in('prompt_id', ids.slice(i * BATCH, (i + 1) * BATCH))
        .then(({ data: d }) => d ?? [])
    )
  )).flat()
  const textMap = new Map(allPrompts.map((p: any) => [p.prompt_id, p.prompt_text]))

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
  const [dateRes, promptRes, platformRes] = await Promise.all([
    sb.from('responses').select('run_date').order('run_date', { ascending: false }).limit(1),
    sb.from('prompts').select('prompt_id', { count: 'exact', head: true }).eq('is_active', true),
    sb.from('aeo_cache_daily').select('platform').limit(50),
  ])
  return {
    lastRunDate:   dateRes.data?.[0]?.run_date ?? null,
    promptCount:   promptRes.count ?? 0,
    platformCount: new Set(platformRes.data?.map((r: any) => r.platform).filter(Boolean)).size,
  }
}
