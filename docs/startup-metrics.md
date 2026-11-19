# Startup program tab

**Offer page:** www.clay.com/clay-for-startups (`MARKETING_PAGEVIEWS`, site `marketing_website`, including the /fr/ path). The program launched Jul 1, 2026, and no offer has been sent yet.

| Step | Definition | Source |
|---|---|---|
| Visits | Distinct visitors to the page | MARKETING_PAGEVIEWS |
| Email captures | **Not connected.** The Apply button opens a Typeform (clayhq.typeform.com/to/CD561moL) whose responses aren't in Snowflake | — |
| Identified visitors | Visitors whose cookie later shows up signed in to a Clay workspace. Cookies seen in more than 3 workspaces (Clay staff, agencies) and clay.com domains are excluded | COOKIE_TO_WORKSPACE_RELATIONSHIP |
| MQALs | Distinct business domains at a Salesforce Tier 1–3 account among identified visitors. This is the tab's own definition, **not** the SLG hand-raise MQAL | CUSTOMERS.DOMAIN → STG_SALESFORCE__ACCOUNT.SALES_TIER_C |
| MQALs (partner lists) | Not connected: no portfolio lists in Snowflake | — |
| Email sends and opens | Not connected: no offer sent yet, and lifecycle email isn't in Snowflake | — |
| New workspaces | An identified visitor's workspace created within 30 days after their first visit in the period | CUSTOMERS |
| Offer redeemed | Not connected: no offer sent yet | — |
| Activated | First table run within 7 days | FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION |
| Paid | First invoice paid, on any plan (no discount offered yet) | CUSTOMERS |

**Why visitors didn't qualify:** identified visitors are grouped as Tier 4, No Salesforce account, Personal email, Academic, or Invalid or missing domain.

**Paid campaigns:** paid visits are those with a gclid, fbclid or LinkedIn click id, or a paid utm_medium. Spend and cost columns are "Not connected" because there's no ad-spend table.

**Partner penetration:** "Not connected" until the portfolio roster and eligibility snapshot are in Snowflake (see Portfolio penetration below).

## Nov 17 revision

**Tiles:**
- MQALs (Tier 1–3 domains)
- Total new workspaces
- Offer redeemed (Not connected)
- Eligible workspaces

**Funnel steps:**
1. Visits
2. Applications (Not connected: Typeform)
3. New workspaces (Tier 1–3)
4. Total new workspaces
5. Eligible workspaces
6. Email sends (Not connected)
7. Email opens (Not connected)
8. Offer redeemed (Not connected)
9. Activated
10. Paid at discounted price (Not connected)

**Eligible:** a new workspace counts as eligible unless:
- its domain is Tier 4, or
- its domain already had a paid workspace (first invoice) before this workspace was created.

**Removed:**
- The identified-visitors step.
- The inbound vs partner-list split, and the Partner penetration section.

**MQALs (from Nov 17):** distinct Tier 1–3 company domains among new workspaces created by startup-page visitors. This is the same basis as the funnel's "New workspaces (Tier 1–3)" step. Before this change, MQALs counted Tier 1–3 domains among all identified visitors, including people from existing workspaces.

**Partner penetration:** the section is kept. Only the partner-list row was removed from the funnel.

**Eligible workspaces (from Nov 18):** eligibility follows the Startup Offer Eligibility workflow in Clay: verified Seed or Series A, VC-backed, and a net-new workspace. Pre-Seed doesn't qualify. Backing from a partner firm can change the offer tier but doesn't make a company eligible on its own. The data will come from the workflow's weekly eligibility snapshot in Snowflake, which isn't hooked up yet, so the tile and funnel step show "Not connected". The Salesforce funding-round field is not used for this.

## Portfolio penetration (from Nov 18; own Portfolio tab from Nov 19)

The Portfolio tab (`#portfolio`) measures company adoption across firm portfolios. It's a different population from the inbound funnel (startup-page visitors), and it counts companies, not workspaces. It uses the same eligibility rule as the funnel.

| Metric | Definition |
|---|---|
| Verified portfolio | Companies verified from firm-first sources: Harmonic, PitchBook, Crunchbase, Dealroom, firm portfolio pages, official accelerator rosters (YC directory), partner-shared lists, funding announcements. Companies found only by matching our own workspaces are excluded, so the denominator doesn't depend on Clay usage. They're used as an audit of roster gaps. |
| Shared by partner | Verified companies that were on a list the firm shared. A coverage column, not the denominator. |
| With a workspace | Verified companies with at least one Clay workspace, free or paid, by period end. Once per company. |
| Penetration | With a workspace ÷ verified portfolio, as of period end. |
| Eligible | Companies confirmed eligible since tracking began. They stay in the count if they later pay or raise again. |
| Needs check | Fits on funding, but has an existing free workspace or an unconfirmed match. Counted as neither eligible nor ineligible. |
| Redeemed / Redemption rate | Eligible companies that redeemed ÷ eligible, cumulative, with new redemptions in the period underneath. "Not connected", not zero, until redemption events are in Snowflake. Cohorts by first-eligible date come later, once weekly snapshots have built up history. |
| Referrals | Recorded referrals from the firm, kept separate from backing and promo codes. |

- **Cuts:** Partnered (the Partner box is checked in the firm list; To approve shows as pending) and Not partnered.
- A company backed by two firms counts in both firm rows and once in the total.
- **Portfolio companies drill-down:** one row per company, with firms backing it, stage, last round, six-month headcount growth, a provisional opportunity score, Clay account (Not on Clay / Free workspace / Paid) and Offer (Eligible / Needs check / Not eligible / Redeemed / Unknown) as separate fields. A company can be paid and redeemed. The outreach queue is Not on Clay + Eligible.
- **Nov 19:** partner penetration and the company list moved from the Startup tab to a new Portfolio tab: a clickable strip (verified portfolio → with a workspace → paying; eligible → redeemed), a firm table, and a company explorer (search, status filters, CSV export). The Audiences card and the Next action column were removed. Data lands in Supabase (`supabase/migrations/001_portfolio.sql`) and is synced into the dashboard; workspace and paid status are joined live from Snowflake.
- **Next action** (removed Nov 19; kept here for reference): one per company from the Supabase `dashboard_targets` view: route to sales, lifecycle nudge, outreach, ad audience, research, wait (contacted in 30 days), hold out, or none.
- **Audiences card (removed Nov 19):** per audience: channel, members, holdout, new-workspace rate for targeted vs holdout, lift (pp), redeemed, last synced. Audiences pool firms, since one firm's portfolio is usually under platform minimum match sizes. Contacts never reach the dashboard.
- **Sources:** a current company × firm roster and a dated weekly eligibility history, both landed in Snowflake by Data Engineering from the Clay workflow, plus offer redemption events. Everything shows "Not connected" until these exist.
