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

**Partner penetration:** "Not connected" until the VC and accelerator portfolio lists are in Snowflake.
