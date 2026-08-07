# Clay Workflows (Alpha) — build gotchas & factory findings

Living knowledge file for the GTM skill factory. Every entry is dated and sourced so it
can be re-verified as the Alpha evolves and, once confirmed across builds, contributed
upstream to the clay-gtm-architect knowledge base as candidate pages.

**Conventions** (borrowed from the clay-gtm-architect KB): an entry observed in one build
is `candidate`; promote to `confirmed` when a second independent build hits it. Append new
entries at the bottom of the matching section with `verified:` date and `source:` (skill +
session). Never delete an entry that stops reproducing — mark it `superseded` with the date
and what changed.

---

## Platform gotchas — workflow build layer

### G1. Code nodes use `handler(context)`, not top-level code
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
Code node bodies must define `def handler(context):` returning a dict, reading inputs via
`context.get_input("name")`. A top-level `return` is a `SyntaxError`. This convention is
documented only in the plugin's `testing.md` (under `run_code`), not in the main workflows
skill.

### G2. Pinned inputs fail the run on undefined AND on empty string
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
An `inputSchema` pin whose `sourcePath` resolves to undefined (e.g. `$.result.experience`
when the enrichment came back empty) fails the entire run with "Input ref resolution
failed" — and a pin that resolves to `""` fails with "missing required inputs".
**Fix:** pin container objects (`$.result`) and dig in code; emit non-empty sentinels
(`"none"`) for possibly-empty computed fields.

### G3. Raw array pins don't render in agent prompts
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
An agent node with an array-typed pin received the data in `stepInputs` but the model
consistently reported the prompt variable was empty (two models: gpt-5.4-nano and
gpt-5.4-mini). Flat string and object pins rendered fine on another node.
**Fix:** flatten arrays into strings/scalars in a code node before any agent consumes them.

### G4. Tool params from 2+ hops back need double wiring
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
A tool node's `inputMappingConfig` reference (`{{new_company_domain}}`) does not resolve
through an intervening conditional on its own. It worked only after the same value was ALSO
pinned on that tool node's `inputSchema` (and passed through the conditional's inputSchema —
one of the two was load-bearing; isolate when it next comes up).

### G5. `automapInputs` does not exist in the deployed MCP server
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
The plugin's own `workflows` SKILL.md documents `automapInputs: false` for pinned inputs;
the deployed `edit_node` schema rejects the key ("Unrecognized key"). Docs drift is real on
an Alpha — always dump the live tool schema (`tools/list` via `clay mcp`) before relying on
documented fields.

### G6. Rules-mode conditionals cannot compare two dynamic fields
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
`BinOp` compares a `dataPath` against a static `value` only. To branch on a comparison of
two runtime values (e.g. current vs recorded domain), compute the verdict in a code node
and route on the resulting constant string.

### G7. Behind an egress proxy, the CLI needs `NODE_USE_ENV_PROXY=1`
`status: candidate · verified: 2026-08-07 · source: CLI setup in Claude Code remote env`
Node's global fetch (undici) ignores `HTTPS_PROXY` by default, so `clay login` connects
directly and gets 403'd by the network layer while curl works. `NODE_USE_ENV_PROXY=1`
(Node ≥ 22) routes the CLI through the proxy; `clay login --device` then works headlessly
(link + code, no API keys in chat). Persist the env var in the shell profile.

### G8. `clay workflows runs get --wait` exists — don't hand-roll poll loops
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
Also: `--verbose` on `runs steps` produced empty output in this CLI version (0.1.25); plain
`runs steps` returns full `stepInputs`/`stepOutputs`.

---

## Design findings — what makes a skill's workflow good

### D1. Deterministic code beats an LLM for comparisons — decisively
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes eval`
Two models (nano and mini), given complete inputs, failed a domain-equality verdict — one
tried to answer via web search instead. The code-node + rules-router rewrite was instant,
free, and correct on all three test paths. This is the clay-gtm-architect KB's "formula
over LLM" rule holding on the Workflows surface: LLM nodes only for prose (compose steps),
never for extraction, comparison, or routing.

### D2. Enrichment can return status SUCCESS with an empty payload
`status: confirmed (2 surfaces) · verified: 2026-08-07 · source: connector dry-run + workflow build`
Observed on both the MCP connector (managed Enrich Person on a real email → `SUCCESS`,
value `{}`) and in the workflow build. Any completeness gate must test for the presence of
an actual data value, never the run status. Skills should name this trap explicitly.

### D3. Employment-resolution ordering: LinkedIn URL → people-index search → reverse-email last
`status: candidate · verified: 2026-08-07 · source: connector dry-run`
Reverse email→LinkedIn hard-errored on a real corporate email; people-index search by
name + last-known company resolved fully (employer, domain, title, current-role start
date). Bonus: the start date enables honeymoon-window (<12 months) recency ranking for free.

### D4. Two-phase model selection, refined
`status: candidate · verified: 2026-08-07 · source: track-champion-job-changes build`
The plugin's "build on nano, graduate later" guidance holds, with a sharper split: wiring
and debugging on nano, prose nodes graduate to a mid model, and anything that was going to
be a "reasoning" node should usually become a code node instead (see D1).

---

## Process findings — the skill factory itself

### P1. The eval gate pays for itself immediately
`status: confirmed · verified: 2026-08-07 · source: track-champion-job-changes v1→v3`
One cheap logic dry-run (~5 credits) produced two skill corrections; one live build
(~10 credits, 6 debug iterations) produced an architecture change plus this file. Version
the skill in git (draft commit, then validated commit) so every eval's diff is preserved.

### P2. Test in a dedicated workspace, label test assets loudly
`status: candidate · verified: 2026-08-07`
Tests so far ran in a production workspace with `[SKILL TEST]`-prefixed names — workable
but not the standing arrangement. A dedicated test workspace with the managed functions
wired remains the factory requirement.
