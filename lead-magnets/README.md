# Lead Magnets

Free tools on clay.com that show a gated teaser and deep-link visitors into Clay's GTM agent to
finish the job.

| File | For |
|---|---|
| `00-alignment-prompt.md` | **Ploy**: the goal, the endpoint contract, and how each page should behave |
| `01-gtm-agent-prompt.md` | **GTM agent**: the handoff, the "numbers must match" rule, and what to send back |
| `<magnet>/play-spec.md` | **Everyone**: the single definition of the logic, with a version and golden tests |
| `<magnet>/workflow/` | The pre-signup Clay workflow's code and contract |

## The flow for each magnet

The play spec sits at the centre. The page's workflow and the GTM agent's build both follow it,
so the visitor sees the same numbers before and after signup.

```
            ┌──────────── play-spec.md (vN) ────────────┐
            ▼                                            ▼
  Claude: workflow + endpoint                 GTM agent: deep-link prompt + build
            │                                            │
            └──────► Ploy: page fills the prompt ◄───────┘
                     with spec_version, counts and the exact emails
```

1. **Claude** writes the play spec (`vN`), builds the workflow and endpoint to match it, and
   runs the golden tests.
2. **Sungwan** sends `01-gtm-agent-prompt.md` and the play spec to the GTM agent.
3. **The GTM agent** sends back:
   - where the spec will live (a skill, or inline in the prompt)
   - any step it can't match exactly
   - the deep-link format
   - its prompt template
   - its golden-test results from a fresh workspace
4. **Claude** compares the GTM agent's golden results with the endpoint's.
   - If a step can't be matched, Claude changes the workflow to match what the agent can build,
     because the agent's build is what the visitor keeps. That bumps the spec to `vN+1`, and the
     loop goes back to step 2.
5. **Claude** adds the deep-link format and prompt template to `00-alignment-prompt.md`, and
   Sungwan sends it to **Ploy**.
6. **Before launch,** Sungwan signs up as a brand-new user through the live page with golden lists
   B and C. The page and the GTM agent must show identical counts.

**Changing the logic later.** Change the play spec first and bump its version. Then update the
workflow, the endpoint's `SPEC_VERSION`, and the GTM agent's skill or prompt together, and re-run
the golden tests.
