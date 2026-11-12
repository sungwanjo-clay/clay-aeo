/**
 * Social video (YouTube) tab: channel registry + metric definitions.
 * Definitions are written out in docs/social-metrics.md; keep both in sync.
 */

export interface CreatorChannel {
  id: 'peter' | 'payton' | 'eric' | 'clay'
  label: string
  /** YouTube channel id; null = not connected yet. */
  youtubeId: string | null
  handle: string | null
  /** SQL condition on DBT.PROD.MARKETING_PAGEVIEWS (alias-free column names) marking this creator's link clicks. */
  visitRule: string | null
  /** Included in "All channels" creator totals. */
  creator: boolean
}

/**
 * Offer page (cohorts.clay.com/wedge, live 2026-10-28) visits tagged
 * utm_medium=marketingcontentowned with a YouTube referrer. Only Peter's
 * descriptions link it (via clay.link/pkytcohorts), so it is credited to him.
 * Medium confidence until that short link carries a pk_yt_* utm_campaign.
 */
const PETER_OFFER = `("PATH" = '/wedge' AND "UTM_MEDIUM" = 'marketingcontentowned' AND "REFERRER_RAW" ILIKE '%youtu%')`

export const CHANNELS: CreatorChannel[] = [
  { id: 'peter', label: 'Peter Kang', youtubeId: 'UC1C7lmXOfNHlS2cORnPbgaA', handle: '@peterfromclay',
    visitRule: `("UTM_CAMPAIGN" ILIKE 'pk_yt%' OR ${PETER_OFFER})`, creator: true },
  { id: 'payton', label: 'Payton', youtubeId: null, handle: null, visitRule: null, creator: true },
  { id: 'eric', label: 'Eric', youtubeId: null, handle: null, visitRule: null, creator: true },
  { id: 'clay', label: 'Clay brand channel', youtubeId: 'UCHLTdPgm0KivyFFvKEWEQmQ', handle: '@growwithclay',
    visitRule: `("UTM_CAMPAIGN" ILIKE '2410_yt%' OR "UTM_MEDIUM" = 'video')`, creator: false },
]

/**
 * Every visit to a Clay site that came from YouTube, grouped by how it was
 * linked. Evaluated top to bottom; first match wins.
 */
export const VISIT_GROUPS: { id: string; label: string; rule: string }[] = [
  { id: 'peter', label: 'Peter Kang links', rule: CHANNELS[0].visitRule! },
  { id: 'clay', label: 'Clay brand channel links', rule: CHANNELS[3].visitRule! },
  { id: 'affiliate', label: 'Affiliate creators', rule: `"REFERRER" = 'affiliate'` },
  { id: 'paid', label: 'Paid YouTube ads', rule: `"UTM_MEDIUM" IN ('cpc', 'paid', 'youtube')` },
  { id: 'untagged', label: 'Other YouTube links (untagged)', rule: 'TRUE' },
]

/** Base filter: the pageview came from YouTube. */
export const YOUTUBE_VISIT = `("REFERRER_RAW" ILIKE '%youtu%' OR "UTM_SOURCE" ILIKE '%youtu%')`

/** Workspace credited to YouTube by the blended model (same as the Workspaces tab). */
export const YT_WORKSPACE_GROUPS: { id: string; label: string; match: string }[] = [
  { id: 'survey', label: 'Survey answer only (HDYHAU)', match: 'Organic: Social: youtube|hdyhau' },
  { id: 'organic_session', label: 'Organic YouTube session', match: 'Organic: Social: youtube|session' },
  { id: 'affiliate', label: 'Affiliate creators', match: 'Influencer: Affiliate: youtube' },
  { id: 'owned', label: 'Clay-owned links (offer page)', match: 'Marketing Content: Owned: youtube' },
  { id: 'paid', label: 'Paid YouTube ads', match: 'Paid Ads' },
  { id: 'other', label: 'Other', match: '' },
]

/** A new workspace counts for a creator if created within this many days after that visitor's first click. */
export const CREATOR_WINDOW_DAYS = 30
/** Activation counts only within this many days of workspace creation. */
export const ACTIVATION_DAYS = 7

/** Funnel steps we can't measure yet, and what unlocks each. */
export const NOT_TRACKED = [
  { step: 'Impressions & thumbnail click-through', after: 'reach', unlock: 'The channel owner authorizes the YouTube Reporting API (channel_reach_basic_a1). The Analytics API does not expose impressions.' },
  { step: 'Qualified emails', after: 'capture', unlock: 'The offer-page form event (SEGMENT.VERCEL.FORM_SUBMITTED) has no email field; add one, then enrich in Clay.' },
  { step: 'Lifecycle email opens & clicks', after: 'capture', unlock: 'SELECT grant on INFLECTION.INFLECTION.* for the Sigma role.' },
] as const
