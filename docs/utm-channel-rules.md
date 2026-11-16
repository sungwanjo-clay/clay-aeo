# UTM → channel rules (inferred)

These rules were worked out backwards from the data, not read from the dbt model. Each workspace's first-touch session (`DBT.PROD.INT_MARKETING_WEBSITE_SESSIONS_CHANNEL_INPUTS`) was joined to its blended channel in `DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION` (90-day window, first touch), for workspaces created Aug 15 – Nov 14, 2026. Counts are workspaces that the session decided. Confirm edge cases against the dbt model.

## How a workspace gets its channel (first match wins)

1. **Campaigns.** A Salesforce campaign matches the session's utm_campaign or ad id.
2. **OAuth.** The signup came through MCP or the CLI.
3. **Deterministic platforms.** A known UTM medium or click id, such as gclid, fbclid or a Rewardful affiliate id.
4. **Categorized "How did you hear about us?" (HDYHAU) answer.**
5. **Deterministic organic search.** The referrer is a search engine.
6. **Session exists but useless.**
7. **HDYHAU exists but isn't categorized.**
8. **Unattributable.**

## Rules by channel

In the tables, ∅ means the parameter is blank.

### Paid

| Channel → subchannel | utm_source | utm_medium | utm_campaign / other signal | Workspaces |
|---|---|---|---|---|
| Organic: Google Paid → Search Branded | google | cpc | Google Ads campaign id, mapped to Salesforce campaign `search-brand`; gclid | 855 |
| Paid Ads: Google | google | cpc (search) or display | Google Ads campaign id, mapped to non-brand campaigns such as `search-nonbrand-…` or `display-general`; gclid | 47 |
| Paid Ads: Meta → facebook / instagram | fb / ig | paid (sometimes social) | Meta ad id, e.g. `FB Ads - Demo Requests v2`; fbclid alone also counts | 65 |

### Influencer

| Channel → subchannel | utm_source | utm_medium | utm_campaign / other signal | Workspaces |
|---|---|---|---|---|
| Influencer: Internal → platform (e.g. linkedin) | linkedin | influencerinternal | e.g. `soc_varun`, `abm-magnet-liarticle-davide` | 102 |
| Influencer: Partner → platform (e.g. youtube) | all, or ∅ | influencerpartner | e.g. `youtube_austinmarchese…`, `kylepoyar_newsletter_nov26` | 31 |
| Influencer: Affiliate → referring site | any | any | Rewardful `?via=` affiliate id; subchannel = the site the link was clicked on | 1,286 |

### Marketing

| Channel → subchannel | utm_source | utm_medium | utm_campaign / other signal | Workspaces |
|---|---|---|---|---|
| Marketing Outbound: Lifecycle → email | inflection | email | e.g. `trial-onboarding` | 82 |
| Marketing Outbound: Lifecycle → clay app | sprig | inapp | e.g. `tam-sourcing-bundle-launch-sprig-072826` | 11 |
| Marketing Outbound: Direct Message | e.g. livestream | marketingdirectmessage | e.g. `claycup_quarterfinals_20260821` | small |
| Marketing Content: Owned | other | marketingcontentowned | e.g. `not-my-business`; subchannel from the referrer (youtube) | 14 |

### Organic

| Channel → subchannel | utm_source | utm_medium | utm_campaign / other signal | Workspaces |
|---|---|---|---|---|
| Organic: AI Tools → chatgpt / gemini / perplexity / claude | chatgpt.com, gemini, or ∅ | ∅ | Or referrer chatgpt.com, gemini.google.com, perplexity.ai, claude.ai | 3,350 |
| Organic: Search | ∅ | ∅ | Referrer google.com, bing.com, yahoo, duckduckgo | 12,065 |
| Organic: Social → linkedin / youtube / x | ∅, or a LinkedIn share code | ∅ | Referrer linkedin.com, youtube.com, t.co | 466 |
| Organic: Content → substack / reddit | substack | email | Or referrer reddit.com | 27 |
| Organic: Direct | ∅ | ∅ | Referrer clay.com, app.clay.com, university.clay.com | 5,924 |

### OAuth and survey-only

| Channel → subchannel | utm_source | utm_medium | utm_campaign / other signal | Workspaces |
|---|---|---|---|---|
| OAuth: MCP → platform | ∅ | ∅ | Signup through an MCP OAuth flow (referrer chatgpt.com, claude.ai, cursor.com) | 25,802 |
| OAuth: CLI | ∅ | ∅ | Clay CLI OAuth (referrer localhost) | 76 |
| Organic: Word of Mouth, Field Marketing: Clay Event, Marketing Content: Clay Education, Paid Physical: OOH | — | — | Survey answer only: these channels have no UTM rule | — |
| undefined | ∅, **or an unrecognised source** (handshake, luma, clayclubs) | ∅, or unrecognised (community) | No referrer, or a source with no matching rule | 12,445 |

## What this means for tagging

- **utm_medium decides the channel.** The registered media are:
  - influencerinternal
  - influencerpartner
  - email, from inflection or substack
  - inapp, from sprig
  - marketingdirectmessage
  - marketingcontentowned
  - cpc, display and paid, for ads

  Anything else falls through to the referrer, and then to undefined.
- **utm_source is the platform or subchannel**, e.g. linkedin, youtube, google, fb, ig, inflection.
- **utm_campaign doesn't change the channel** except for paid search. There, brand vs non-brand comes from the Salesforce campaign mapped to the Google Ads campaign id.
- **Unregistered values get lost.** In this window, 273 handshake, 19 clayclubs and 16 luma workspaces landed in undefined. To keep partner or community traffic attributed, use a registered medium, or add the new medium to the model.
