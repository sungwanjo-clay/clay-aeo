# Portfolio discovery — status while you were out (2026-11-19)

## Done
- **Every partnered and pending firm has run at least once.** 9,835 portfolio companies in the current week (the week of 2026-11-16, 10,773 firm↔company links): 3,600 have a Clay workspace, 906 are paying, **$29.8M paying ARR** in total. Partnered firms: 8,381 companies, 756 paying, $23.2M.
- Group 0/1 reruns: Notable, Village Global, Index, Seedcamp, Primary, Lunar and 4Founders completed.
- Non-partners are now running three at a time through Concrete Rose Capital (35 firms; driver log `scratchpad/mig/disc_2.log`).
- The dashboard is resynced at firm level. Per-source detail moved to its own db doc (`portfolio/sources`), because meta was at 251 KB of the 256 KB cap.

## Blocker 1 — apply migration 007 (needs you)
**Large rosters still lose their roster writes to `57014 statement timeout`:** a16z, Fuel, Neo, Speedinvest and 500 Global failed this way, and Index and Seedcamp lost some chunks.

**Root cause, now found:** a roster row is matched to a company on `company_identifiers (id_type, value)`. The only index on those columns is *partial* (`where id_type <> 'stealth_name'`), and the planner can't use it for that match. So every roster row scanned all ~45k identifiers.

**Local benchmark:** a 100-row ingest took 796 ms without the index and 19 ms with it.

`supabase/migrations/007_ingest_timeout.sql` now adds:
- that index;
- the `company_snapshots` index;
- a 30 s timeout for `anon`.

Paste it into the Supabase SQL editor.

## Blocker 2 — approve two publishes (needs you; auto-mode won't let me self-approve them)
- **Discovery V4** (`wf_0torcquSMPmUpqZUVsM`): writes in 100-row chunks, and carries known roster rows forward so a rerun repairs earlier lost writes.
- **Refresh Clay status V2** (`wf_0torm87ruzTzETUGfjw`): writes in 100-row chunks.

## Once both are in, I will
1. Rerun the firms that lost roster writes: a16z, Fuel, Neo, Speedinvest, 500 Global, Index and Seedcamp. They reuse cached verifications, so the rerun is cheaper.
2. Run a full sync: the company list with ARR.
3. Continue the remaining ~127 non-partners.

## Need your input
- **Non-investor partners are on hold:** JP Morgan, SVB, Mercury, Amplitude and Boardy. Do we skip them, or treat their customer lists differently?
- **Identity checks:**
  - Elevation resolved to Elevation Capital, but the sheet says accelerator.
  - Neo resolved to neo.com, IRIS to weareiris.com, and SOSA to sosa.co.
  - Chief in Tech found 0 companies; Spotlight found 1. Are these the right entities?
