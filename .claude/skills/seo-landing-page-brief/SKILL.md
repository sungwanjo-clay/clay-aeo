---
name: seo-landing-page-brief
description: "Generates a data-backed SEO brief for a product or landing page from live Ahrefs keyword/SERP data, Google Search Console performance, and an organic-only teardown of the top 5 ranking competitor pages. Handles three situations: a drafted page brief that needs keyword, metadata and section recommendations; an existing live URL that needs only a title/meta fix; and a page nobody has scoped yet that needs broad keyword and positioning direction to steer the conversation. Use whenever someone asks for an SEO brief, keyword research for a page, a title tag or meta description review, a cannibalization check, 'what should this page target', 'is our metadata right', 'why is our CTR so low', or how to position a product page for search - even if they never say 'SEO'. Not for best-of listicle articles (use best-listicle-brief) or editorial guides (use ploy-article-2)."
metadata:
  icon: search-check
  color: Teal
  related_server_ids:
  - ahrefs
  - gsearchconsole
  - firecrawl
---

# SEO Landing Page Brief

Produces briefs that contain **decisions**, not keyword lists. Built from the Clay briefs for Account Agents, Sequencer, GTM Agent, Claygent, Workflows and Inbound AI SDR.

**Required:** Ahrefs + Google Search Console access, and a Python sandbox. **Preferred:** Firecrawl for the page teardown (`web_fetch` works, slower and lossier).

Clay's property is `sc-domain:clay.com` and the Ahrefs target is `clay.com` at DR ~79-80.

**There is no Google Search Console connector and no Ahrefs connector in Claude's registry** — the `gsearchconsole__*` / `ahrefs__*` tool names in the original methodology belong to a different agent environment. Both run over their REST APIs instead, and GSC has a bundled script that handles auth: `scripts/gsc_query.py --list-sites`. **`references/access.md`** has the one-time service-account setup, the accounts and permissions, where each credential is read from, and a pre-flight check — read it first, and again if any call returns 403.

If Ahrefs or GSC is unreachable, say so and stop rather than producing a brief from estimates; the whole method depends on live numbers.

## Why this method produces findings

Three data sources, each with a blind spot the others cover:

| Source | Answers | Blind spot |
|---|---|---|
| Ahrefs keyword metrics | Is there demand? How hard? | Doesn't know what *your* site already does |
| Ahrefs SERP + page teardown | Who ranks, are they beatable, what does their page actually do? | Lags; doesn't show your real CTR |
| Google Search Console | What your site *actually* earns today | Only shows queries you already appear for |

**Every headline finding in the Clay briefs came from two sources disagreeing.** That is the thing to hunt for:

- Ahrefs said "ai sales agent" was KD 43 → a re-pull showed **KD 2**. The SERP had decayed.
- Ahrefs showed `/sequencer` ranking fine → GSC showed **position 3.5 at 1.8% CTR**. The ranking was fine; the title was the problem.
- The client brief said the URL was `/claygents` → GSC showed `/claygents` **doesn't exist** and `/claygent` does 2,969 clicks.
- Ahrefs said "ai sdr" was KD 0 → GSC showed Clay **already had a page for it, stranded at position 45.9**.

Pull volumes alone and you find none of these. So never report a single source's number as the finding — report what two sources disagree about.

## Step 1: pick the mode

Three very different requests arrive wearing the same clothes. Read what the user actually gave you:

| Mode | You were given | You produce |
|---|---|---|
| **A — FULL BRIEF** | A page brief or draft: proposed URL, metadata, H1, section headers. Page is being built. | The complete brief: keywords, metadata, section-by-section targets, flags |
| **B — METADATA ONLY** | A live URL and a narrow ask ("fix our title", "is this description right?") | A short metadata recommendation with CTR evidence. Nothing else. |
| **C — DISCOVERY** | A product or topic, no page, no draft ("we're thinking about a page for X") | Demand landscape, SERP reality, positioning options, a proposed page skeleton, decisions to make |

Detection: proposed metadata or section headers in the input → A. A live URL plus a narrow metadata question → B. Neither a page nor a draft → C.

If it's genuinely ambiguous, ask once — "is this a full brief for a page you're building, a metadata fix on the live page, or earlier than that?" — then commit. Don't ask twice, and don't quietly upgrade a mode: someone who asked for a title tag does not want eleven phases of research, and delivering a full brief to a metadata question wastes their time and buries the answer.

**Mode drives which phases run:**

| Phase | A | B | C |
|---|---|---|---|
| 0 Ingest | ✅ | ✅ | ✅ |
| 1 Domain baseline | ✅ | — | ✅ |
| 2 Keyword universe | ✅ | — | ✅ |
| 3 Cannibalization | ✅ | ✅ | ✅ |
| 4 GSC live performance | ✅ | ✅ (the core) | ✅ (domain sweep) |
| 5 SERP verification | ✅ | titles only | ✅ |
| 6 Organic page teardown | ✅ | titles/H1s only | ✅ |
| 7 Expansion | optional | — | optional |
| 8 Synthesis | ✅ | ✅ | ✅ |
| 9 Metadata | ✅ | ✅ (the deliverable) | — |
| 10 Cross-page map | if 2+ pages briefed | — | — |

