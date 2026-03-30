// evaluate-alerts
// Computes daily metrics per platform + overall, detects anomalies
// (single-day spikes/drops and sustained trends), and writes to the `anomalies` table.
// Deduplicates on (metric, platform, run_date, direction).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function isTruthy(val: unknown): boolean {
  return val === true || val === 'Yes' || val === 'yes' || val === 1
}

/** Returns 'up' | 'down' if the last `days` values move monotonically, else null */
function sustainedTrend(values: number[], days = 4): 'up' | 'down' | null {
  if (values.length < days) return null
  const window = values.slice(-days)
  const allUp = window.every((v, i) => i === 0 || v > window[i - 1])
  const allDown = window.every((v, i) => i === 0 || v < window[i - 1])
  if (allUp) return 'up'
  if (allDown) return 'down'
  return null
}

const METRICS = ['visibility_rate', 'citation_rate', 'claymcp_rate', 'recommendation_rate', 'avg_sentiment'] as const
type Metric = typeof METRICS[number]

type DayBucket = {
  total: number; clay: number; cited: number; claymcp: number
  recommended: number; sentSum: number; sentCount: number
}

function emptyBucket(): DayBucket {
  return { total: 0, clay: 0, cited: 0, claymcp: 0, recommended: 0, sentSum: 0, sentCount: 0 }
}

