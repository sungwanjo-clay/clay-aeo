/**
 * PLG Weekly Metrics — static configuration.
 *
 * Everything that is a business decision (quarter calendar, goals, channel
 * grouping, tier fallback, guardrail thresholds) lives here so it can be
 * reviewed in one place. Goals can ALSO be overridden at runtime from the
 * Supabase `plg_goals` table (see supabase/plg_schema.sql), which wins over
 * the defaults below. That lets the plan owner drop in Q1 2027 targets
 * without a deploy.
 */

export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'] as const
export type Tier = (typeof TIERS)[number]

/**
 * Workspaces whose customer domain doesn't match an SFDC account with a
 * SALES_TIER_C are stored as 'Unassigned' by the ETL and shown as their own
 * "Unmatched" row/column (report-only, no goal). Mostly personal (gmail etc.)
 * domains. Tier columns therefore always sum to the channel total.
 */
export const UNASSIGNED = 'Unassigned'
export const UNMATCHED_LABEL = 'Unmatched'
export const DISPLAY_TIERS = [...TIERS, UNASSIGNED] as const
export type DisplayTier = (typeof DISPLAY_TIERS)[number]

/**
 * Goals are set on HQ workspaces only (CUSTOMER_DOMAIN_QUALITY_SEGMENT =
 * 'non-personal: high quality'), per tier, per quarter. Source: "Q4 PLG
 * Planning" sheet. Tier 4 includes unmatched domains. No channel goals.
 */
export const GOAL_SEGMENT = 'non-personal: high quality'
export const GOAL_TIERS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4 / unmatched'] as const
export type GoalTier = (typeof GOAL_TIERS)[number]

export interface QuarterGoals {
  /** Display label, e.g. 'Q4'. */
  label: string
  /** Inclusive ISO dates (UTC). */
  start: string
  end: string
  /** Whole-quarter HQ-workspace goal per tier; prorated evenly per day for any date range. */
  tierQuarter: Record<GoalTier, number>
}

export const DEFAULT_QUARTERS: QuarterGoals[] = [
  {
    label: 'Q4',
    start: '2026-11-01',
    end: '2027-01-31',
    tierQuarter: { 'Tier 1': 2_009, 'Tier 2': 11_207, 'Tier 3': 5_232, 'Tier 4 / unmatched': 34_952 }, // = 53,400
  },
]

export const quarterTotal = (q: QuarterGoals) => GOAL_TIERS.reduce((a, t) => a + q.tierQuarter[t], 0)

// ── Channel grouping ─────────────────────────────────────────────────────────

export type ChannelGroupId = 'oauth' | 'organic' | 'paid' | 'unattributed'

export const CHANNEL_GROUPS: { id: ChannelGroupId; label: string }[] = [
  { id: 'oauth',        label: 'OAuth' },
  { id: 'organic',      label: 'Organic' },
  { id: 'paid',         label: 'Paid & Earned Campaigns' },
  { id: 'unattributed', label: 'Unattributed' },
]

/** BLENDED_ATTRIBUTION_CHANNEL_CATEGORY → display group. */
const CATEGORY_TO_GROUP: Record<string, ChannelGroupId> = {
  'OAuth': 'oauth',
  'Organic': 'organic',
  'Paid Ads': 'paid',
  'Influencer': 'paid',
  'Marketing Content': 'paid',
  'Marketing Outbound': 'paid',
  'Sales Outbound': 'paid',
  'Hybrid Outbound': 'paid',
  'Field Marketing': 'paid',
  'Paid Physical Format': 'paid',
  'undefined': 'unattributed',
  'unattributable': 'unattributed',
  'not tiered': 'unattributed',
}

/**
 * Any category we don't recognise lands in Unattributed so totals always
 * reconcile; it still shows as its own row so it's visible.
 */
export function groupForCategory(category: string | null): ChannelGroupId {
  return CATEGORY_TO_GROUP[category ?? 'undefined'] ?? 'unattributed'
}

/** Shorter display names for a few long channel labels (matches the mock). */
export const CHANNEL_DISPLAY: Record<string, string> = {
  'Marketing Content: Clay Education': 'Marketing Content: Clay Ed',
  'Paid Physical Format: Out of Home': 'Paid Physical: OOH',
}

// ── Pacing thresholds ────────────────────────────────────────────────────────

export const PACING = {
  onTrack: 0.95,  // ≥ 95%
  atRisk: 0.90,   // 90–95%; below is Behind
  barMax: 1.20,   // bar scale 0–120% of goal
} as const

// ── Data-quality guardrails ──────────────────────────────────────────────────

export const GUARDRAILS = {
  /** Days after a period closes before it's considered settled. */
  settleDays: 14,
  /** Restatement of a closed week by more than this fraction is logged. */
  restatementPct: 0.03,
  /** Classification-shift detector. */
  hqShareShiftPp: 15,          // |Δ HQ share of non-personal| ≥ 15pp
  lowQualityShareOfTotal: 0.15, // or low-Q share of total > 15%
  /** Unattributable spike detector (single day). */
  unattributableDailyShare: 0.12,
  /** Commentary picks movers with |Δ| at or above this (weekly). */
  commentaryMinAbsDelta: 30,
  /** Domain-quality rows below this count are suppressed (except core four). */
  domainMinCount: 5,
} as const

export const KNOWN_INCIDENTS: { dates: string[]; label: string }[] = [
  {
    dates: ['2026-10-15', '2026-10-16', '2026-10-20'],
    label: 'Session-matching regression (unattributable spike)',
  },
]
