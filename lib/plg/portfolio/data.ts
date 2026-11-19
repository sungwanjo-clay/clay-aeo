/**
 * Portfolio tab data: what scripts/sync-portfolio.mjs writes into the artifact db (collection `portfolio`),
 * read from the Supabase dashboard views. All counts are companies, from the last COMPLETE non-staging
 * snapshot. Nothing here queries Sigma; Clay does the Snowflake lookup upstream.
 */
export type Cut = 'partnered' | 'pending' | 'not_partnered'
export type CutFilter = Cut | 'all'

/** One row of dashboard.portfolio_totals or dashboard.firm_penetration. */
export type Counts = {
  portfolio: number
  with_workspace: number
  no_exact_match: number
  workspace_unknown: number
  ever_paid: number
  paying_now: number
  paying_unknown: number
  eligible_to_date: number
  redeemed: number
  redemption_connected: boolean | null
  shared_by_partner?: number
}
export type TotalsRow = Counts & { snapshot_date: string; cut: CutFilter }
export type FirmRow = Counts & { snapshot_date: string; firm_id: string; partnership_cut: Cut }

export type Firm = {
  firm_id: string
  name: string
  firm_type: 'vc_fund' | 'accelerator' | 'other'
  partnership_cut: Cut
  on_proven_tab: boolean
  stage_focus: string | null
  region: string | null
  roster_refreshed_at: string | null
}

export type LookupStatus = 'matched' | 'no_exact_match' | 'needs_review' | 'failed' | 'missing'

/** One company in the latest snapshot (members), or a roster company outside the denominator. */
export type CompanyRow = {
  id: string
  name: string
  domain: string | null
  firms: string[]          // firm_ids
  cuts: Cut[]
  inDenominator: boolean
  notCountedReason?: 'in_review' | 'workspace_match_only' | 'not_verified'
  lookup: LookupStatus | null       // null for companies outside the snapshot
  hasWorkspace: boolean | null      // null = unknown
  workspaces: number | null
  everPaid: boolean | null
  payingNow: boolean | null
  redemption: 'not_connected' | 'redeemed' | 'not_redeemed'
  eligibleToDate: boolean
  stage: string | null
  lastRoundAt: string | null
}

export type PortfolioMeta = {
  version: 1
  syncedAt: string
  latest: { snapshot_date: string; completed_at: string } | null
  previous: string | null           // snapshot_date of the complete week before latest, for deltas
  snapshots: { snapshot_date: string; completed_at: string }[]
  totals: TotalsRow[]               // latest + previous
  firmRows: FirmRow[]               // latest + previous
  firms: Firm[]                     // every firm in the list, with or without a roster
  eligibilityConnected: boolean     // any eligibility row in the latest snapshot
  companyChunks: number
  openWeek?: { snapshot_date: string; lookups: number } | null   // the week being built, before it closes
  sources?: SourceCoverage[]        // verified companies per firm × source
  sourceTotals?: Record<string, number>   // unique verified companies per firm, across all sources
  sourceRuns?: SourceRun[]          // latest run per firm × source
}

export type SourceCoverage = { firm_id: string; source: string; companies: number; only: number }
export type SourceRun = { firm_id: string; source: string; status: string; companies: number; cap_hit: boolean; error: string | null; recorded_at: string }

/** Sources in display order, with plain names. Salesforce is a lookup of our CRM, not a portfolio source. */
export const SOURCE_LABEL: Record<string, string> = {
  official_portfolio: 'Firm website', official_page: 'Firm pages', crunchbase: 'Crunchbase', pitchbook: 'PitchBook',
  dealroom: 'Dealroom', google: 'News search', linkedin: 'LinkedIn', x: 'X', salesforce: 'Salesforce',
}

export type PortfolioData = { meta: PortfolioMeta; companies: CompanyRow[] }

export const CUT_LABEL: Record<CutFilter, string> = {
  partnered: 'Partnered', pending: 'Pending approval', not_partnered: 'Not partnered', all: 'All firms',
}

export const rate = (n: number, d: number) => (d > 0 ? n / d : null)

/** Counts for the strip: one firm, or a cut. */
export function countsFor(meta: PortfolioMeta, date: string | null, cut: CutFilter, firmId: string | null): Counts | null {
  if (!date) return null
  if (firmId) return meta.firmRows.find(r => r.snapshot_date === date && r.firm_id === firmId) ?? null
  return meta.totals.find(r => r.snapshot_date === date && r.cut === cut) ?? null
}

export type StatusFilter = 'All' | 'Not on Clay' | 'Recently funded · not on Clay' | 'With a workspace' | 'Paying now' | 'Ever paid' | 'Lookup unknown' | 'Eligible' | 'Redeemed' | 'Not in denominator'
export const STATUS_FILTERS: StatusFilter[] = ['All', 'Not on Clay', 'Recently funded · not on Clay', 'With a workspace', 'Paying now', 'Ever paid', 'Lookup unknown', 'Eligible', 'Redeemed', 'Not in denominator']

/** A round in the 12 months before the snapshot week. */
export function recentlyFunded(r: CompanyRow, asOf: string | null): boolean {
  if (!r.lastRoundAt || !asOf) return false
  const d = new Date(asOf + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1)
  return r.lastRoundAt >= d.toISOString().slice(0, 10)
}

export function filterCompanies(rows: CompanyRow[], o: { cut: CutFilter; firmId: string | null; status: StatusFilter; q: string; asOf?: string | null }) {
  const q = o.q.trim().toLowerCase()
  return rows.filter(r => {
    if (o.firmId ? !r.firms.includes(o.firmId) : o.cut !== 'all' && !r.cuts.includes(o.cut)) return false
    if (q && !(r.name.toLowerCase().includes(q) || (r.domain ?? '').includes(q))) return false
    switch (o.status) {
      case 'All': return r.inDenominator
      case 'Not on Clay': return r.inDenominator && r.hasWorkspace === false
      case 'Recently funded · not on Clay': return r.inDenominator && r.hasWorkspace === false && recentlyFunded(r, o.asOf ?? null)
      case 'With a workspace': return r.inDenominator && r.hasWorkspace === true
      case 'Paying now': return r.inDenominator && r.payingNow === true
      case 'Ever paid': return r.inDenominator && r.everPaid === true
      case 'Lookup unknown': return r.inDenominator && r.hasWorkspace === null
      case 'Eligible': return r.inDenominator && r.eligibleToDate
      case 'Redeemed': return r.inDenominator && r.redemption === 'redeemed'
      case 'Not in denominator': return !r.inDenominator
    }
  })
}

export function csvOf(rows: CompanyRow[], firmName: (id: string) => string): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['company', 'domain', 'firms', 'in_denominator', 'lookup_status', 'has_workspace', 'workspaces', 'ever_paid', 'paying_now', 'eligible_to_date', 'redemption', 'stage', 'last_round_at']
  const lines = rows.map(r => [r.name, r.domain, r.firms.map(firmName).join('; '), r.inDenominator ? 'yes' : (r.notCountedReason ?? 'no'),
    r.lookup, r.hasWorkspace, r.workspaces, r.everPaid, r.payingNow, r.eligibleToDate, r.redemption, r.stage, r.lastRoundAt].map(esc).join(','))
  return [head.join(','), ...lines].join('\n') + '\n'
}
