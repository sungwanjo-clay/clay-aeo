# Prompt for Clay's GTM Agent: Lead Magnet Handoff

> Paste everything below the line into the GTM agent, then attach
> `lead-magnets/crm-cleanup/play-spec.md` with it.

---

You're joining a project that turns free tools on clay.com into Clay signups. Here is how it
works and what we need from you.

## The setup

A visitor on a clay.com lead-magnet page pastes up to 25 emails. A Clay workflow checks them
and the page shows only a teaser, for example **"5 of 6 contacts need cleanup: 2 invalid,
1 role inbox, 1 duplicate, 1 personal."** It never shows which emails are which.

The only call to action is **"Clean all 5 in Clay."** It deep-links the visitor into you, the
GTM agent, with a prefilled prompt. They sign up, land with you, and you finish the job on
their data.

**Three parties build this:**

| Who | Owns |
|---|---|
| **Claude** (a coding agent working with Sungwan) | The pre-signup workflow, the endpoint the page calls, and the **play spec** that defines the logic |
| **Ploy** (the page builder) | The landing page, including filling in your deep-link prompt with the visitor's emails and teaser |
| **You** | The deep-link prompt, and everything the visitor experiences after clicking |

## The one rule: your numbers must match the page

The visitor has just seen "5 of 6 contacts need cleanup." When they land with you, you must
build the same check and reach the **same 5 of 6**, then go further. If you say 4, or 7, the
first thing they learn about Clay is that it contradicts itself.

To make that possible, the page and you both follow one **play spec** (attached:
`play-spec.md`, version `crm-cleanup@1`). It sets out:
- the exact order of the checks
- the role, disposable and personal-domain lists
- the email-verification provider (ZeroBounce → Verify email)
- how each provider result maps to a bucket
- how the headline is calculated

Follow it exactly. Don't substitute a different verifier, add your own checks to the counts, or
change the bucket order. A step that runs earlier claims the email first, so changing the order
changes the numbers.

Anything beyond the spec, such as finding replacement emails or syncing to a CRM, is welcome
**after** you've shown the matching counts. It must never change them.

## What the visitor experiences with you

1. **Recap the page.** For example: "On clay.com you checked 6 emails and 5 needed cleanup.
   Let's fix them."
2. **Build the check on their emails using play `crm-cleanup@1`**, and show the same counts.
   - If a mailbox result has changed since the page ran, say so plainly. Don't silently show a
     different number.
   - If they give you more than the 25 the page checked, the first 25 must still match.
3. **Unlock what the page held back:** every email with its bucket and the reason, and a keep
   list of the clean emails.
4. **Offer step two:** find replacement work emails for the invalid ones, and sync the clean list
   to their CRM. If the prompt names one (`crm`), offer that sync directly. A CRM write-back is the outcome we most want from a first session.

## The deep-link prompt (please refine and return)

Ploy will fill in the `{{…}}` values from the page. Here's our draft:

```
I just ran Clay's free CRM Cleanup check on clay.com (play crm-cleanup@1).
Result: {{headline}}. Invalid {{counts.invalid}}, catch-all {{counts.risky_catch_all}},
role inboxes {{counts.role_inboxes}}, duplicates {{counts.duplicates}},
personal {{counts.personal}}, disposable {{counts.disposable}}, clean {{counts.clean}}.
The emails I checked: {{emails}}
{{#if truncated}}My list has {{truncated}} more that the page didn't check.{{/if}}
{{#if crm}}My list lives in {{crm}}.{{/if}}
(Check id: {{run_id}})
Rebuild this check in my workspace following play crm-cleanup@1 exactly, and confirm you get
the same numbers. Then show me which emails are in each bucket and why, give me a keep list,
and help me fix the bad ones and sync the clean list to my CRM.
```

The emails travel inside the prompt so that you run on exactly the same list the page did. At
most 25 emails is roughly 750 characters.

## What we need back from you

1. **Where the play spec lives.** Can you load `crm-cleanup@1` as a skill or playbook, so the
   deep link only has to name it? Or does the full spec need to travel inside the prompt?
   Loading it as a skill is our preference, because it keeps the link short and the logic in
   one place.
2. **Whether you can match each step.** For each step in the spec, tell us whether you can
   reproduce it exactly in a brand-new free workspace. Pay particular attention to the
   ZeroBounce check, the deterministic list screens and the bucket order. If any step can't be
   matched, say which and why. We'll change the pre-signup workflow to match what you can
   build, not the other way around, because your build is what the visitor keeps.
3. **The deep-link format.**
   - The URL and the query parameter that carries the prompt.
   - The prompt length limit. Ploy flagged that 25 emails plus the counts can make the URL
     long: about 1,500 characters before encoding, and over 2,000 once encoded. Tell us whether
     the prompt can travel in the URL, or whether it should be posted to an id first and the
     link carry only that id. Each check already has a unique `run_id` that could serve as the
     key, and we can host that store on our side if you can fetch from it.
   - Whether the prompt survives signup, so a brand-new user lands with it.
4. **Your final prompt template,** with the same `{{…}}` placeholders.
5. **Golden test results.** Run lists A, B and C from the play spec through your prompt in a
   fresh workspace and report the counts. Lists B and C must match exactly. List A depends on
   two live mailbox results, so report what you got.

## When the spec changes

Every change ships as a new version (`crm-cleanup@2` and so on), with the workflow, your prompt
and the golden tests updated together. Your prompt should always name the version it was
written for, so we can tell which logic produced which numbers.
