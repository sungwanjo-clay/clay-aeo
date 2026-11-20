# Metric definitions: decisions

Which definition each shared metric follows, and why. monty (Clay's data analyst agent) is used for context: what the
governed dbt models mean, their nuances and caveats. The dashboard's own queries run through Sigma. Numbers from the
reviews stay out of the repo.

## Decided

| Metric | Definition the dashboard uses | Why |
|---|---|---|
| Visitors (Workspaces tiles, Visitor → HQ trial) | MBR "PLG Headline Metrics": distinct ANONYMOUS_ID on the marketing site + signup pages, browser time zone not UTC and not Asia/* | It's what the monthly MBR reports against. monty's governed bot rule (MARKETING_IP_CRAWLER_CLASSIFICATION) counts differently; the CRO section uses that rule for its own "new visitors" and says so. |
| Trial → paid | MBR: new paid PLG workspaces (first invoice in the period) ÷ new HQ trial users, same period | Follows the MBR, like visitors. monty notes the numerator isn't limited to HQ; that's a known property of the MBR ratio. |
| Sales tier and every Tier 1–3 number | Marketing Q4 source-of-truth tile: CUSTOMERS.DOMAIN → live FIVETRAN.SALESFORCE.ACCOUNT, current SALES_TIER_C, best tier per domain, personal emails excluded (academic kept). One rule in lib/plg/tier.ts, used by Workspaces, Media and Startup | Must tie 1:1 to the Marketing tile. monty's governed link (sfdc_workspace_dimensions) matches more workspaces; we don't switch unless the Marketing tile does. |

## Open (reviewed with monty, not changed)

- Media: new workspaces per video read FIRST_TOUCH_ATTRIBUTION, which misses most YouTube signups; the governed source is
  the blended attribution table with platform = youtube (session-based ones can be tied to a video, survey ones can't).
- Media: "existing workspaces influenced" should read cookie_to_user_relationship → user_workspace_roles.
- Media and Startup visits: add the site filter and the governed bot rule; untagged YouTube visits need NULLIF(TRIM(utm_campaign), '').
- MCP signups: customers.binary_sourced_by_mcp is the governed flag (the sub-channel pattern catches extra rows).
- Activation: the flag means a golden table, and the governed rate uses matured (7+ day old) workspaces; relabel.
- Startup "MQAL": not an MQAL in the SLG sense; rename to "Tier 1–3 signup domains".
