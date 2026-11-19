# Portfolio discovery (Clay workflow `wf_0tob8rw7JJoTpoDByc8`, "Discovery v2" trigger)

Input: one VC firm or accelerator. Output: its portfolio companies, each with Clay status and target flags, written to Supabase.
Code steps here are the source for the workflow's code nodes; node ids are in `node_ids.json`.

Weekly flow: load saved state → reuse identity if fresh (else research) → plan provider calls → Dealroom (all pages), PitchBook,
LinkedIn, Google, Salesforce reverse lookup → official directory (replay saved recipe, or discover one; health check; research
fallback if broken) → announcements from the news checkpoint → normalize → combine (only new / changed / due-for-refresh companies are
verified; the rest carry forward) → verify → Clay status in Snowflake → output → write identity, sources, run status, roster,
verifications to Supabase.

Resilience: a directory recipe that returns nothing, drops by more than half, or whose profile pages fail is marked broken; that run
falls back to research, and the next run rediscovers the recipe. News pages that fail are marked broken and the identity (incl. news
pages) is re-researched next run. Checkpoints only move forward, so a failed read never rewinds them.
