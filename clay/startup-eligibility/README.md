# Startup Offer Eligibility: domain-only company check

Workflow `wf_0toaxjv4qn3RJ53FEeU` (Clay Team workspace). Draft changes, not yet published:

- New manual trigger **Company check: domain only** (`domain`, optional `company_name`, `investors`).
- **Start: application or domain-only check** (merge) feeds both triggers into the shared checks.
- Intake and the Snowflake customer lookup gain a domain-only mode (no email; the company domain stands in).
- **Domain-only company check?** branches after *Collect screening result*: domain-only runs end at
  **Company check result (yes/no)**; applications continue to the application log and Slack review unchanged.

Result: `eligible` true only for a clean eligible decision on a domain that has never paid Clay. Ineligible and anything
that would need manual review are `false`, with reasons (`outcome`: eligible / not_eligible / excluded_needs_review).

`add_domain_only_check.py` is the script that made the change (run with the CLI pointed at workspace 4515).
