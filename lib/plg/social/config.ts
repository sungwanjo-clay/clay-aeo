/**
 * Social video (YouTube) tab: channels, goals and the rules behind each metric.
 * Human-readable version: docs/social-metrics.md (keep in sync).
 */

export interface CreatorChannel {
  id: 'peter' | 'payton' | 'eric'
  label: string
  /** YouTube channel id; null = not connected yet (shown greyed out). */
  youtubeId: string | null
  handle: string | null
  /** utm_campaign prefix the creator's tagged links use. */
  campaignPrefix: string | null
}

export const CHANNELS: CreatorChannel[] = [
  { id: 'peter', label: 'Peter Kang', youtubeId: 'UC1C7lmXOfNHlS2cORnPbgaA', handle: '@peterfromclay', campaignPrefix: 'pk_yt_' },
  { id: 'payton', label: 'Payton', youtubeId: null, handle: null, campaignPrefix: null },
  { id: 'eric', label: 'Eric', youtubeId: null, handle: null, campaignPrefix: null },
]

/** Each video is measured over its first N days after publish. */
export const COHORT_DAYS = 28
export const ACTIVATION_DAYS = 7

/** Step goals from the planning model. Rate = step ÷ the step above it. */
export const STEP_GOALS = {
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
 * link goes here. None of Peter's current videos do.
 * TODO: confirm the startup offer page URL and whether clay.link/pkytcohorts
 * redirects to it (clay.link is blocked by the network policy).
 */
export const OFFER_PAGE_PATTERNS: RegExp[] = []

/** Metrics that need Peter's own YouTube authorization (Reporting API channel_reach_basic_a1). */
export const NOT_CONNECTED = {
  label: 'Not connected',
  why: 'Needs the channel owner to authorize the YouTube Reporting API (channel_reach_basic_a1: video_thumbnail_impressions, video_thumbnail_impressions_ctr). A new job backfills 30 days; first files arrive within 48 hours.',
} as const

export const TIER_LABELS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Untiered'] as const