Mode B is roughly 5 calls and a minute. Mode A is ~15 calls and 4-5 minutes. Mode C is ~12 calls.

## The phases

Exact call shapes, parameters and the gotchas that break them live in **`references/tool-calls.md`** — read it before your first Ahrefs or GSC call, because several of these fail silently with the wrong argument shape (an empty result and a malformed filter look identical).

### Phase 0 — Ingest

Extract and write down *verbatim*, before any research:

- Proposed URL(s) — **if more than one is listed, that is almost always a problem**, flag it immediately
- Proposed meta title and description
- Proposed H1 and eyebrow
- Section headers — these are free keyword research and become your mapping targets
- Launch date

Verbatim matters because you will be recommending edits to these exact strings. Three of five Clay briefs had a metadata defect visible *only* by comparing the proposed string against live ranking data. You cannot make that comparison from a paraphrase.

### Phase 1 — Domain baseline

`ahrefs__domain_rating` on the domain. This calibrates what difficulty is realistically winnable, and without it every KD number is uninterpretable. At DR 79-80: KD up to ~25 is comfortable, 25-45 is a stretch, 45+ needs a dedicated campaign.

### Phase 2 — Keyword universe

40-60 candidates via 2-3 parallel `ahrefs__keywords_overview` calls, 20 keywords each. Always request `traffic_potential` alongside volume — it's the traffic of the page currently ranking #1, and where it disagrees with volume it's usually telling you something:

- `email warming` — 200/mo volume but **TP 4,000** → the ranking page captures a whole cluster
- `cold outbound` — 90/mo volume, **TP 0** → fine brand copy, worthless as a target
- `prompt testing` — 150/mo volume, **TP 6,800** → far bigger than it looks

Build candidates from four sources so you get more than synonyms:

1. **Product term + variants** — `gtm agent`, `gtm agents`, `gtm ai agent`, `ai gtm agent`
2. **Category terms** — what an analyst would call this: `ai agent orchestration`, `sales engagement platform`
3. **One term per page section** — "Buy inboxes and domains" → `email warming`, `domain warming`. "Reply routing" → `lead routing software`.
4. **Competitor/alternative terms** — `chili piper alternative`. Low volume, very high CPC, high intent.

### Phase 3 — Cannibalization audit

The step most people skip, and the one that produced the highest-value finding in three of five Clay briefs. Run `ahrefs__organic_keywords` once per topic stem, in parallel, with a substring filter — `"sequenc"`, `"agent"`, `"gtm"`, `"outbound"`, `"inbound"`, `"email"`. Then run it again in `mode: "exact"` against the target URL itself.

**An empty result is a finding, not a failure.** Substring `"sequenc"` returned `[]` for clay.com — zero non-branded rankings in the entire category. That became the opening line of the brief.

### Phase 4 — Live performance (highest signal)

Confirm the property, then pull **both** query level and page level for the target URL, trailing 90 days:

```bash
python3 scripts/gsc_query.py --list-sites
python3 scripts/gsc_query.py --dimensions query --filter-page /sequencer
python3 scripts/gsc_query.py --dimensions page  --filter-page sequencer
```

Page-level is how you confirm the URL actually exists — that's how `/claygents` got caught. `--regex` sweeps a topic across the whole domain, which is the Mode C move when there's no target URL yet.

Four patterns worth hunting, because each implies a completely different recommendation:

| Pattern | Means | Clay example |
|---|---|---|
| High impressions + good position + **low CTR** | Metadata defect, not a ranking problem | `/sequencer` — pos 3.5, 110 impr, **1.8% CTR** |
| Position 1 + near-zero CTR at scale | AI Overview / SERP feature absorption | "clay ai" — **50,273 impr, pos 1.0, 0.26% CTR** |
| Query landing on the **wrong page** | Cannibalization or a missing page | "gtm agent" landing on `/claygent` at pos 6.5 |
| Brand term at position **>1.5** | Third parties outranking you on your own name | "claygent" at avg pos **2.2** |

The first one is the most common and the most misdiagnosed: it looks like an SEO problem and it's a copywriting problem.

### Phase 5 — SERP verification

**Never recommend a keyword on KD alone** — KD is a model, and it decays. Run `ahrefs__serp_overview` on your top 3-5 candidates *and* on the client's own brand term, in parallel. Read for three things:

