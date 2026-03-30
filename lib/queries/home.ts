// @ts-nocheck
import { SupabaseClient } from '@supabase/supabase-js'
import type { AnomalyRow, InsightRow } from './types'

export async function getLatestInsight(sb: SupabaseClient): Promise<InsightRow | null> {
  const today = new Date().toISOString().split('T')[0]
  // Prefer today's daily_insight, fall back to most recent
  const { data: todayData } = await sb
    .from('insights')
    .select('*')
    .eq('run_date', today)
    .eq('insight_type', 'daily_insight')
    .limit(1)
  if (todayData?.[0]) return todayData[0]

  const { data } = await sb
    .from('insights')
    .select('*')
    .eq('insight_type', 'daily_insight')
    .order('run_date', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

export async function getActiveAnomalies(sb: SupabaseClient): Promise<AnomalyRow[]> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const { data } = await sb
    .from('anomalies')
    .select('*')
    .eq('dismissed', false)
    .gte('run_date', sevenDaysAgo.toISOString().split('T')[0])
    .order('detected_at', { ascending: false })

  // Sort: critical → warning → info, then by detected_at desc
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, high: 0, medium: 1, info: 2, low: 2 }
  return (data ?? []).sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 3
    const sb2 = severityOrder[b.severity] ?? 3
    if (sa !== sb2) return sa - sb2
    return b.detected_at.localeCompare(a.detected_at)
  })
}

export async function dismissAnomaly(sb: SupabaseClient, id: string): Promise<void> {
  await sb.from('anomalies').update({ dismissed: true }).eq('id', id)
}

export async function getTopCompetitorThisWeek(
  sb: SupabaseClient,
  startDate: string,
  endDate: string
): Promise<{ name: string; pct: number } | null> {
  const { data } = await sb
    .from('response_competitors')
    .select('competitor_name')
    .gte('run_date', startDate)
    .lte('run_date', endDate)

  if (!data?.length) return null

  const map = new Map<string, number>()
  for (const r of data) {
    const n = r.competitor_name ?? ''
    map.set(n, (map.get(n) ?? 0) + 1)
  }

  const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return null

  // Get total unique responses to compute %
  const { data: totalData } = await sb
    .from('responses')
    .select('id')
    .gte('run_date', startDate)
    .lte('run_date', endDate)

  const total = totalData?.length ?? 1
  return { name: top[0], pct: (top[1] / total) * 100 }
}
