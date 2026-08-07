# GTM skill factory — working context

This directory holds the Clay skills library: one folder per skill (`SKILL.md` +
`EVAL.md`), plus the factory's accumulated knowledge in `knowledge/`.

Rules for any session working in here:

1. **Before building or testing any skill or Clay workflow, read
   `knowledge/workflows-alpha-gotchas.md`** and apply it — it encodes verified platform
   gotchas (G*), design findings (D*), and process rules (P*) that will otherwise cost
   debug iterations to rediscover.
2. **After any build or eval session, append what you learned** to that file: new entries
   get an id, `status: candidate`, a `verified:` date, and a `source:`. An existing entry
   reproduced in a second independent build gets promoted to `confirmed`. Entries that stop
   reproducing are marked `superseded`, never deleted.
3. **Skills are versioned in git**: commit the draft before the eval, commit the validated
   version after, so every skill's v1→vN diff is preserved. Record the eval in the skill's
   `EVAL.md`, scrubbed for a public repo (no workspace/run IDs, no personal names, no
   customer data).
4. The gotchas file is formatted for eventual upstream contribution to the
   clay-gtm-architect knowledge base (candidate pages) — keep the provenance discipline.
