import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Thresholds for anomaly detection
const THRESHOLDS = {
  visibility:  { warning: 3,  critical: 6  },  // absolute pp change
  citation:    { warning: 2,  critical: 5  },
  claygent:    { warning: 2,  critical: 5  },
  sentiment:   { warning: 5,  critical: 10 },
  position:    { warning: 0.5, critical: 1 },  // avg position shift
}

type CacheRow = {
  run_day: string
  platform: string
  prompt_type: string
  total_responses: number
  clay_mentioned: number
  clay_cited_responses: number
  total_with_citations: number
  claygent_mentioned: number
  positive_sentiment: number
  sum_position: number
  count_position: number
}

type Anomaly = {
  run_date: string
  metric: string
  platform: string | null
  current_value: number
  previous_value: number
  delta: number
  direction: 'up' | 'down'
  severity: 'warning' | 'critical'
  message: string
}

function rate(num: number, den: number): number | null {
  if (!den) return null
  return (num / den) * 100
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Missing env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const today = new Date().toISOString().split('T')[0]

  // Idempotency: skip if we already ran today
  const { data: existing } = await supabase
    .from('anomalies')
    .select('id')
    .eq('run_date', today)
    .limit(1)
  if (existing?.length) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already ran today' })
  }

  // Fetch last 14 days from cache — benchmark only (the canonical AEO signal)
  const since = new Date()
  since.setDate(since.getDate() - 14)
  const startDay = since.toISOString().split('T')[0]

  const { data: rows, error } = await supabase
    .from('aeo_cache_daily')
    .select('run_day,platform,prompt_type,total_responses,clay_mentioned,clay_cited_responses,total_with_citations,claygent_mentioned,positive_sentiment,sum_position,count_position')
    .gte('run_day', startDay)
    .lte('run_day', today)
    .eq('prompt_type', 'Benchmark')
    .order('run_day', { ascending: true })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ ok: false, error: 'No cache data' }, { status: 404 })

  // Aggregate by day (across all platforms)
  const byDay = new Map<string, { vis: number | null; cit: number | null; claygent: number | null; sent: number | null; pos: number | null }>()
  const dayTotals = new Map<string, { clay: number; cited: number; withCit: number; claygent: number; posSent: number; total: number; posSum: number; posCount: number }>()

  for (const r of rows as CacheRow[]) {
    const d = r.run_day.substring(0, 10)
    const cur = dayTotals.get(d) ?? { clay: 0, cited: 0, withCit: 0, claygent: 0, posSent: 0, total: 0, posSum: 0, posCount: 0 }
    cur.clay += r.clay_mentioned ?? 0
    cur.cited += r.clay_cited_responses ?? 0
    cur.withCit += r.total_with_citations ?? 0
    cur.claygent += r.claygent_mentioned ?? 0
    cur.posSent += r.positive_sentiment ?? 0
    cur.total += r.total_responses ?? 0
    cur.posSum += r.sum_position ?? 0
    cur.posCount += r.count_position ?? 0
    dayTotals.set(d, cur)
  }

  for (const [d, t] of dayTotals) {
    byDay.set(d, {
      vis:      rate(t.clay, t.total),
      cit:      rate(t.cited, t.withCit),
      claygent: rate(t.claygent, t.total),
      sent:     rate(t.posSent, t.total),
      pos:      t.posCount > 0 ? t.posSum / t.posCount : null,
    })
  }

  const days = [...byDay.keys()].sort()
  if (days.length < 2) return NextResponse.json({ ok: true, detected: 0, reason: 'not enough days' })

  const anomalies: Anomaly[] = []

  function check(
    metric: keyof typeof THRESHOLDS,
    day: string,
    prev: number | null,
    curr: number | null,
    label: string
  ) {
    if (prev == null || curr == null) return
    const delta = curr - prev
    const absDelta = Math.abs(delta)
    const t = THRESHOLDS[metric]
    const severity: 'warning' | 'critical' | null =
      absDelta >= t.critical ? 'critical' :
      absDelta >= t.warning  ? 'warning'  : null
    if (!severity) return

    const direction = delta > 0 ? 'up' : 'down'
    const sign = delta > 0 ? '+' : ''
    const unit = metric === 'position' ? '' : '%'
    anomalies.push({
      run_date: day,
      metric: label,
      platform: null,
      current_value: +curr.toFixed(2),
      previous_value: +prev.toFixed(2),
      delta: +delta.toFixed(2),
      direction,
      severity,
      message: `${label} ${direction === 'up' ? 'spiked' : 'dropped'} ${sign}${delta.toFixed(1)}${unit} (${prev.toFixed(1)}${unit} → ${curr.toFixed(1)}${unit}) on ${day}`,
    })
  }

  // Compare each day against the prior day
  for (let i = 1; i < days.length; i++) {
    const day  = days[i]
    const prev = byDay.get(days[i - 1])!
    const curr = byDay.get(day)!

    check('visibility', day, prev.vis,      curr.vis,      'Visibility Rate')
    check('citation',   day, prev.cit,      curr.cit,      'Citation Rate')
    check('claygent',   day, prev.claygent, curr.claygent, 'ClayMCP & Agent Rate')
    check('sentiment',  day, prev.sent,     curr.sent,     'Positive Sentiment')
    check('position',   day, prev.pos,      curr.pos,      'Avg Position')
  }

  if (!anomalies.length) {
    // Still record a sentinel so idempotency check works
    await supabase.from('anomalies').insert({
      run_date: today,
      metric: '__sentinel__',
      message: 'No anomalies detected',
      dismissed: true,
    })
    return NextResponse.json({ ok: true, detected: 0 })
  }

  const { error: insertErr } = await supabase.from('anomalies').insert(
    anomalies.map(a => ({ ...a, detected_at: new Date().toISOString() }))
  )

  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, detected: anomalies.length, anomalies })
}
