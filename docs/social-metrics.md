# Social video (YouTube) tab: metric definitions

Lives in the PLG Weekly Metrics artifact under **Social video**: `#social` (All channels) and `#social-peter` (Peter Kang). The rules live in code in `lib/plg/social/config.ts` and `lib/plg/social/sql.ts`. Keep this doc in sync with them.

## Funnel

Each video is measured as **Impressions → Views → Site visits → New workspaces**, then broken down by tier mix, existing workspaces influenced, and persona.

| Step | Definition | Source | Goal |
|---|---|---|---|
| Impressions | `video_thumbnail_impressions` | YouTube Reporting API `channel_reach_basic_a1`. **Not connected** | – |
| Views · view rate | Views; view rate = `video_thumbnail_impressions_ctr`, weighted by impressions across videos | Views: YouTube Analytics API v2. View rate: **Not connected** | 6% |
| Site visits | Unique `ANONYMOUS_ID`, `utm_source` = youtube, `utm_campaign` maps to a video via the description lookup | `DBT.PROD.MARKETING_PAGEVIEWS` | 50% of views |
| New workspaces | First-touch `UTM_CAMPAIGN` maps to a video | `DBT.PROD.FIRST_TOUCH_ATTRIBUTION` | 60% of visits |
| Activated / Paid | Golden table within 7 days / has a first invoice | `FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION` | – |
| Existing influenced | Tagged visitor's `USER_ID` already belonged to a workspace (`USER_ROLES.CREATEDAT` before the visit), counted as distinct workspaces | `MARKETING_PAGEVIEWS` → `FIVETRAN.AURORA_POSTGRES_CLAY_ADMIN.USER_ROLES` | – |
| Tier | `CUSTOMERS.DOMAIN` → `DBT.STAGING.STG_SALESFORCE__ACCOUNT.SALES_TIER_C`, best tier per domain, business domains only (`CUSTOMER_DOMAIN_SEGMENT = 'other'`). Personal, academic or no SFDC account → Untiered | | |
| Persona | **Source TBD** (candidate: `ONBOARDING_SURVEY.TEAMS`) | | |

- The email steps (captures 20%, qualified 40%, opens 50%, clicks 40%) appear only for videos whose link goes to the startup offer page (`OFFER_PAGE_PATTERNS`). No current Peter video does, so they are hidden.
- "If at goal" = extra new workspaces if a step hit its goal while every other step stays at today's rate.
- Biggest leak = the step with the largest "If at goal" impact, among steps with data. The impression → view step is excluded until it is connected.

## Video ↔ campaign lookup

Built by `scripts/sync-youtube.mjs`, which parses every description for clay.com and clay.link links and their UTMs.

- **Mapped today:** one video, `eq8SJ2MKOQk` → `pk_yt_ep7_livestream_ama_eric_nowoslaski`.
- **`pk_yt_ep4_demoform` and `pk_yt_ep5_hcuc_ep13`** have traffic but appear in no current description. They are flagged and never assigned to a video.
- **Short links:** `clay.link/pkytcohorts` and the `dub.sh` links have unknown targets (clay.link is blocked by the network policy). They are flagged, not guessed.

## Untagged and excluded traffic

- **YouTube, untagged:** YouTube referrer or `utm_source`, no `utm_campaign`, not an affiliate referral. This is one row on All channels and is never split across videos. Oct 14 – Nov 10: 724 visitors, 25 first-touch workspaces.
- **Affiliate creators** (Rewardful `?via=` from YouTube) are excluded and footnoted: 1,650 visitors in the same window.

## Time

- **Video cohort:** each video measured over its first 28 days after publish. Peter's default.
- **Calendar dates:** the date filter. All channels' default.
- YouTube Analytics lags about 2 days, so calendar comparisons are clipped to the days YouTube has reported.

## Unblocking impressions

Peter (or whoever manages his channel) authorizes the GCP app (`clay-youtube-analytics`) for the Reporting API. Then:

1. Create a `channel_reach_basic_a1` job. It backfills 30 days, and the first files arrive within 48 hours.
2. Add impressions to `scripts/sync-youtube.mjs`.

The impression columns are already laid out and read "Not connected" until the data is there.

## Access caveat

YouTube data comes through Viewer access to Peter's channel, a path Google doesn't officially support for APIs. If the sync gets a 401 or 403, it reports NO ACCESS and keeps the last document; the page shows the sync date.