function bucketRate(b: DayBucket, metric: Metric): number | null {
  if (b.total === 0) return null
  switch (metric) {
    case 'visibility_rate': return (b.clay / b.total) * 100
    case 'citation_rate': return (b.cited / b.total) * 100
    case 'claymcp_rate': return (b.claymcp / b.total) * 100
    case 'recommendation_rate': return (b.recommended / b.total) * 100
    case 'avg_sentiment': return b.sentCount > 0 ? b.sentSum / b.sentCount : null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = new Date().toISOString().split('T')[0]
    const since = new Date()
    since.setDate(since.getDate() - 14)
    const startDate = since.toISOString().split('T')[0]

    // ── Fetch 14 days of responses ───────────────────────────────────────────
    const { data: responses, error: fetchErr } = await supabase
      .from('responses')
      .select(
        'run_date, platform, clay_mentioned, brand_sentiment_score, ' +
        'clay_recommended_followup, claygent_or_mcp_mentioned, cited_domains',
      )
      .gte('run_date', startDate)
      .lte('run_date', today)
      .limit(50000)

    if (fetchErr || !responses?.length) {
      return json({ ok: true, alerts_inserted: 0, message: 'No response data' })
    }

    // ── Build (date × platform) buckets ─────────────────────────────────────
    // Also maintains an 'overall' pseudo-platform
    const grid = new Map<string, DayBucket>() // key: `${date}|||${platform}`

    function getBucket(date: string, platform: string): DayBucket {
      const key = `${date}|||${platform}`
      if (!grid.has(key)) grid.set(key, emptyBucket())
      return grid.get(key)!
    }

    const allDatesSet = new Set<string>()
    const allPlatformsSet = new Set<string>()

    for (const r of responses) {
      const date = (r.run_date ?? '').substring(0, 10)
      if (!date) continue
      const platform = r.platform ?? 'Unknown'

      allDatesSet.add(date)
      allPlatformsSet.add(platform)

      const domains: string[] = Array.isArray(r.cited_domains) ? r.cited_domains : []
      const clayMentioned = isTruthy(r.clay_mentioned)
      const clayCited = domains.some(d => typeof d === 'string' && d.toLowerCase().includes('clay'))
      const clayMCP = isTruthy(r.claygent_or_mcp_mentioned)
      const recommended = isTruthy(r.clay_recommended_followup)
      const sentScore: number | null = typeof r.brand_sentiment_score === 'number' ? r.brand_sentiment_score : null

      for (const scope of [platform, 'overall']) {
        const b = getBucket(date, scope)
        b.total++
        if (clayMentioned) b.clay++
        if (clayCited) b.cited++
        if (clayMCP) b.claymcp++
        if (recommended) b.recommended++
        if (sentScore !== null) { b.sentSum += sentScore; b.sentCount++ }
      }
    }

    const allDates = [...allDatesSet].sort()
    const allPlatforms = [...allPlatformsSet, 'overall']

    // Minimum 7 days of data required
    if (allDates.length < 7) {
      return json({ ok: true, alerts_inserted: 0, message: `Only ${allDates.length} days of data — need 7` })
    }

    // ── Evaluate anomaly rules ───────────────────────────────────────────────
    type AlertCandidate = {
      run_date: string; metric: string; platform: string | null
      current_value: number; previous_value: number
      delta: number; direction: string; severity: string; message: string
    }
    const candidates: AlertCandidate[] = []

    for (const platform of allPlatforms) {
      for (const metric of METRICS) {
        // Build time series: only dates where this platform has data
        const series: { date: string; value: number }[] = []
        for (const date of allDates) {
          const b = grid.get(`${date}|||${platform}`)
          if (!b) continue
          const val = bucketRate(b, metric)
          if (val !== null) series.push({ date, value: val })
        }

        // Need at least 7 data points
        if (series.length < 7) continue

        const todayEntry = series[series.length - 1]
        const prior = series.slice(0, -1)
        const rollingAvg = prior.reduce((s, p) => s + p.value, 0) / prior.length

        // Skip if rolling avg is effectively zero (avoid divide-by-zero noise)
        if (Math.abs(rollingAvg) < 0.01) continue

        const pctDelta = (todayEntry.value - rollingAvg) / Math.abs(rollingAvg)
        const absDelta = Math.abs(pctDelta)
        const platLabel = platform === 'overall' ? null : platform
        const sign = pctDelta > 0 ? '+' : ''

        // Rule 1: Single-day spike/drop >35%
        if (absDelta > 0.35) {
          const direction = pctDelta > 0 ? 'up' : 'down'
          const severity = absDelta > 0.60 ? 'critical' : 'warning'
          candidates.push({
            run_date: today,
            metric,
            platform: platLabel,
            current_value: +todayEntry.value.toFixed(3),
            previous_value: +rollingAvg.toFixed(3),
            delta: +pctDelta.toFixed(4),
            direction,
            severity,
            message: `${metric} on ${platform} ${direction === 'up' ? 'spiked' : 'dropped'} ${sign}${(pctDelta * 100).toFixed(1)}% vs 14-day avg` +
              ` (${rollingAvg.toFixed(1)} → ${todayEntry.value.toFixed(1)})`,
          })
        }

        // Rule 2: Sustained trend — 4+ consecutive days in same direction
        const recentValues = series.slice(-4).map(s => s.value)
        const trend = sustainedTrend(recentValues, 4)
        if (trend) {
          const trendStart = series[series.length - 4]
          const trendPct = trendStart.value !== 0
            ? (todayEntry.value - trendStart.value) / Math.abs(trendStart.value)
            : 0
          candidates.push({
            run_date: today,
            metric,
            platform: platLabel,
            current_value: +todayEntry.value.toFixed(3),
            previous_value: +trendStart.value.toFixed(3),
            delta: +trendPct.toFixed(4),
            direction: trend,
            severity: 'info',
            message: `${metric} on ${platform} has moved ${trend} for 4 consecutive days` +
              ` (${trendStart.value.toFixed(1)} → ${todayEntry.value.toFixed(1)},` +
              ` ${sign}${(trendPct * 100).toFixed(1)}%)`,
          })
        }
      }
    }

    // ── Persist, deduplicating on (metric, platform, run_date, direction) ────
    let inserted = 0
    for (const c of candidates) {
      // Check for existing non-dismissed row with same fingerprint
      let dupQuery = supabase
        .from('anomalies')
        .select('id')
        .eq('metric', c.metric)
        .eq('run_date', c.run_date)
        .eq('direction', c.direction)
        .eq('dismissed', false)

      dupQuery = c.platform === null
        ? dupQuery.is('platform', null)
        : dupQuery.eq('platform', c.platform)

      const { data: existing } = await dupQuery.limit(1)
      if (existing?.length) continue

      const { error: insertErr } = await supabase.from('anomalies').insert({
        detected_at: new Date().toISOString(),
        run_date: c.run_date,
        metric: c.metric,
        platform: c.platform,
        topic: null,
        current_value: c.current_value,
        previous_value: c.previous_value,
        delta: c.delta,
        direction: c.direction,
        severity: c.severity,
        message: c.message,
        dismissed: false,
      })

      if (!insertErr) inserted++
    }

    return json({
      ok: true,
      data_points: allDates.length,
      candidates_evaluated: candidates.length,
      alerts_inserted: inserted,
    })
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})
