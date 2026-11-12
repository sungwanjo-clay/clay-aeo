/**
 * Social video (YouTube) tab: channels, goals and the rules behind each metric.
 * Human-readable version: docs/social-metrics.md (keep in sync).
 */

/**
 * Each creator tags links their own way, so matching is configured per channel
 * instead of forcing one UTM scheme:
 *   - Every video's description link with a utm_campaign maps campaign → video.
 *     `requireSource` adds a utm_source condition (Peter: youtube).
 *   - `fallback` recognises the channel's traffic when the campaign is missing
 *     from Snowflake (e.g. cohorts.clay.com pageviews drop utm_campaign). It is
 *     credited to the channel's one linked video when there is exactly one,
 *     otherwise to the channel as a whole. SQL runs against
 *     MARKETING_PAGEVIEWS (pageview) and FIRST_TOUCH_ATTRIBUTION (firstTouch).
 */
export interface CreatorChannel {
  id: 'peter' | 'payton' | 'eric'
  label: string
  /** YouTube channel id; null = not connected yet (shown greyed out). */
  youtubeId: string | null
  handle: string | null
  /** utm_campaign prefix the creator uses on every video (flags tagged-but-unmapped campaigns). */
  campaignPrefix: string | null
  requireSource: string | null
  fallback: { pageview: string; firstTouch: string; note: string } | null
}

export const CHANNELS: CreatorChannel[] = [
  { id: 'peter', label: 'Peter Kang', youtubeId: 'UC1C7lmXOfNHlS2cORnPbgaA', handle: '@peterfromclay',
    campaignPrefix: 'pk_yt_', requireSource: 'youtube', fallback: null },
  { id: 'payton', label: 'Payton', youtubeId: 'UCinB0eB_WDaCTESqfQf_40A', handle: '@itsnotmybusiness',
    campaignPrefix: null, requireSource: null,
    fallback: {
      // Link: cohorts.clay.com/wedge?utm_source=other&utm_medium=marketingcontentowned&utm_campaign=not-my-business.
      // Pageviews and first touch keep source + medium but lose the campaign on cohorts.clay.com.
      pageview: `(p."UTM_MEDIUM" = 'marketingcontentowned' AND (LOWER(p."UTM_CAMPAIGN") = 'not-my-business' OR (p."UTM_SOURCE" = 'other' AND p."PATH" = '/wedge' AND p."REFERRER_RAW" ILIKE '%youtu%')))`,
      firstTouch: `(f."UTM_MEDIUM" = 'marketingcontentowned' AND (LOWER(f."UTM_CAMPAIGN") = 'not-my-business' OR (f."UTM_SOURCE" = 'other' AND (f."RAW_REFERRER" ILIKE '%youtu%' OR f."PATH" ILIKE '/wedge%'))))`,
      note: 'Matched on utm_medium=marketingcontentowned + the /wedge offer page + a YouTube referrer, because Snowflake drops utm_campaign on cohorts.clay.com. Form submits keep the campaign (not-my-business).',
    } },
  { id: 'eric', label: 'Eric', youtubeId: null, handle: null, campaignPrefix: null, requireSource: null, fallback: null },
]

/** Each video is measured over its first N days after publish. */
export const COHORT_DAYS = 28
export const ACTIVATION_DAYS = 7

/** Step goals from the planning model. Rate = step ÷ the step above it. */
export const STEP_GOALS = {
  /** Placeholder in the mock: all new workspaces ÷ email captures. Used while opens/clicks aren't connected. */
  newWorkspaceOfCaptures: 0.1,
  viewRate: 0.06,      // impressions → views (impression CTR). Weighted by impressions across videos.
  viewToVisit: 0.5,
  capture: 0.2,
  qualified: 0.4,
  open: 0.5,
  click: 0.4,
  newWorkspace: 0.6,
} as const

/**
 * Link destinations that count as the startup offer page. Email-capture
 * steps (captures, qualified, opens, clicks) are shown only for videos whose
 * link goes here: cohorts.clay.com/wedge (form events tag it
 * clay_for_startups_webpage / landing / wedge). Payton's video links it; Peter's
 * clay.link/pkytcohorts resolves to the cohorts.clay.com home page, not /wedge.
 */
export const OFFER_PAGE_PATTERNS: RegExp[] = [/^cohorts\.clay\.com\/wedge/]

/** Metrics that need Peter's own YouTube authorization (Reporting API channel_reach_basic_a1). */
export const NO_ANALYTICS = 'Needs Viewer access to the channel in YouTube Studio for the Analytics API (views, watch time, % viewed). The Data API only gives lifetime public view counts.'
export const NOT_CONNECTED = {
  label: 'Not connected',
  why: 'Needs the channel owner to authorize the YouTube Reporting API (channel_reach_basic_a1: video_thumbnail_impressions, video_thumbnail_impressions_ctr). A new job backfills 30 days; first files arrive within 48 hours.',
} as const

export const TIER_LABELS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Untiered'] as const
