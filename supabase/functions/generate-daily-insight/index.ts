// generate-daily-insight
// Aggregates 14 days of responses, calls Claude to find one non-obvious insight,
// and stores it in the `insights` table. Idempotent: skips if today's row exists.

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!

    const today = new Date().toISOString().split('T')[0]

    // ── Idempotency check ────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('insights')
      .select('*')
      .eq('run_date', today)
      .eq('insight_type', 'daily_insight')
      .limit(1)
      .single()

    if (existing) return json({ ok: true, insight: existing, cached: true })

    // ── Fetch last 14 days of responses ──────────────────────────────────────
    const since = new Date()
    since.setDate(since.getDate() - 14)
    const startDate = since.toISOString().split('T')[0]

    const { data: responses, error: fetchErr } = await supabase
      .from('responses')
      .select(
        'run_date, platform, topic, clay_mentioned, brand_sentiment_score, ' +
        'clay_recommended_followup, claygent_or_mcp_mentioned, cited_domains',
      )
      .gte('run_date', startDate)
      .lte('run_date', today)
      .limit(50000)

    if (fetchErr || !responses?.length) {
      return json({ ok: false, error: 'No response data found' }, 400)
    }

    // ── Aggregate metrics ────────────────────────────────────────────────────
    type DayMetrics = {
      date: string
      total: number
      clay: number
      cited: number
      claymcp: number
      recommended: number
      sentSum: number
      sentCount: number
    }

    const byDay = new Map<string, DayMetrics>()
    // For platform breakdown: Map<date, Map<platform, DayMetrics>>
    const byDatePlatform = new Map<string, Map<string, DayMetrics>>()
    const byTopic = new Map<string, { total: number; clay: number }>()

    function dayKey(date: string, platform: string): DayMetrics {
      if (!byDatePlatform.has(date)) byDatePlatform.set(date, new Map())
      const dm = byDatePlatform.get(date)!
      if (!dm.has(platform)) {
        dm.set(platform, { date, total: 0, clay: 0, cited: 0, claymcp: 0, recommended: 0, sentSum: 0, sentCount: 0 })
      }
      return dm.get(platform)!
    }

    for (const r of responses) {
      const date = (r.run_date ?? '').substring(0, 10)
      if (!date) continue

      const platform = r.platform ?? 'Unknown'
      const domains: string[] = Array.isArray(r.cited_domains) ? r.cited_domains : []
      const clayMentioned = isTruthy(r.clay_mentioned)
      const clayCited = domains.some(d => typeof d === 'string' && d.toLowerCase().includes('clay'))
      const clayMCP = isTruthy(r.claygent_or_mcp_mentioned)
      const recommended = isTruthy(r.clay_recommended_followup)
      const sentScore: number | null = typeof r.brand_sentiment_score === 'number' ? r.brand_sentiment_score : null

      // Overall daily
      if (!byDay.has(date)) byDay.set(date, { date, total: 0, clay: 0, cited: 0, claymcp: 0, recommended: 0, sentSum: 0, sentCount: 0 })
      const d = byDay.get(date)!
      d.total++
      if (clayMentioned) d.clay++
      if (clayCited) d.cited++
      if (clayMCP) d.claymcp++
      if (recommended) d.recommended++
      if (sentScore !== null) { d.sentSum += sentScore; d.sentCount++ }

      // Per-platform
      const p = dayKey(date, platform)
      p.total++
      if (clayMentioned) p.clay++
      if (clayCited) p.cited++
      if (clayMCP) p.claymcp++
      if (recommended) p.recommended++
      if (sentScore !== null) { p.sentSum += sentScore; p.sentCount++ }

      // Topic
      const topic = r.topic ?? 'Unknown'
      const t = byTopic.get(topic) ?? { total: 0, clay: 0 }
      t.total++
      if (clayMentioned) t.clay++
      byTopic.set(topic, t)
    }

    function rates(m: DayMetrics) {
      const n = m.total
      return {
        date: m.date,
        total_prompts: n,
        visibility_rate: n > 0 ? +((m.clay / n) * 100).toFixed(2) : 0,
        citation_rate: n > 0 ? +((m.cited / n) * 100).toFixed(2) : 0,
        claymcp_rate: n > 0 ? +((m.claymcp / n) * 100).toFixed(2) : 0,
        recommendation_rate: n > 0 ? +((m.recommended / n) * 100).toFixed(2) : 0,
        avg_sentiment: m.sentCount > 0 ? +(m.sentSum / m.sentCount).toFixed(2) : null,
      }
    }

    const dailyRows = [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(rates)

    // Platform summary: average each rate across dates
    const platformTotals = new Map<string, { vis: number; cit: number; mcp: number; rec: number; days: number }>()
    for (const [, dm] of byDatePlatform) {
      for (const [plat, m] of dm) {
        if (m.total === 0) continue
        const cur = platformTotals.get(plat) ?? { vis: 0, cit: 0, mcp: 0, rec: 0, days: 0 }
        cur.vis += (m.clay / m.total) * 100
        cur.cit += (m.cited / m.total) * 100
        cur.mcp += (m.claymcp / m.total) * 100
        cur.rec += (m.recommended / m.total) * 100
        cur.days++
        platformTotals.set(plat, cur)
      }
    }
    const platformRows = [...platformTotals.entries()].map(([platform, s]) => ({
      platform,
      avg_visibility_rate: s.days > 0 ? +(s.vis / s.days).toFixed(2) : 0,
      avg_citation_rate: s.days > 0 ? +(s.cit / s.days).toFixed(2) : 0,
      avg_claymcp_rate: s.days > 0 ? +(s.mcp / s.days).toFixed(2) : 0,
      avg_recommendation_rate: s.days > 0 ? +(s.rec / s.days).toFixed(2) : 0,
    }))

    const topicRows = [...byTopic.entries()]
      .filter(([, m]) => m.total >= 5)
      .map(([topic, m]) => ({
        topic,
        total: m.total,
        visibility_rate: +((m.clay / m.total) * 100).toFixed(2),
      }))
      .sort((a, b) => b.visibility_rate - a.visibility_rate)
      .slice(0, 10)

    // ── Call Anthropic ────────────────────────────────────────────────────────
    const userContent =
      `DAILY METRICS (one row per day, last 30 days):\n${JSON.stringify(dailyRows, null, 2)}\n\n` +
      `PLATFORM BREAKDOWN (avg per platform):\n${JSON.stringify(platformRows, null, 2)}\n\n` +
      `TOP TOPICS BY VISIBILITY:\n${JSON.stringify(topicRows, null, 2)}`

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system:
          `You are an analyst reviewing AI visibility data for Clay (clay.com). ` +
          `You have 30 days of daily metrics showing how often Clay is mentioned, ` +
          `cited, and recommended across AI platforms.\n\n` +
          `Find ONE non-obvious insight using this priority order:\n` +
          `1. Narrative tension — two metrics moving in opposite directions\n` +
          `2. Ratio shifts — relationships between metrics changing (e.g. claymcp_rate ` +
          `rising while citation_rate flat = agents finding Clay unprompted)\n` +
          `3. Pattern breaks — something trending one direction for 5+ days then reversed\n` +
          `4. Platform divergence — one platform behaving differently from others\n` +
          `5. Topic concentration — visibility clustering into fewer or more topics\n\n` +
          `Rules:\n` +
          `- No generic observations\n` +
          `- Never say "it appears" or "it seems" or "interesting"\n` +
          `- Always end with a strategic question or hypothesis\n` +
          `- Be specific with numbers\n\n` +
          `Respond ONLY with valid JSON, no markdown, no preamble:\n` +
          `{\n` +
          `  "headline": "one punchy sentence under 15 words",\n` +
          `  "explanation": "2 sentences max, include specific numbers",\n` +
          `  "implication": "one strategic question or hypothesis"\n` +
          `}`,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      return json({ ok: false, error: `Anthropic API error: ${errText}` }, 500)
    }

    const anthropicData = await anthropicRes.json()
    const rawContent: string = anthropicData.content?.[0]?.text ?? ''

    let parsed: { headline: string; explanation: string; implication: string }
    try {
      const clean = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      parsed = {
        headline: 'AI visibility data analysed for today.',
        explanation: rawContent.slice(0, 300),
        implication: '',
      }
    }

    // ── Persist to insights table ─────────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from('insights')
      .insert({
        run_date: today,
        insight_text: parsed.headline,
        insight_type: 'daily_insight',
        supporting_data: {
          explanation: parsed.explanation,
          implication: parsed.implication,
          raw_metrics_snapshot: {
            date_range: `${startDate} to ${today}`,
            total_responses: responses.length,
            days: dailyRows.length,
            platform_breakdown: platformRows,
          },
        },
      })
      .select()
      .single()

    if (insertErr) return json({ ok: false, error: insertErr.message }, 500)

    return json({ ok: true, insight: inserted })
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})
