/**
 * Prints the SQL for the dashboard's default "Last 7 days" view, exactly as the page builds it, so a scheduled job
 * can run the same queries and store the results as the page's saved copy (db collection `cache`).
 *   node scripts/refresh-cache.mjs sql <dataEnd> <youtubeDir>
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveQuarters } from '@/lib/plg/compute'
import { DEFAULT_QUARTERS } from '@/lib/plg/config'
import { todayUTC } from '@/lib/plg/dates'
import { planDashboard } from '@/lib/plg/plan'
import { SIGMA, dashboardSql, latestDaySql } from '@/lib/plg/sigma'
import { channelFallbacks, taggedVideos, type YtChannelDoc } from '@/lib/plg/social/compute'
import { socialSql } from '@/lib/plg/social/sql'
import { startupSql } from '@/lib/plg/startup/sql'

export function latest() { return { connectionId: SIGMA.connectionId, sql: latestDaySql(todayUTC()) } }

export function defaults(dataEnd: string, ytDir: string) {
  // Goal overrides only change the plan's quarter boundaries; the default 7-day queries don't depend on them.
  const plan = planDashboard(new URLSearchParams(''), dataEnd, resolveQuarters(DEFAULT_QUARTERS, []))
  const ranges = { cur: plan.summaries.cur, prev: plan.summaries.prev }
  const yt = readdirSync(ytDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(ytDir, f), 'utf8')) as YtChannelDoc)
  return {
    connectionId: SIGMA.connectionId,
    main: dashboardSql(plan),
    social: socialSql({ cur: ranges.cur, prev: ranges.prev, tagged: taggedVideos(yt, dataEnd), fallbacks: channelFallbacks(yt, dataEnd) }),
    startup: startupSql(ranges),
  }
}
