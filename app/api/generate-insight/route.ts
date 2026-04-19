import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  const since = new Date()
  since.setDate(since.getDate() - 7)
  const startDate = since.toISOString().split('T')[0]

  // Parallel fetch from all data sources
  const [dailyRes, competitorRes, domainRes, positioningRes, recentInsightsRes] = await Promise.all([
    supabase
      .from('aeo_cache_daily')
      .select('run_day,platform,total_responses,clay_mentioned,clay_cited_responses,total_with_citations,claygent_mentioned,positive_sentiment,negative_sentiment,sum_sentiment_score,count_sentiment_score,clay_followup')
      .eq('prompt_type', 'Benchmark')
      .gte('run_day', startDate)
      .lte('run_day', today)
      .order('run_day', { ascending: true }),

    supabase
      .from('aeo_cache_competitors')
      .select('run_day,platform,competitor_name,mention_count')
      .eq('prompt_type', 'Benchmark')
      .gte('run_day', startDate)
      .lte('run_day', today),

    supabase
      .from('aeo_cache_domains')
      .select('run_day,platform,domain,response_count')
      .eq('prompt_type', 'Benchmark')
      .gte('run_day', startDate)
      .lte('run_day', today),

    supabase
      .from('aeo_cache_positioning')
      .select('run_day,platform,topic,snippet')
      .eq('prompt_type', 'Benchmark')
      .gte('run_day', startDate)
      .lte('run_day', today)
      .order('run_day', { ascending: false })
      .limit(60),

    supabase
      .from('insights')
      .select('run_date,insight_text,supporting_data')
      .eq('insight_type', 'daily_insight')
      .neq('run_date', today)
      .order('run_date', { ascending: false })
      .limit(7),
  ])

  if (dailyRes.error) return NextResponse.json({ ok: false, error: dailyRes.error.message }, { status: 500 })
  if (!dailyRes.data?.length) return NextResponse.json({ ok: false, error: 'No cache data found' }, { status: 404 })

  // --- Daily metrics aggregated across platforms ---
  type DayTotals = { total: number; clay: number; cited: number; withCit: number; claygent: number; posit: number; neg: number; sentSum: number; sentCount: number; followup: number }
  const byDay = new Map<string, DayTotals>()

  for (const r of dailyRes.data) {
    const date = (r.run_day ?? '').substring(0, 10)
    if (!date) continue
    const cur = byDay.get(date) ?? { total: 0, clay: 0, cited: 0, withCit: 0, claygent: 0, posit: 0, neg: 0, sentSum: 0, sentCount: 0, followup: 0 }
    cur.total += r.total_responses ?? 0
    cur.clay += r.clay_mentioned ?? 0
    cur.cited += r.clay_cited_responses ?? 0
    cur.withCit += r.total_with_citations ?? 0
    cur.claygent += r.claygent_mentioned ?? 0
    cur.posit += r.positive_sentiment ?? 0
    cur.neg += r.negative_sentiment ?? 0
    cur.sentSum += r.sum_sentiment_score ?? 0
    cur.sentCount += r.count_sentiment_score ?? 0
    cur.followup += r.clay_followup ?? 0
    byDay.set(date, cur)
  }

  const dailyRows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({
      date,
      total_prompts: t.total,
      visibility_rate: t.total > 0 ? +((t.clay / t.total) * 100).toFixed(1) : 0,
      citation_rate: t.withCit > 0 ? +((t.cited / t.withCit) * 100).toFixed(1) : 0,
      claymcp_rate: t.total > 0 ? +((t.claygent / t.total) * 100).toFixed(1) : 0,
      recommendation_rate: t.total > 0 ? +((t.followup / t.total) * 100).toFixed(1) : 0,
      positive_sentiment_rate: t.total > 0 ? +((t.posit / t.total) * 100).toFixed(1) : 0,
      avg_sentiment_score: t.sentCount > 0 ? +(t.sentSum / t.sentCount).toFixed(2) : null,
    }))

  // --- Platform breakdown (avg rates across days) ---
  type PlatTotals = { vis: number; cit: number; mcp: number; rec: number; days: number; total: number }
  const byPlatform = new Map<string, PlatTotals>()
  const byDayPlatform = new Map<string, Map<string, DayTotals>>()

  for (const r of dailyRes.data) {
    const date = (r.run_day ?? '').substring(0, 10)
    const plat = r.platform ?? 'Unknown'
    if (!byDayPlatform.has(date)) byDayPlatform.set(date, new Map())
    const dm = byDayPlatform.get(date)!
    const cur = dm.get(plat) ?? { total: 0, clay: 0, cited: 0, withCit: 0, claygent: 0, posit: 0, neg: 0, sentSum: 0, sentCount: 0, followup: 0 }
    cur.total += r.total_responses ?? 0
    cur.clay += r.clay_mentioned ?? 0
    cur.cited += r.clay_cited_responses ?? 0
    cur.withCit += r.total_with_citations ?? 0
    cur.claygent += r.claygent_mentioned ?? 0
    cur.followup += r.clay_followup ?? 0
    dm.set(plat, cur)
  }

  for (const [, dm] of byDayPlatform) {
    for (const [plat, m] of dm) {
      if (!m.total) continue
      const cur = byPlatform.get(plat) ?? { vis: 0, cit: 0, mcp: 0, rec: 0, days: 0, total: 0 }
      cur.vis += (m.clay / m.total) * 100
      cur.cit += m.withCit > 0 ? (m.cited / m.withCit) * 100 : 0
      cur.mcp += (m.claygent / m.total) * 100
      cur.rec += (m.followup / m.total) * 100
      cur.days++
      cur.total += m.total
      byPlatform.set(plat, cur)
    }
  }

  const platformRows = [...byPlatform.entries()].map(([platform, s]) => ({
    platform,
    avg_visibility_rate: s.days > 0 ? +(s.vis / s.days).toFixed(1) : 0,
    avg_citation_rate: s.days > 0 ? +(s.cit / s.days).toFixed(1) : 0,
    avg_claymcp_rate: s.days > 0 ? +(s.mcp / s.days).toFixed(1) : 0,
    avg_recommendation_rate: s.days > 0 ? +(s.rec / s.days).toFixed(1) : 0,
  }))

  // --- Competitor trends ---
  const compByDay = new Map<string, Map<string, number>>()
  const compTotals = new Map<string, number>()

  if (competitorRes.data) {
    for (const r of competitorRes.data) {
      const date = (r.run_day ?? '').substring(0, 10)
      const comp = r.competitor_name ?? 'Unknown'
      const count = r.mention_count ?? 0

      if (!compByDay.has(date)) compByDay.set(date, new Map())
      const dm = compByDay.get(date)!
      dm.set(comp, (dm.get(comp) ?? 0) + count)

      compTotals.set(comp, (compTotals.get(comp) ?? 0) + count)
    }
  }

  const topComps = [...compTotals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name]) => name)

  const competitorRows = [...compByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dm]) => {
      const row: Record<string, string | number> = { date }
      for (const comp of topComps) {
        row[comp] = dm.get(comp) ?? 0
      }
      return row
    })

  // --- Citation domains ---
  const domainTotals = new Map<string, number>()

  if (domainRes.data) {
    for (const r of domainRes.data) {
      const domain = r.domain ?? 'Unknown'
      domainTotals.set(domain, (domainTotals.get(domain) ?? 0) + (r.response_count ?? 0))
    }
  }

  const topDomains = [...domainTotals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([domain, total_citations]) => ({ domain, total_citations }))

  // --- Positioning snippets (sample of recent) ---
  const positioningSnippets = (positioningRes.data ?? [])
    .map(r => ({
      date: (r.run_day ?? '').substring(0, 10),
      platform: r.platform,
      topic: r.topic,
      snippet: (r.snippet ?? '').substring(0, 400),
    }))

  // --- Recent past insights (for context / deduplication) ---
  const pastInsights = (recentInsightsRes.data ?? []).map(r => ({
    date: r.run_date,
    headline: r.insight_text,
    explanation: (r.supporting_data as { explanation?: string } | null)?.explanation ?? '',
  }))

  const userContent =
    `DAILY METRICS (last 7 days, all platforms combined):\n${JSON.stringify(dailyRows, null, 2)}\n\n` +
    `PLATFORM BREAKDOWN (avg rates per platform over 7 days):\n${JSON.stringify(platformRows, null, 2)}\n\n` +
    `COMPETITOR MENTION COUNTS BY DAY (top 10 competitors):\n${JSON.stringify(competitorRows, null, 2)}\n\n` +
    `TOP CITED DOMAINS (7-day total):\n${JSON.stringify(topDomains, null, 2)}\n\n` +
    `POSITIONING SNIPPETS (sample of recent AI responses where Clay was mentioned — what AI platforms are actually saying):\n${JSON.stringify(positioningSnippets, null, 2)}\n\n` +
    `RECENT PAST INSIGHTS (last 7 days — do not repeat or contradict these):\n${JSON.stringify(pastInsights, null, 2)}`

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system:
        `You are an analyst reviewing AI engine optimization (AEO) data for Clay (clay.com). ` +
        `You have 7 days of metrics covering Clay's visibility, citations, and competitive positioning across AI platforms.\n\n` +
        `IMPORTANT CONTEXT: The same prompts are intentionally run on every platform in equal volume. ` +
        `Platform prompt counts being equal is BY DESIGN — never cite platform volume as an insight. ` +
        `The only meaningful platform signal is when Clay's RATES (visibility %, citation %, recommendation %) ` +
        `differ significantly across platforms, suggesting different retrieval or weighting behavior.\n\n` +
        `You have six data sources to draw from:\n` +
        `1. DAILY METRICS — Clay's visibility, citation, claymcp, recommendation, and sentiment rates per day\n` +
        `2. PLATFORM BREAKDOWN — how Clay's rates compare across AI platforms (e.g. Claude vs ChatGPT vs Perplexity)\n` +
        `3. COMPETITOR MENTIONS — daily mention counts for the top 10 competitors\n` +
        `4. CITED DOMAINS — which domains AI platforms cite most when Clay is mentioned\n` +
        `5. POSITIONING SNIPPETS — verbatim excerpts of what AI platforms actually say about Clay when they mention it; use these to understand the narrative, framing, and how Clay is positioned relative to competitors\n` +
        `6. RECENT PAST INSIGHTS — headlines and explanations from the last 7 days; do not repeat or contradict any of these\n\n` +
        `Find ONE non-obvious insight using this priority order:\n` +
        `1. Narrative tension — two metrics moving in opposite directions (e.g. visibility up but citations down, Clay visible but competitors surging)\n` +
        `2. Positioning signal — something surprising in the snippets about how AI platforms frame Clay: a recurring theme, a capability being over- or under-emphasized, or a competitor framing that Clay should own\n` +
        `3. Competitive shift — a competitor gaining or losing ground relative to Clay's own trend\n` +
        `4. Citation gap — Clay visible but under-cited, or a domain rising or falling in the citation rankings\n` +
        `5. Ratio shift — relationship between two metrics changing over the 7 days\n` +
        `6. Pattern break — something trending one direction for 3+ days then reversing\n` +
        `7. Platform rate divergence — Clay's visibility or citation RATE differs meaningfully across platforms\n\n` +
        `Rules:\n` +
        `- Never mention prompt volume or query counts between platforms — it is always equal by design\n` +
        `- No generic observations ("Clay has strong visibility" is not an insight)\n` +
        `- Never say "it appears", "it seems", or "interesting"\n` +
        `- Do not repeat or directly reference any headline from RECENT PAST INSIGHTS\n` +
        `- Always end with a strategic question or actionable hypothesis\n` +
        `- Be specific with numbers and dates\n\n` +
        `Respond ONLY with valid JSON, no markdown, no preamble:\n` +
        `{\n` +
        `  "headline": "one punchy sentence under 15 words",\n` +
        `  "explanation": "2-3 sentences max, specific numbers and dates",\n` +
        `  "implication": "one strategic question or actionable hypothesis"\n` +
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
          days: dailyRows.length,
          platform_breakdown: platformRows,
          top_competitors: topComps,
          top_domains: topDomains.slice(0, 5).map(d => d.domain),
          positioning_snippets_count: positioningSnippets.length,
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
