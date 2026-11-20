# Testing the PLG dashboard

Four layers, cheapest first. Run all of them before publishing a new version (`DB` = a folder of downloaded artifact-db
documents: `ArtifactData list` of `cache`, `youtube`, `config` and `get` of `portfolio/meta`, `portfolio/sources` and a few
`portfolio/companies-<i>`, each with `out_dir` = `DB`).

| Layer | Command | Catches |
|---|---|---|
| Types and lint | `npx tsc --noEmit -p tsconfig.json` · `npx eslint artifact lib components` | Wiring and type errors |
| Data contracts | run by the page, `refresh-cache.mjs pack` and the health check (lib/plg/contracts.ts) | Missing ranges or rows, impossible counts (conversions above visitors), wrong shape |
| Reconciliation | `npm run test:audit -- DB/cache DB/youtube` | Tiles ≠ tables ≠ funnels ≠ What moved; parts not summing to totals (channels, devices, landing pages, video rows, tiers) |
| End to end | `npm run test:e2e -- DB` (add `--quick` for 2 presets) | Page or console errors, crashed sections, "NaN" / "undefined" / "Infinity" on screen, missing sections, on every tab × preset × comparison; plus broken saved copies (no database, corrupt part, missing part, a result breaking its contract) must show a message, not zeros |

The daily health check (docs/health-check.md) runs the contracts against the live saved copies every morning and flags
copies that are stale, partial, cover only one view, or fail their checks.

Known gaps: the queries themselves only run in Sigma (the Clay Sigma connector), so CI can't execute them; the daily
refresh is their end-to-end run, and `pack` refuses any result that fails its contract.