1. **Result type mix** — product pages, or listicles/Reddit/YouTube? A product page struggles to break a pure-listicle SERP, but it can when other product pages already rank. (`email sequence software` was 90% listicles, but Salesmate's *product page* sat at #5 → proof of entry.)
2. **Incumbent domain ratings** — DR 32 and DR 40 on page one against a DR 80 client is an opening, and worth saying out loud.
3. **Intent pollution** — is the SERP even about your topic? This is the check that saves you from a confidently wrong recommendation:
   - `sequencer` (2,600/mo) → SERP was **music production, HVAC furnaces, DNA machines**. Never target unqualified.
   - `speed to lead` (1,500/mo) → **half real-estate wholesaling**. Only half the volume is addressable.

Running it on the brand term shows who is parasitizing it — "claygent" had five third-party pages on page one including a competitor-hosted review.

**An empty result is a finding:** "gtm agent" returned `{"positions": []}` → emerging term, nobody entrenched, plant the flag.

### Phase 6 — Organic page teardown

Phase 5 tells you *whether* you can rank. This tells you *what the page needs to say* — and it's where the section and header recommendations come from instead of being invented.

Take the SERP, drop everything that isn't a real organic competitor page, tear down the top 5 that remain, then look for what they agree on. Full procedure — the exclusion list, what to extract per page, and how to turn five teardowns into table-stakes / differentiator / wedge buckets — is in **`references/serp-teardown.md`**. Read it before this phase.

The short version: exclude social and UGC (Reddit, YouTube, Quora, LinkedIn, X), review directories (G2, Capterra), paid/sponsored slots, and the client's own domain. Crawl what's left. Then a section appearing on 4 of 5 ranking pages is table stakes and its absence from the draft is a gap; a section on 0 of 5 that we can credibly own is the wedge worth arguing for.

Record the type mix even for the pages you exclude — "6 of 10 results are listicles" changes what kind of page can win here, and a Reddit thread ranking top-3 is a real signal about how buyers discuss the category, just not a page you can learn structure from.

### Phase 7 — Expansion (optional)

`ahrefs__matching_terms` when the seed set feels thin. Always filter on volume with `where`, or you drown in long-tail noise.

### Phase 8 — Synthesis

Write the brief. **Lead with the most surprising data point** — the thing that changes what they would otherwise have done. If nothing surprised you, either the research is incomplete or the page is genuinely uncontested, and say which.

Templates for all three modes, plus two full worked examples from the real Clay briefs, are in **`references/output-templates.md`**.

### Phase 9 — Metadata (never eyeball character counts)

Draft candidates, then verify with the bundled script rather than estimating:

```bash
python3 scripts/check_metadata.py --title "Your title here" --desc "Your description here"
```

Eyeballing caught nothing; running `len()` caught a 193-character description (38 over) and a title sitting at exactly 60 with zero mobile margin.

Rules, each earned from a real defect:

1. Title ≤ 60 chars, description ≤ 155.
2. **Never open a title with internal jargon.** "Clay's global agent" has zero search volume and consumed the highest-CTR pixels on the page.
3. **Singular vs plural: check the click data, don't guess.** "claygent" 996 clicks vs "claygents" 64 → singular.
4. **The title must contain terms the page already ranks for.** `/sequencer` ranked for "email sequencer" and the proposed title contained none of it.
5. **On a page that already converts, change as little as possible.** `/claygent` had a 48.6% CTR — the only recommendation was plural→singular. A rewrite there would have been vandalism.

Also mine the teardown for the *title pattern* the ranking pages share. If four of five are `{Brand} {Product} | {Category outcome}` and the draft is a bare product name, that's worth saying.

### Phase 10 — Cross-page assignment

Once 2+ pages on the domain have been briefed, assign every contested term to exactly one URL. This surfaces collisions invisible at single-page scope — "signal based selling" recommended for both Account Agents and Sequencer; **"Clay's Global Agent"** claimed as the eyebrow by both Claygent and GTM Agent, *both launching the same day*.

## Writing rules

These are what make the brief usable rather than merely correct:

- **Every claim carries a number from a tool call.** "Low CTR" is not a finding. "1.8% CTR, 110 impressions, position 3.5" is.
- **Quote their draft verbatim before recommending a change.** They need to see what you saw.
- **Say what *not* to do, and why.** The "do not target" rows prevented four bad decisions across five briefs — wrong-intent, wrong-ICP, or unwinnable terms that look great in a volume column.
- **Flag above the fold:** 🚨 launch blockers, ⚠️ collisions and cannibalization, 📉 anomalies worth a separate workstream.
- **End with the 2-3 decisions that are actually blocking.** Not a summary — decisions, addressed to whoever has to make them.
- **Never estimate a number you could look up.** If a tool call failed, say the call failed; don't fill the hole with a plausible figure.

## Files

- `references/access.md` — Clay's GSC property and Ahrefs account, permissions, credential locations, pre-flight check
- `references/tool-calls.md` — exact Ahrefs/GSC call shapes, direct-API fallback, and the gotchas that silently return empty
- `references/serp-teardown.md` — Phase 6 in full: organic-only filtering, per-page extraction, consensus analysis
- `references/output-templates.md` — the three mode templates + two worked examples
- `scripts/gsc_query.py` — Search Console auth + queries, no connector needed
- `scripts/check_metadata.py` — character-count verification for titles/descriptions
- `scripts/parse_spillover.py` — parse GSC/Ahrefs results that spilled to `/home/user/.spillover/`
