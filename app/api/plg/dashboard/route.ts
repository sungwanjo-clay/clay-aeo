import { NextResponse } from 'next/server'
import { loadDashboard, supabaseSource, NoDataError, type PlgSource } from '@/lib/plg/load'

/**
 * GET /api/plg/dashboard?preset=last7|last28|last90|qtd|ytd
 *                       &start=YYYY-MM-DD&end=YYYY-MM-DD   (custom; wins over preset)
 *                       &compare=previous_period|previous_year
 *                       &grain=day|week|month
 * Protected by the site password via proxy.ts.
 */
export async function GET(req: Request) {
  try {
    let source: PlgSource
    if (process.env.NODE_ENV !== 'production' && process.env.PLG_FIXTURE_PATH) {
      const { fixtureSource } = await import('@/lib/plg/fixtureSource')
      source = fixtureSource(process.env.PLG_FIXTURE_PATH)
    } else {
      source = supabaseSource()
    }
    const payload = await loadDashboard(new URL(req.url).searchParams, source)
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[plg/dashboard]', msg)
    return NextResponse.json({ error: msg, noData: e instanceof NoDataError }, { status: e instanceof NoDataError ? 404 : 500 })
  }
}
