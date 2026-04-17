import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function isTruthy(val: unknown): boolean {
  return val === true || val === 'Yes' || val === 'yes' || val === 1
}

async function generateInsight() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    return NextResponse.json({ ok: false, error: 'Missing server env vars (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY)' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const today = new Date().toISOString().split('T')[0]

  // Idempotency check
  const { data: existing } = await supabase
    .from('insights')
    .select('*')
    .eq('run_date', today)
    .eq('insight_type', 'daily_insight')
    .limit(1)
    .single()

  if (existing) return NextResponse.json({ ok: true, insight: existing, cached: true })

  // Check for recent data (last 2 days)
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const recentCutoff = twoDaysAgo.toISOString().split('T')[0]

  const { data: recentCheck } = await supabase
    .from('responses')
    .select('id')
    .gte('run_day', recentCutoff)
    .limit(1)

  if (!recentCheck?.length) {
    return NextResponse.json({ ok: false, error: 'No data ingested in the last 2 days' }, { status: 404 })
  }

  // Fetch last 14 days — paginated to bypass Supabase's 1000-row hard cap
  const since = new Date()
  since.setDate(since.getDate() - 14)
  const startDate = since.toISOString().split('T')[0]

  const cols = 'run_day, platform, topic, clay_mentioned, brand_sentiment_score, clay_recommended_followup, claygent_or_mcp_mentioned, cited_domains'
  const PAGE = 1000
  const responses: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('responses')
      .select(cols)
      .gte('run_day', startDate)
      .lte('run_day', today)
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    if (!data?.length) break
    responses.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  if (!responses.length) {
    return NextResponse.json({ ok: false, error: 'No response data found' }, { status: 400 })
  }

  type DayMetrics = { date: string; total: number; clay: number; cited: number; claymcp: number; recommended: number; sentSum: number; sentCount: number }

  const byDay = new Map<string, DayMetrics>()
  const byDatePlatform = new Map<string, Map<string, DayMetrics>>()
  const byTopic = new Map<string, { total: number; clay: number }>()

  function dayKey(date: string, platform: string): DayMetrics {
    if (!byDatePlatform.has(date)) byDatePlatform.set(date, new Map())
    const dm = byDatePlatform.get(date)!
    if (!dm.has(platform)) dm.set(platform, { date, total: 0, clay: 0, cited: 0, claymcp: 0, recommended: 0, sentSum: 0, sentCount: 0 })
    return dm.get(platform)!
  }

  for (const r of responses) {
    const date = (r.run_day ?? '').substring(0, 10)
    if (!date) continue
    const platform = r.platform ?? 'Unknown'
    const domains: string[] = Array.isArray(r.cited_domains) ? r.cited_domains : []
    const clayMentioned = isTruthy(r.clay_mentioned)
    const clayCited = domains.some((d: string) => typeof d === 'string' && d.toLowerCase().includes('clay.com'))
    const clayMCP = isTruthy(r.claygent_or_mcp_mentioned)
    const recommended = isTruthy(r.clay_recommended_followup)
    const sentScore: number | null = typeof r.brand_sentiment_score === 'number' ? r.brand_sentiment_score : null

    if (!byDay.has(date)) byDay.set(date, { date, total: 0, clay: 0, cited: 0, claymcp: 0, recommended: 0, sentSum: 0, sentCount: 0 })
    const d = byDay.get(date)!
    d.total++
    if (clayMentioned) d.clay++
    if (clayCited) d.cited++
    if (clayMCP) d.claymcp++
    if (recommended) d.recommended++
    if (sentScore !== null) { d.sentSum += sentScore; d.sentCount++ }

    const p = dayKey(date, platform)
    p.total++
    if (clayMentioned) p.clay++
    if (clayCited) p.cited++
    if (clayMCP) p.claymcp++
    if (recommended) p.recommended++
    if (sentScore !== null) { p.sentSum += sentScore; p.sentCount++ }

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

  const dailyRows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map(rates)

  const platformTotals = new Map<string, { vis: number; cit: number; mcp: number; rec: number; days: number; total_prompts: number }>()
  for (const [, dm] of byDatePlatform) {
    for (const [plat, m] of dm) {
      if (m.total === 0) continue
      const cur = platformTotals.get(plat) ?? { vis: 0, cit: 0, mcp: 0, rec: 0, days: 0, total_prompts: 0 }
      cur.vis += (m.clay / m.total) * 100
      cur.cit += (m.cited / m.total) * 100
      cur.mcp += (m.claymcp / m.total) * 100
      cur.rec += (m.recommended / m.total) * 100
      cur.days++
      cur.total_prompts += m.total
      platformTotals.set(plat, cur)
    }
  }
  const platformRows = [...platformTotals.entries()].map(([platform, s]) => ({
    platform,
    total_prompts: s.total_prompts,
    avg_visibility_rate: s.days > 0 ? +(s.vis / s.days).toFixed(2) : 0,
    avg_citation_rate: s.days > 0 ? +(s.cit / s.days).toFixed(2) : 0,
    avg_claymcp_rate: s.days > 0 ? +(s.mcp / s.days).toFixed(2) : 0,
    avg_recommendation_rate: s.days > 0 ? +(s.rec / s.days).toFixed(2) : 0,
  }))

  const topicRows = [...byTopic.entries()]
    .filter(([, m]) => m.total >= 5)
    .map(([topic, m]) => ({ topic, total: m.total, visibility_rate: +((m.clay / m.total) * 100).toFixed(2) }))
    .sort((a, b) => b.visibility_rate - a.visibility_rate)
    .slice(0, 10)

  const userContent =
    `DAILY METRICS (one row per day, last 14 days):\n${JSON.stringify(dailyRows, null, 2)}\n\n` +
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
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system:
        `You are an analyst reviewing AI visibility data for Clay (clay.com). ` +
        `You have 14 days of daily metrics showing how often Clay is mentioned, ` +
        `cited, and recommended across AI platforms.\n\n` +
        `Find ONE non-obvious insight using this priority order:\n` +
        `1. Narrative tension — two metrics moving in opposite directions\n` +
        `2. Ratio shifts — relationships between metrics changing\n` +
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
    return NextResponse.json({ ok: false, error: `Anthropic API error: ${errText}` }, { status: 500 })
  }

  const anthropicData = await anthropicRes.json()
  const rawContent: string = anthropicData.content?.[0]?.text ?? ''

  let parsed: { headline: string; explanation: string; implication: string }
  try {
    const clean = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(clean)
  } catch {
    parsed = { headline: 'AI visibility data analysed for today.', explanation: rawContent.slice(0, 300), implication: '' }
  }

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

  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, insight: inserted })
}

// POST: called from the dashboard frontend
export async function POST() {
  return generateInsight()
}

// GET: called by Vercel cron — requires Authorization: Bearer <CRON_SECRET>
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }
  return generateInsight()
}
