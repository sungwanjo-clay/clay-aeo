# Social video (YouTube) tab: metric definitions

Live in the PLG Weekly Metrics artifact under **Social video** (`#social`, `#social-peter`). Definitions live in code in `lib/plg/social/config.ts` and `components/plg/social/SocialView.tsx` (`DEFINITIONS`, also shown on the page). Keep this doc in sync with them.

## Scope

| Tab | YouTube channels | Site and workspace scope |
|---|---|---|
| All channels | Peter Kang + Clay brand channel (@growwithclay); Payton and Eric once connected | **All** YouTube traffic to Clay, grouped by source (creators, brand, affiliates, paid ads, untagged) |
| Peter Kang | @peterfromclay `UC1C7lmXOfNHlS2cORnPbgaA` | His tagged links (`utm_campaign` `pk_yt_*`) + offer-page visits from YouTube |

## Metrics

| Step | Metric | Definition | Source |
|---|---|---|---|
| Reach | YouTube views | Views in range, all traffic sources. YouTube lags ~2 days; both periods are compared over the same reported days. | YouTube Analytics API (`scripts/sync-youtube.mjs` → artifact store `youtube/<channelId>`) |
| Click | Visitors from YouTube | Distinct cookies (`ANONYMOUS_ID`) with a youtube.com referrer or YouTube `utm_source`. | `DBT.PROD.MARKETING_PAGEVIEWS` |
| Click | Offer page visitors | Those visitors who viewed `cohorts.clay.com/wedge`. | same |
| Capture | Offer page form submits | Distinct YouTube visitors who submitted the /wedge form. | `SEGMENT.VERCEL.FORM_SUBMITTED` |
| Workspaces | New workspaces, All | Blended first-touch channel ends in “: youtube” (survey, organic session, affiliate, owned, paid). Same model as the Workspaces tab. | `FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION` (90-day window) |
| Workspaces | New workspaces, creator | Created ≤30 days after the visitor's first click on the creator's link, joined by cookie. Influence, not exclusive credit. | `MARKETING_PAGEVIEWS` → `COOKIE_TO_WORKSPACE_RELATIONSHIP` |
| Workspaces | Existing re-engaged | Workspaces that existed before that first click. | same join |
| Workspaces | Activated ≤7d | Golden table (2+ advanced and 1+ basic enrichments) within 7 days of creation. | `BINARY_ACTIVATED_WORKSPACE`, `DAYS_TO_ACTIVATION` |
| After signup | Paid / expanded / churned | Paid = has a first invoice. Expanded = upgraded from a paid plan, or bought a credit pack after the first invoice. Churned = paid, cancelled, and no longer a current customer. | `CUSTOMERS`, `CREDIT_PACK_INVOICES` |
| After signup | Persona | Onboarding survey `TEAMS` (latest response). | `ONBOARDING_SURVEY` |
| After signup | Tier | SFDC Sales Tier of the customer domain; Unmatched = no SFDC account. | `CUSTOMERS.DOMAIN` → `SALESFORCE.ACCOUNT.SALES_TIER_C` |

No step goals are set. Step rate = step ÷ the step above it, shown against the previous period.

## Not measurable yet (and what unlocks each)

| Mock metric | Blocker | Unlock |
|---|---|---|
| Impressions, view rate (thumbnail CTR) | Not in the YouTube Analytics API; the Reporting API only serves the channel that authorized | Peter (or his brand-account manager) authorizes the GCP app for `channel_reach_basic_a1` |
| Qualified emails | /wedge form event has no email | Send the email with the Segment `form_submitted` event, then enrich in Clay |
| Email opens / clicks | No SELECT on `INFLECTION.INFLECTION.*` | Grant the Sigma role access |
| Per-video visits / workspaces | YouTube strips the video from the referrer | One `utm_campaign` per video on every description link (offer page and dub.sh included) |
| Payton / Eric | No channel ids or link tags | Add channel id + tag prefix in `CHANNELS` |

## Known data caveats

- The offer page link (`clay.link/pkytcohorts`) carries `utm_source=other&utm_medium=marketingcontentowned` with no creator tag. It is credited to Peter because only his descriptions link it (medium confidence).
- About 85% of YouTube-credited workspaces come only from the signup survey (HDYHAU = YouTube), so they can't be tied to a creator.
- The creator join only matches people who signed up in the same browser they clicked from.

## Refresh

- Snowflake numbers are live through each viewer's Clay Sigma connector, cached up to 6 hours.
- YouTube numbers come from `node scripts/sync-youtube.mjs`, whose output is written to the artifact store. The sync needs `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN`.
