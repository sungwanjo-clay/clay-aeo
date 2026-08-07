# Evaluation record — track-champion-job-changes

Skill validated end-to-end on 2026-08-07 by building and running a live Clay
workflow (Workflows Alpha) from the skill's own build plan, via the `clay` CLI
and the Clay plugin's workflow MCP tools driven over stdio.

## Method

Three test cases, one per verdict path, run through the built workflow with
`clay workflows runs test`:

| Case | Setup | Expected | Result |
|---|---|---|---|
| Mover | Real contact with a genuine recent job change; recorded account = their previous employer | verdict `moved`, FOLLOW + BACKFILL plays | PASS — dated evidence, ICP check with real headcount, grounded follow note, committee titles, backfill recommendation |
| Verified current | Same contact; recorded account = current employer | verdict `verified current` | PASS |
| Cannot verify | Nonexistent profile | verdict `could not verify`, no fabrication | PASS — enrichment returned status success with an empty payload and the workflow correctly refused to call it "no change" |

Total cost of all test runs and debug iterations: ~10 credits + negligible LLM.

## Version history of the skill (see git history of SKILL.md)

- **v1 → v2** (logic dry-run via Clay connector): reordered employment-resolution
  paths (LinkedIn URL → people-index search → reverse-email last, since
  reverse-email proved the weakest); named the "status SUCCESS with empty
  payload" trap; added honeymoon-window recency ranking from the current-role
  start date.
- **v2 → v3** (live workflow build): replaced the LLM job-change verdict with a
  deterministic code node + rules-mode conditional after two models failed the
  comparison task; added the "Build gotchas verified against the live Alpha"
  section.

## Findings worth re-testing as the Workflows Alpha evolves

1. Deterministic code beats an LLM for domain comparison — models given the
   task wandered to web search instead of using provided inputs.
2. Code nodes must define `handler(context)` returning a dict; top-level
   `return` is a syntax error.
3. Pinned inputs that resolve to undefined or empty string fail the whole run —
   pin container objects, not deep paths, and emit non-empty sentinels.
4. Raw array pins into agent prompts may not render; flatten to strings first.
5. Tool parameters sourced 2+ hops upstream need both an `inputMappingConfig`
   reference and a matching `inputSchema` pin on the tool node.
6. `automapInputs` (referenced in plugin docs) is not accepted by the deployed
   MCP server — docs drift; verify against live schemas.
7. Behind an egress proxy, the CLI needs `NODE_USE_ENV_PROXY=1` (Node fetch
   ignores `HTTPS_PROXY` by default).
