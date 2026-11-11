import { NextResponse } from 'next/server'
import { runPlgEtl } from '@/lib/plg/etl'
import { isCronOrSession } from '@/lib/plg/auth'
import { snowflakeConfigured } from '@/lib/plg/snowflake'
import { isValidISO } from '@/lib/plg/dates'

export const maxDuration = 300

/**
 * Nightly PLG ETL: Snowflake → Supabase (see lib/plg/etl.ts).
 * Called by Vercel cron. Manual backfill: GET /api/plg/refresh?from=2025-10-01
 */
export async function GET(req: Request) {
  if (!(await isCronOrSession(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!snowflakeConfigured()) {
    return NextResponse.json({ ok: false, error: 'Snowflake env vars not set (SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PRIVATE_KEY)' }, { status: 500 })
  }
  const from = new URL(req.url).searchParams.get('from')
  const result = await runPlgEtl({ from: isValidISO(from) ? from : undefined })
  if (!result.ok) console.error('[plg/refresh]', result.error)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
