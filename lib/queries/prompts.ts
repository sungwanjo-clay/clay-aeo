import { SupabaseClient } from '@supabase/supabase-js'
import type { FilterParams } from './types'

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

export interface PromptRow {
  prompt_id: string
  prompt_text: string
  topic: string | null
  intent: string | null
  pmm_use_case: string | null
  pmm_classification: string | null
  prompt_type: string | null
  tags: string | null
  branded_or_non_branded: string | null
  is_active: boolean
  last_seen_at: string | null
  responses: ResponseRow[]
}

export interface ResponseRow {
  id: string
  platform: string
  run_date: string
  clay_mentioned: string | null
  clay_mention_snippet: string | null
  brand_sentiment: string | null
  brand_sentiment_score: number | null
  competitors_mentioned: string[] | null
  cited_domains: string[] | null
  themes: { theme: string; sentiment: string; snippet: string }[] | null
  primary_use_case_attributed: string | null
  positioning_vs_competitors: string | null
  // response_text is NOT fetched in bulk — lazy-loaded per row in PromptDrilldown
  clay_mention_position: number | null
  claygent_or_mcp_mentioned: string | null
}

export async function getPromptsWithResponses(
  sb: SupabaseClient,
  f: FilterParams,
  showInactive = false
): Promise<PromptRow[]> {
  // Select all response columns except response_text (can be 5-10KB per row).
  // response_text is lazy-loaded in PromptDrilldown when the user expands a row.
  const SELECT_COLS = [
    'id', 'prompt_id', 'platform', 'run_date',
    'clay_mentioned', 'clay_mention_snippet',
    'brand_sentiment', 'brand_sentiment_score',
    'competitors_mentioned', 'cited_domains', 'themes',
    'primary_use_case_attributed', 'positioning_vs_competitors',
    'clay_mention_position', 'claygent_or_mcp_mentioned',
  ].join(', ')

  let rQuery = sb
    .from('responses')
    .select(SELECT_COLS)
    .gte('run_day', f.startDate.split('T')[0])
    .lte('run_day', f.endDate.split('T')[0])

  if (f.platforms.length > 0) rQuery = rQuery.in('platform', f.platforms)
  if (f.topics.length > 0) rQuery = rQuery.in('topic', f.topics)
  if (f.promptType === 'benchmark') {
    rQuery = rQuery.filter('prompt_type', 'ilike', 'benchmark')
  } else if (f.promptType === 'campaign') {
    rQuery = rQuery.not('prompt_type', 'is', null).filter('prompt_type', 'not.ilike', 'benchmark')
  }
  if (f.tags && f.tags !== 'all') rQuery = rQuery.eq('tags', f.tags)
  if (f.brandedFilter !== 'all') {
    if (f.brandedFilter === 'branded') {
      rQuery = rQuery.ilike('branded_or_non_branded', 'branded')
    } else {
      rQuery = rQuery.not('branded_or_non_branded', 'ilike', 'branded')
    }
  }

  const responses = await fetchAllPages(rQuery)
  if (!responses.length) return []

  // Don't use .in(prompt_id, [...thousands...]) — URL gets too long.
  // Fetch all prompts and filter in JS instead.
  let promptQuery = sb.from('prompts').select('*')
  if (!showInactive) promptQuery = promptQuery.eq('is_active', true)
  const allPrompts = await fetchAllPages(promptQuery)

  const promptIdSet = new Set(responses.map((r: any) => r.prompt_id).filter(Boolean))
  const prompts = allPrompts.filter((p: any) => promptIdSet.has(p.prompt_id))
  if (!prompts.length) return []

  const responsesByPrompt = new Map<string, ResponseRow[]>()
  for (const r of responses) {
    const arr = responsesByPrompt.get(r.prompt_id) ?? []
    arr.push({
      id: r.id,
      platform: r.platform,
      run_date: r.run_date,
      clay_mentioned: r.clay_mentioned,
      clay_mention_snippet: r.clay_mention_snippet,
      brand_sentiment: r.brand_sentiment,
      brand_sentiment_score: r.brand_sentiment_score,
      competitors_mentioned: Array.isArray(r.competitors_mentioned)
        ? r.competitors_mentioned
        : tryParse(r.competitors_mentioned),
      cited_domains: Array.isArray(r.cited_domains)
        ? r.cited_domains
        : tryParse(r.cited_domains),
      themes: Array.isArray(r.themes) ? r.themes : tryParse(r.themes),
      primary_use_case_attributed: r.primary_use_case_attributed,
      positioning_vs_competitors: r.positioning_vs_competitors,
      clay_mention_position: r.clay_mention_position,
      claygent_or_mcp_mentioned: r.claygent_or_mcp_mentioned,
    })
    responsesByPrompt.set(r.prompt_id, arr)
  }

  return prompts.map(p => ({
    prompt_id: p.prompt_id,
    prompt_text: p.prompt_text,
    topic: p.topic,
    intent: p.intent,
    pmm_use_case: p.pmm_use_case,
    pmm_classification: p.pmm_classification,
    prompt_type: p.prompt_type,
    tags: p.tags,
    branded_or_non_branded: p.branded_or_non_branded,
    is_active: p.is_active ?? true,
    last_seen_at: p.last_seen_at ?? null,
    responses: responsesByPrompt.get(p.prompt_id) ?? [],
  }))
}

function tryParse<T>(val: unknown): T | null {
  if (val == null) return null
  if (typeof val !== 'string') return null
  try { return JSON.parse(val) } catch { return null }
}

export async function getPromptStats(
  sb: SupabaseClient
): Promise<{ total: number; benchmark: number; campaign: number; inactive: number }> {
  const data = await fetchAllPages(sb.from('prompts').select('prompt_type, tags, is_active'))
  if (!data.length) return { total: 0, benchmark: 0, campaign: 0, inactive: 0 }
  const active = data.filter(p => p.is_active !== false)
  return {
    total: active.length,
    benchmark: active.filter(p => (p.prompt_type ?? '').toLowerCase() === 'benchmark').length,
    campaign: active.filter(p => p.tags && (p.prompt_type ?? '').toLowerCase() !== 'benchmark').length,
    inactive: data.filter(p => p.is_active === false).length,
  }
}
