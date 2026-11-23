/**
 * Prints the SQL for the dashboard's saved views (every preset × comparison, see lib/plg/offline.ts), built with the
 * page's own SQL builders, so a scheduled job can store the results as the page's saved copy (db collection `cache`).
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
import { tier4ListSql, tier4Sql } from '@/lib/plg/slg/tier4sql'
import { croSql, croTrendSql } from '@/lib/plg/cro/sql'
import { creatorsSql } from '@/lib/plg/creators/sql'
import { dailySql, savedDailyRange } from '@/lib/plg/daily'
import { OFFLINE_COMBOS, comboQs, rangeLabel, savedRanges } from '@/lib/plg/offline'

export { validate } from '@/lib/plg/contracts'

export function latest() { return { connectionId: SIGMA.connectionId, sql: latestDaySql(todayUTC()) } }

/**
 * Every preset × comparison for each tab, one labelled query per tab (lib/plg/offline.ts). The page uses the same
 * default quarters (no goal overrides) when it reads these back, so its plans match.
 */
export function defaults(dataEnd: string, ytDir: string) {
  const quarters = resolveQuarters(DEFAULT_QUARTERS, [])
  // Channel documents only: the collection also holds thumbs-<channelId> documents (images, no videos list).
  const yt = readdirSync(ytDir).filter(f => f.endsWith('.json')).map(f => {
    const j = JSON.parse(readFileSync(join(ytDir, f), 'utf8'))
    return (j && 'data' in j && Object.keys(j).length <= 3 ? j.data : j) as YtChannelDoc
  }).filter(d => d && Array.isArray(d.videos))
  const tagged = taggedVideos(yt, dataEnd), fallbacks = channelFallbacks(yt, dataEnd)
  const plans = OFFLINE_COMBOS.map(c => planDashboard(new URLSearchParams(comboQs(c.preset, c.compare)), dataEnd, quarters))
  const ranges = savedRanges(plans)
  const base = plans[0]
  return {
    connectionId: SIGMA.connectionId,
    // Range labels each saved copy covers (written into its header; the page checks a view's ranges against them).
    ranges: {
      main: [...new Set(plans.flatMap(p => Object.values(p.summaries).map(rangeLabel)))],
      social: [...new Set(ranges.map(rangeLabel))],
      startup: [...new Set(ranges.map(rangeLabel))],
      tier4: [...new Set(ranges.map(rangeLabel))],
      cro: [...new Set(ranges.map(rangeLabel))],
    },
    main: dashboardSql(base, plans),
    social: socialSql({ cur: base.summaries.cur, prev: base.summaries.prev, tagged, fallbacks, ranges }),
    startup: startupSql({ cur: base.summaries.cur, prev: base.summaries.prev, ranges }),
    tier4: tier4Sql(ranges),
    // Not range-dependent: accounts with a Tier 4 touchpoint in the 180 days to dataEnd.
    tier4list: tier4ListSql(dataEnd),
    cro: croSql(ranges, dataEnd),
    // Not range-dependent: the last 26 weeks to dataEnd.
    crotrend: croTrendSql(dataEnd),
    // Not range-dependent: creator program links per week, Apr 6 (at most 39 weeks back) to dataEnd.
    creators: creatorsSql(dataEnd),
    // Not range-dependent: every day any preset × comparison shows, for the cumulative chart's metric picker.
    daily: dailySql(...savedDailyRange(plans), dataEnd),
  }
}
