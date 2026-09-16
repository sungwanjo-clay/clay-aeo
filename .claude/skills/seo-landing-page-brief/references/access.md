# Access setup — Clay's GSC and Ahrefs

Everything needed to get connected, so a brief never stalls on "which property?" or "where's the key?". Fill the two marked blanks once and this file answers it permanently.

## Contents

1. [Google Search Console](#google-search-console)
2. [Ahrefs](#ahrefs)
3. [Firecrawl](#firecrawl-optional)
4. [Verify access before Phase 1](#verify-access-before-phase-1)
5. [Where the secrets live](#where-the-secrets-live)

---

## Google Search Console

**Property:** `sc-domain:clay.com` — a Domain property, so it covers every
subdomain and both protocols. This exact string is what `site_url` takes.

The form matters more than it looks. A Domain property is `sc-domain:clay.com`
with no scheme and no trailing slash. A URL-prefix property would be
`https://www.clay.com/` *with* the slash. Passing the wrong form returns 403,
not an empty result, so if you get a permission error here check the string
before assuming you lack access. `gsearchconsole__list_sites` prints the
authoritative list — call it first and copy the string verbatim.

**Account:** `<FILL IN: which Google account owns the clay.com property —
e.g. seo@clay.com or a shared marketing account>`. Whoever runs this needs at
least **Restricted** access on the property; Restricted is enough for all
reads this skill does.

**Adding a new person or service account:** Search Console → Settings → Users
and permissions → Add user. For a service account, the principal is the
`client_email` from its JSON key. This step is the single most common cause of
a 403 with otherwise valid credentials — the key is fine, the property just
hasn't been shared with it.

### There is no GSC connector — use the bundled script

Worth knowing up front: **Claude's connector registry has no Google Search
Console connector, and no Ahrefs connector.** The `gsearchconsole__*` and
`ahrefs__*` tool names in the original methodology come from a different agent
environment (Gumloop). Don't wait for those tools to appear — they won't, and a
brief that stalls looking for them is a brief that doesn't get written.

The working path here is the bundled script, which does auth and querying in
one step:

```bash
pip install google-auth                      # once
python3 scripts/gsc_query.py --list-sites    # confirms auth + shows exact property strings
python3 scripts/gsc_query.py --dimensions query --filter-page /sequencer
python3 scripts/gsc_query.py --dimensions page  --filter-page claygent
python3 scripts/gsc_query.py --dimensions query,page --regex "sdr|inbound|routing"
python3 scripts/gsc_query.py --dimensions query --json > rows.json   # then parse_spillover.py
```

It defaults to a 90-day window ending 3 days back (the lag), URL-encodes the
property, and translates a 403 into the two causes that actually produce it.

### One-time service-account setup

Do this once and every future brief just works:

1. **Google Cloud console** → pick or create a project.
2. **APIs & Services → Library** → enable **Google Search Console API**
   (`searchconsole.googleapis.com`). Skipping this gives a 403 that looks
   exactly like a permissions problem.
3. **IAM & Admin → Service Accounts → Create**. No project roles needed — GSC
   permission is granted inside Search Console, not via IAM.
4. On the service account → **Keys → Add key → JSON** → download.
5. Copy the `client_email` from that JSON.
6. **Search Console** → the `clay.com` property → **Settings → Users and
   permissions → Add user** → paste `client_email`, set **Restricted**.
   Restricted covers every read this skill does.
7. Store the JSON somewhere the agent can reach and set
   `GSC_SERVICE_ACCOUNT_JSON` to its path (the script also accepts the JSON
   inline).
8. `python3 scripts/gsc_query.py --list-sites` → expect `sc-domain:clay.com`.

Step 6 is the one people miss. The key is valid, the API is enabled, and every
call still 403s because the property was never shared with the service account.

**OAuth alternative** if you'd rather not create a service account: set
`GSC_CLIENT_ID`, `GSC_CLIENT_SECRET` and `GSC_REFRESH_TOKEN` (scope
`https://www.googleapis.com/auth/webmasters.readonly`) and the script uses the
refresh-token flow instead. Service account is preferred — it doesn't expire
when whoever generated it leaves.

## Ahrefs

**Target:** `clay.com`, `country: "us"` for everything unless the brief is
explicitly for another market.

**Domain rating: 79-80.** Worth knowing before you call, because it's the
number that makes KD interpretable — up to ~25 is comfortable, 25-45 is a
stretch, 45+ needs a dedicated campaign. Still pull it live in Phase 1; if it
has moved, that's itself worth a line in the brief.

**API key:** read from the `AHREFS_API_KEY` environment variable.
`<FILL IN: where the key is stored — 1Password item name, or which env the
key is already set in>`.

There's no Ahrefs connector either, so calls go to the REST API directly:
bearer auth against `https://api.ahrefs.com/v3/` — `site-explorer/domain-rating`,
`keywords-explorer/overview`, `site-explorer/organic-keywords`,
`serp-overview/serp-overview`. Parameter names match the tool signatures in
`tool-calls.md`.

Keep the value out of this file even though the file is internal. Not out of
ceremony: this skill gets packaged as a `.skill`, synced to the skills
library, and can be shared or committed, so it travels further than it feels
like it does. Ahrefs keys are billable and scraped keys get burned. Setting it
once in the environment gets you the identical result — the skill reads it and
never asks — without the key riding along in a file. Same for GSC service
account JSON.

If the key isn't set, say so and ask for it to be added to the environment
rather than pasting it into a call or a file.

## Firecrawl (optional)

`FIRECRAWL_API_KEY` — only used for the Phase 6 page teardown. Without it the
teardown falls back to `web_fetch`, which misses JS-rendered content. Most
competitor landing pages are JS-rendered, so the fallback is noticeably
weaker; worth having.

## Verify access before Phase 1

Cheap, and it turns a confusing mid-brief failure into a clear upfront one:

```
gsearchconsole__list_sites                          # expect sc-domain:clay.com
ahrefs__domain_rating: {target: "clay.com", date: "<3 weeks back>"}   # expect DR ~79-80
```

If GSC returns a property list without `sc-domain:clay.com`, the authenticated
account doesn't have access — that's a permissions problem, not a data problem.
If Ahrefs returns `[]`, re-run with an older date before concluding anything;
the API lags 2-3 weeks on date-parameterized calls.

Either one unavailable: stop and say which. Every finding in this method comes
from cross-referencing live sources, so a brief written without one of them
isn't a weaker brief, it's a different and much less trustworthy artifact.

## Where the secrets live

| Credential | Read from | Notes |
|---|---|---|
| Ahrefs API key | `AHREFS_API_KEY` | Billable — treat as a real secret |
| GSC service account | `GSC_SERVICE_ACCOUNT_JSON` | `client_email` must be a user on the property |
| GSC OAuth | `GSC_CLIENT_ID` / `GSC_CLIENT_SECRET` / `GSC_REFRESH_TOKEN` | Alternative to the service account |
| GSC property | `GSC_SITE_URL`, or hardcode `sc-domain:clay.com` | Not a secret |
| Firecrawl | `FIRECRAWL_API_KEY` | Optional |

Never echo a resolved credential into a brief, a commit, a comment, or tool
output — the brief is a shareable document and often ends up in a Google Doc or
Slack.
