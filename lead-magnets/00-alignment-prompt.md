# Clay Lead Magnets — Shared Context for Ploy and Clay's GTM Agent

> Paste this whole document into Ploy and into Clay's GTM agent before any magnet-specific
> work starts. Both of you get the same context so the page and the handoff behind its CTA
> are designed as one experience. At the end there is a short list of things each of you
> should reply with before we start building.

---

## 1. What we are building and why

Clay is building a series of **lead magnets**: free, interactive landing pages. Each one
solves a single, concrete GTM problem (cleaning a CRM list, finding emails, mapping an
org chart, and so on) well enough that the visitor sees real value on their own data
within the first minute.

Every page ends with one call to action: **"Do this on your own data in Clay."** The CTA
deep-links into Clay's GTM agent with a prompt already filled in. The visitor signs up
and the agent continues **exactly where the page left off**, with the same input, the same
choices and the next step. Nobody has to explain the task twice.

**The goal is not traffic, and it is not a signup on its own.** We want a signup whose first
session in Clay plants a high-value habit. From our own usage data, among business accounts:

| What the account does in Clay | Value per account | Converts to paid |
|---|---|---|
| Only enriches data | $151 | 13.3% |
| AI research | $1,586 | — |
| Pushes to a sequencer | $4,775 | — |
| Uses the API | $4,894 | — |
| **Writes back to a CRM** | **$5,534** | **83.8%** |

So each magnet is **step one of two**. The page delivers step one: diagnosing the problem,
showing the result and proving that Clay can do it. Step two happens in Clay: fixing it
at scale, enriching it and syncing it back to the CRM or sequencer. The page must never end
in a dead-end CSV download. It should end with the visitor wanting step two.

The first magnet is **CRM Cleanup**. A visitor gives us a CSV or a list of domains, emails or
accounts and sees it triaged into keep, risky and remove, with a reason for every row. A
separate brief for it follows this document.

---

## 2. Who does what

| Role | Owns | Does not own |
|---|---|---|
| **Sungwan (Clay, program owner)** | Which magnet gets built next, final approval, publishing, measurement, and passing artifacts between the agents below | — |
| **Claude (brief author)** | One **page brief per magnet** for Ploy: the audience and search intent, the story the page tells, every interactive module and its states, sample data, copy direction, CTA placement and what the CTA must carry | The GTM agent prompt itself, and visual design |
| **Clay GTM agent** | The **handoff prompt** behind the CTA, and everything that happens after the click. It defines which inputs it needs from the page to pick up seamlessly, how they are encoded in the deep link, and what the visitor's first session in Clay does | The landing page |
| **Ploy (page builder)** | Building the page in React, Astro and Tailwind: layout, visual design, motion, interactivity, responsiveness, performance, and wiring the CTA to the deep link | Product claims, data and the prompt wording, which come from the brief and the GTM agent |

**The rule that keeps this aligned:** the page and the agent share a **handoff contract**
(section 4). Ploy builds the page to collect and pass what is in the contract. The GTM agent
writes its prompt to expect exactly what is in the contract. If either side needs a change,
the contract changes first and the other side then updates to match.

---

## 3. How a magnet gets made

1. **Sungwan** picks the next magnet from the prioritised build list.
2. **Claude** writes the page brief. It includes a draft handoff contract: what the page
   collects and what the agent needs to continue.
3. **The GTM agent** reviews the draft contract, confirms or amends it, and returns the
   handoff prompt template and deep-link format.
4. **Ploy** builds the page from the brief, using the confirmed contract and prompt template.
5. **Sungwan** does an end-to-end test: page, then CTA, then signup, then the GTM agent picking up
   the task. Then ships it.
6. After launch, we measure and iterate (section 7).

---

## 4. The handoff contract (page → GTM agent)

The CTA is a link to the GTM agent with a prefilled prompt. The default shape is below; the GTM
agent should confirm the real format.

```
{{GTM_AGENT_DEEPLINK_BASE}}?prompt={{url-encoded prompt}}&utm_source=lead-magnet&utm_campaign={{magnet_id}}
```

The prompt is the GTM agent's template with variables filled in by the page. Every magnet's
contract specifies the following:

| Field | Example (CRM Cleanup) | Notes |
|---|---|---|
| `magnet_id` | `crm-cleanup` | Used for attribution and so the agent knows which play it is running |
| `user_input` | the domains or emails the visitor entered, or a summary of the uploaded file | See the size limits below |
| `user_choices` | purpose = "cold send" or "CRM refresh"; CRM = HubSpot | Every option the visitor picked on the page |
| `page_result_summary` | "142 rows → 38 duplicates, 11 invalid, 6 role-based, 87 to verify" | What the visitor already saw, so the agent never contradicts it or redoes it |
| `next_step` | "verify the 87 survivors, then sync the clean list back to HubSpot" | The step-two action the page sold them on |

**Constraints both sides must respect**

