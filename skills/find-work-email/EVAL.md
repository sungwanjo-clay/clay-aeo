# Evaluation record — find-work-email

Skill validated on 2026-08-07 by running its own Step 2 against the workspace's managed
Work Email function via the `clay` CLI (`clay routines runs start`), with ground truth.

## Method

| Case | Setup | Expected | Result |
|---|---|---|---|
| Ground truth | Real person, full name + company domain + company name + LinkedIn URL | Their known work email, verified | PASS — exact match returned in ~12s |
| Fabrication probe | Invented name at a real company domain | Empty result, no pattern-guessed address | PASS — `status: complete` with empty result after ~4.5 min (full waterfall exhaustion) |

Cost: ~2.2 credits total (1.1 estimated per run).

## Version history (see git history of SKILL.md)

- **v1 → v2** (live eval): added the CLI `items` input envelope and the
  routines-list pagination caveat; added the timing asymmetry warning (hits in
  seconds, not-founds in minutes — batches finish at the speed of their misses);
  named the `complete`-with-empty-result shape as the not-found signal; clarified
  that the managed function verifies internally but does not surface
  catch-all/risky discrimination, so cold-outreach-at-volume use needs an
  explicit validation step.

## Findings recorded in the shared gotchas file

G9 (routines input envelope), G10 (routines list pagination), D5 (not-found
latency asymmetry), and a third confirmation of D2 (completion status is not
data) — see `skills/knowledge/workflows-alpha-gotchas.md`.

## Gotchas-file effectiveness check (P1 follow-up)

First build after the knowledge file existed: zero repeated mistakes from the
G1–G8 set (proxy setting applied immediately, no status-as-data errors), and the
build needed 1 debug iteration (input envelope, now G9) versus 6 on the first
skill. The context-loading loop works.
