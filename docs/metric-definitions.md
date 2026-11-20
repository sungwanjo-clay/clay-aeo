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

## Changed after the monty review (2026-11-20)

| Item | Before | Now |
|---|---|---|
| Media: new workspaces from YouTube | FIRST_TOUCH_ATTRIBUTION only, which misses most YouTube signups | First touch when it names a video or creator link, plus the governed blended attribution (platform youtube): a session without a video counts as untagged YouTube, a survey-only answer as "via signup survey". Per-creator and per-video numbers still need a tracked link; the All-channels tile shows the full YouTube total |
| Media: existing workspaces influenced | Pageview user id → Fivetran USER_ROLES | Pageview user id, or the cookie's user (COOKIE_TO_USER_RELATIONSHIP) → USER_WORKSPACE_ROLES (governed) |
| Media and Startup: visits | Every pageview | Likely bots excluded (crawler IP flag and no Clay user id), the rule the CRO section uses. Startup counts only its clay.com page; Media keeps every site, since existing users often land on signup or login from a creator's link |
| Media: untagged YouTube | Empty campaign matched exactly | Campaign trimmed first, so whitespace-only campaigns count as untagged |
| Workspaces: MCP signups | OAuth: MCP sub-channels of the blended attribution | CUSTOMERS.BINARY_SOURCED_BY_MCP by MCP_SOURCE (governed flag); older saved copies fall back to the sub-channels |
| Activation | "First table within 7 days" ÷ all new workspaces | Golden table (1 basic + 2 advanced successful enrichments in one table) within 7 days, ÷ workspaces created 7+ days before the data end (matured). Not an MBR metric. Media and Startup keep the label change; their rates still divide by all new workspaces, noted in the trend |
| Startup "MQAL" | "MQALs" | "Tier 1–3 signup domains": not an SLG MQAL |

Visitor counts on Media and Startup drop when bots are removed, and conversion rates rise by the same factor. Every
period is recomputed with the same rules, so period-over-period changes stay comparable; only the level moves versus
numbers shared before 2026-11-20.
