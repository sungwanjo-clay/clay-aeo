/**
 * SLG pipeline sourced by PLG plays (Workspaces tab). Read-only Sigma (Snowflake) query, aggregate rows only.
 *
 * Same base and definitions as the SLG Team Pulse dashboard (DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL, one row per SLG
 * touchpoint with its 1:1 sourced new-business opp; touchpoints since 2025-01-01):
 *   S1        opp entered Stage 1, or went straight to S2; dated LEAST(S1, S2) for S2 opps, else S1
 *   S2        IS_TIED_TO_S2_OPP = 1, dated by OPP_STAGE_TWO_ENTER_TIMESTAMP
 *   Pipeline  OPP_CURRENT_AMOUNT on those S2s
 *   MQAL      IS_NEW_BUSINESS_MQAL_OPP_CONVERSION_ELIGIBLE_90_DAY_REFRESH = 1, dated by the touchpoint
 *   Team      every channel except Partner Referral and Sales Outbound
 *
 * Not shown on the dashboard (removed until attribution is agreed with the SLG team). PLG-sourced = the subset whose sourcing touchpoint is a GTM play triggered by product behavior (PLG_PLAYS below): a
 * workspace creator or self-serve account was added to the play's Salesforce campaign and responded. It is part of
 * the team number (Hybrid Outbound), never added to it, and moves no credit between channels.
 *
 * Rows: k = team | plg, b = range label "<start>~<end>", ev = mqal | s1 | s2, d = '' (team) or group|campaign (plg),
 * n = count, amt = pipeline (s2 only).
 */
import type { ISODate } from '../dates'
import { rangeTable } from '../offline'

export const SLG_TABLES = {
  touchpoints: '4d8a7488-9cde-4f4f-b451-a712f4e83183', // DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL
}
const t = (id: string) => `"connection"."${id}"`

/** Campaign-name rules (case-insensitive LIKE) for GTM plays triggered by product behavior. Exclusions win. */
export const PLG_PLAYS = {
  signup: {
    label: 'New signups',
    def: 'Workspace creators, activated workspaces and trial users',
    like: ['%workspace creat%', '%activated workspace%', '%trial conversion%', '%trial grads%'],
  },
  expansion: {
    label: 'Self-serve accounts',
    def: 'Paying self-serve accounts: usage, credit pacing, top-ups and upgrades',
    like: ['%self-serve%', '%ss to ent%', '%top ups%', '%credit pacing%', '%high pacing%', '%credit maxing%', '%usage expansion%',
      '%promising paid%', '%promising new launch%', '%new promising launch%', '%re-engaging workspace%', '%plg one-off%'],
  },
  /** Mixed audiences (demo requesters and workspace creators together) are left out, so the number stays conservative. */
  exclude: ['%reheat%', '%re-heat%'],
  touchpointType: 'GTM Play HRE',
} as const
export type PlgGroup = 'signup' | 'expansion'

const likeAny = (col: string, xs: readonly string[]) => xs.map(x => `${col} LIKE '${x.replace(/'/g, "''")}'`).join(' OR ')

export function slgSql(ranges: readonly (readonly [ISODate, ISODate])[]): string {
  const camp = `LOWER(COALESCE(tp."CAMPAIGN_NAME", ''))`
  return `WITH rng AS (${rangeTable(ranges)}),
tp AS (
  SELECT tp."CAMPAIGN_NAME" AS "camp", tp."IS_TIED_TO_S2_OPP" AS "s2f", tp."OPP_CURRENT_AMOUNT" AS "amt",
         tp."IS_NEW_BUSINESS_MQAL_OPP_CONVERSION_ELIGIBLE_90_DAY_REFRESH" AS "mqal",
         CAST(tp."TOUCHPOINT_TIMESTAMP_UTC" AS date) AS "tpd",
         CAST(CASE WHEN tp."IS_TIED_TO_S2_OPP" = 1 THEN LEAST(COALESCE(tp."OPP_STAGE_ONE_ENTER_TIMESTAMP", tp."OPP_STAGE_TWO_ENTER_TIMESTAMP"), tp."OPP_STAGE_TWO_ENTER_TIMESTAMP")
                   ELSE tp."OPP_STAGE_ONE_ENTER_TIMESTAMP" END AS date) AS "s1d",
         CAST(tp."OPP_STAGE_TWO_ENTER_TIMESTAMP" AS date) AS "s2d",
         CASE WHEN tp."TOUCHPOINT_TYPE" <> '${PLG_PLAYS.touchpointType}' OR ${likeAny(camp, PLG_PLAYS.exclude)} THEN NULL
              WHEN ${likeAny(camp, PLG_PLAYS.signup.like)} THEN 'signup'
              WHEN ${likeAny(camp, PLG_PLAYS.expansion.like)} THEN 'expansion' END AS "grp"
  FROM ${t(SLG_TABLES.touchpoints)} tp
  WHERE tp."TOUCHPOINT_TIMESTAMP_UTC" >= '2025-01-01' AND COALESCE(tp."DIRECT_CHANNEL_CATEGORY", '') NOT IN ('Partner Referral', 'Sales Outbound')
),
ev AS (
  SELECT 'mqal' AS "ev", "tpd" AS "day", "grp", "camp", 0 AS "amt" FROM tp WHERE "mqal" = 1
  UNION ALL SELECT 's1', "s1d", "grp", "camp", 0 FROM tp WHERE "s1d" IS NOT NULL
  UNION ALL SELECT 's2', "s2d", "grp", "camp", COALESCE("amt", 0) FROM tp WHERE "s2f" = 1 AND "s2d" IS NOT NULL
)
SELECT 'team' AS "k", rng."lbl" AS "b", ev."ev", '' AS "d", COUNT(*) AS "n", SUM(ev."amt") AS "amt"
FROM ev JOIN rng ON ev."day" BETWEEN rng."rs" AND rng."re" GROUP BY rng."lbl", ev."ev"
UNION ALL
SELECT 'plg', rng."lbl", ev."ev", ev."grp" || '|' || COALESCE(ev."camp", ''), COUNT(*), SUM(ev."amt")
FROM ev JOIN rng ON ev."day" BETWEEN rng."rs" AND rng."re" WHERE ev."grp" IS NOT NULL GROUP BY rng."lbl", ev."ev", ev."grp", ev."camp"`
}