- **Size.** A URL cannot carry a whole CSV. The GTM agent should tell us its practical
  prompt-length limit. If the input is larger than that, the page passes a sample or a summary,
  and the agent asks the visitor to upload the full file in Clay. Another option is a short-lived
  upload store with an ID in the link. That needs engineering, so we need to decide on it.
- **Signup survival.** Most visitors are not logged in. The prefilled prompt has to survive the
  signup or login flow and land in the agent on the visitor's first session.
- **No secrets and no PII beyond what the visitor typed.** Never pass credentials or tokens.
  Keep it to what the visitor chose to give us.
- **Consistency.** Any number the page showed must be one the agent reproduces, or the agent
  must explain any difference ("the page checked syntax and duplicates; Clay also checked each
  mailbox, which found 9 more").

---

## 5. Page principles (Ploy, read closely; GTM agent, for context)

These apply to every magnet. Each brief adds the specifics for its magnet.

1. **Put the input first.** The input box or upload sits above the fold with a sample-data
   button next to it ("Try with a sample list"). There is no signup, email gate or form before
   the first result.
2. **Show the work, not just the answer.** The page's strength is visible processing. Steps
   should light up as they run and counts should tick down, so the visitor watches their own
   data being triaged. Every row in the input ends up somewhere visible, and nothing disappears
   without a reason.
3. **Be honest about what is real.** Anything that can genuinely run in the browser for free
   should run for real on the visitor's data: dedupe, syntax checks, pattern screens and
   simple classification. Anything that needs Clay's data or paid providers should appear
   as the **next step**: visibly queued, locked or previewed on a few rows, with a clear
   "this runs in Clay" label. Never show invented results as if they were real. Sample data
   must always be labelled as sample.
4. **Make the gap the CTA.** The most persuasive moment is when the visitor has a partial
   result and can see what is missing, for example "87 rows still need mailbox verification"
   or "Push 214 clean contacts to HubSpot". Put the CTA there, word it as that specific next
   action ("Verify the 87 and sync to HubSpot in Clay"), and repeat it in the sticky header and
   footer. Avoid generic labels like "Sign up" or "Get started".
5. **Let them leave with something small, but not the whole thing.** A screenshot-worthy summary
   or a downloadable copy of the free-pass results is fine. The full, finished, synced output
   lives in Clay.
6. **Treat privacy as a feature.** If processing happens in the browser, say so near the
   upload: "Your file never leaves your browser until you choose to continue in Clay."
7. **Make it fast and usable on a phone.** Results should appear in under two seconds. The page
   must work at phone width with no horizontal scroll, using a sample-data path when uploading a
   file on a phone is awkward. Keyboard and screen-reader access must work.
8. **Use Clay's voice.** Write like an expert GTM engineer: direct, specific and a little playful.
   No hype words, no invented statistics, no customer logos or quotes we haven't supplied, and no
   pricing claims.
9. **Instrument the funnel.** Fire analytics events at a minimum for `input_started`,
   `input_submitted` (with a size bucket), `sample_used`, `result_viewed`, `cta_viewed` and
   `cta_clicked` (with which CTA position), so we can see where people drop off.

---

## 6. What each page brief from Claude will contain

So Ploy knows what to expect, and the GTM agent knows where its contract draft lives:

1. **The magnet in one line**, plus the target persona and the search intent it answers.
2. **The story the page tells** as a sequence: hook → input → live processing → result →
   gap → CTA.
3. **Interactive modules.** For each one: what it does, its states (empty, loading, success,
   partial, error, too large) and what is real versus what is previewed.
4. **Sample data** to ship with the page.
5. **Copy direction** for the headline, sub-headline, step labels and CTA labels. These are
   drafts, and Ploy may refine them.
6. **The draft handoff contract** in the section 4 format.
7. **Out of scope**, meaning what this page deliberately does not do.

---

## 7. How we know it's working

- **Primary measure:** CTA click-through from people who saw a result, and signups that came
  from the CTA.
- **What actually matters:** the share of those signups whose first GTM agent session reaches
  step two, meaning a CRM write-back, a push to a sequencer or a table built on their data.
- **Health checks:** the share of visitors who reach a result, time to first result, and the
  share who use the sample instead of their own data.

---

## 8. Before we build: please reply with

**GTM agent, please reply with:**
1. The exact deep-link format and how the prompt is passed (query parameter name, encoding).
2. The practical maximum prompt length, and your recommendation for inputs larger than that.
3. Whether the prefilled prompt survives signup and login, and anything the page must do for
   that to work.
4. The fields from section 4 you need, would add or don't need, and the template you would
   fill them into.
5. What the visitor's first session will actually do after the handoff, so the page can promise
   exactly that and nothing more.

**Ploy, please reply with:**
1. Your understanding of the goal in two sentences, so we can confirm we're aligned.
2. What you can run for real in the browser (CSV parsing size limits, any network or DNS
   lookups) and what you would simulate.
3. How you will build the CTA and deep link, and what you need from us to do it (brand assets,
   fonts, analytics snippet, hosting target).
4. Any of the section 5 principles that conflict with how you build, and what you would
   propose instead.
