# Clay Lead Magnets: Shared Context

> Paste this into Ploy and into Clay's GTM agent before we start on any single magnet.
> It explains the goal, who does what, and how the pieces connect.

## The goal

We're building free lead-magnet pages on clay.com. Each page solves one GTM problem, such as
cleaning a CRM list. The visitor types in an email, a website or a short list, and Clay runs a
real check on it. The page then shows them a **teaser of the result**: words and counts, not the
data itself. For example, "20 of 40 contacts need cleanup. 10 emails aren't valid. 6 are role
inboxes like info@."

The only call to action is **"Finish this in Clay."** It opens Clay's GTM agent with a prompt
already written, so the visitor signs up and picks up exactly where the page left off.

**The teaser is the hook, and the full result lives in Clay.** We want signups that go on to
clean, enrich and sync their data in Clay, ideally back to their CRM. We are not trying to give
the data away on the page.

## Who does what

| Who | Responsibility |
|---|---|
| **Sungwan (Clay)** | Picks the next magnet, approves each piece, connects them and ships the page. |
| **Claude** | Writes the **page brief** for Ploy. Builds the **Clay workflow** that powers the page: it takes the visitor's input, enriches and checks it, and returns the gated teaser. Defines the workflow's input and output so Ploy and the GTM agent can rely on them. |
| **Ploy** | Builds the page in React, Astro and Tailwind. Owns the design and interactivity. Calls the workflow, turns its output into the teaser, and links the CTA to the GTM agent. Decides how the teaser is worded and revealed. |
| **Clay GTM agent** | Writes the **prompt the CTA carries**, and owns what happens after the click. It continues the same task on the visitor's data inside Clay. |

## How the pieces connect

```
Visitor enters an email or website
        │
        ▼
Page ──► small server endpoint ──► Clay workflow (runs enrichment and checks)
        ◄── gated teaser (counts and short labels only) ◄──┘
        │
        ▼
Page shows the teaser, then the CTA "Finish this in Clay"
        │
        ▼
Deep link into the GTM agent, with the prompt plus the visitor's input and teaser
```

**What the workflow returns.** It is the same shape for every magnet, so Ploy builds the
pattern once:

```json
{
  "magnet_id": "crm-cleanup",
  "input": "acme.com",
  "headline": "20 of 40 contacts need cleanup",
  "stats": [
    { "label": "Invalid emails", "value": 10 },
    { "label": "Role inboxes (info@, sales@)", "value": 6 },
    { "label": "Duplicates", "value": 4 }
  ],
  "locked": ["Which 20 contacts", "Verified replacements", "Sync to your CRM"],
  "status": "ok"
}
```

- `stats` hold counts only. No names, emails or rows ever come back to the page. That is the gate.
- `locked` names what the visitor would get in Clay. Ploy shows it as blurred or locked items.
- `status` can also be `no_data` (we found nothing for that input) or `error`. Ploy designs a
  state for each.

**Why a server endpoint sits in the middle.** Clay workflows run asynchronously and need an API
key, so the page can't call Clay directly from the browser. A small endpoint holds the key, starts
the run, waits for it to finish (usually a few seconds), and passes back only the JSON above. We
need to decide who hosts it (see the open questions below).

## Rules for the page

1. **Input first.** The input box sits above the fold, with a "Try an example" button. Nothing
   stands between the visitor and the first result: no signup and no email gate.
2. **Make the wait feel like work.** While the workflow runs, show each step as it happens, for
   example "Checking emails… Finding duplicates… Verifying domains…".
3. **Show real numbers only.** The teaser numbers come from the workflow. Never make up a result.
   Example data must be labelled as an example.
4. **The CTA names the next action.** For example, "Clean all 20 in Clay" rather than "Sign up".
   Put it right under the teaser and repeat it at the bottom of the page.
5. **Use Clay's voice.** Direct, specific and a little playful. No invented statistics, customer
   logos or pricing claims.

## Before we build the first one

**GTM agent, please confirm:**
1. The deep-link format and how the prompt is passed, including any length limit.
2. That the prompt survives signup, so a brand-new user lands in the agent with it.
3. Which fields from the workflow output you want in the prompt (input, headline, stats).

**Ploy, please confirm:**
1. In two sentences, what you understand the goal to be.
2. Whether your hosting can run a small server endpoint that holds a secret API key. If it can't,
   we'll host one and give you a URL.
3. How you'd present the teaser and the locked items, and whether the output shape above works
   for you.
