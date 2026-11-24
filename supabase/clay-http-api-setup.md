# Clay → Supabase HTTP API Setup

Data flows from Clay directly into Supabase — there is no CSV export step.
Each row in the Clay table has two HTTP API columns (one per platform) that fire
after all enrichment columns complete and POST the full row payload to the Supabase
RPC function.

## 1. Run the SQL files in order

In the Supabase SQL Editor, run these files in sequence:

1. `schema.sql` — creates all tables and indexes
2. `rpc_upsert_visibility_response.sql` — creates the RPC endpoint
3. `backfill_prompt_metadata.sql` — creates utility functions (run when needed)

## 2. Configure Clay HTTP API columns

Add two HTTP API columns at the end of your Clay table — one per platform.

### Common settings (both columns)

| Field | Value |
|-------|-------|
| Method | POST |
| URL | `https://[your-project-ref].supabase.co/rest/v1/rpc/upsert_visibility_response` |

**Headers:**
```
Content-Type: application/json
apikey: [your supabase anon key]
Authorization: Bearer [your supabase service role key]
```

> Use the **service role key** in the Authorization header so the RPC has full
> write access. The anon key is still required in `apikey` for Supabase's PostgREST
> routing. Keep both keys out of version control — store them in Clay's HTTP API
> column config, not in code.

### Body — Claude column

```json
{
  "payload": {
    "platform": "Claude",
    "run_day": "{{Batch Monday}}",
    "prompt_text": "{{Prompt}}",
    "prompt_type": "{{Prompt Type}}",
    "tags": "{{Tags}}",
    "topic": "{{Topic}}",
    "intent": "{{Intent}}",
    "pmm_use_case": "{{Pmm Use Case}}",
    "pmm_classification": "{{Pmm Classification}}",
    "branded_or_non_branded": "{{Branded Or Non Branded}}",
    "parent_brand": "{{Parent Brand}}",
    "verb_modifier": "{{Verb Modifier}}",
    "noun_modifier": "{{Noun Modifier}}",
    "verb_noun": "{{Verb+Noun}}",
    "response_text": "{{Claude Parsed Response.response}}",
    "cited_urls": "{{Claude Parsed Response.cited_urls}}",
    "cited_domains": "{{Claude Parsed Response.cited_domains}}",
    "cited_titles": "{{Claude Parsed Response.cited_titles}}",
    "clay_mentioned": "{{Claude Response Analyzer.clayMentioned}}",
    "clay_mention_position": "{{Claude Response Analyzer.clayMentionPosition}}",
    "clay_mention_snippet": "{{Claude Response Analyzer.clayMentionSnippet}}",
    "brand_sentiment": "{{Claude Response Analyzer.brandSentiment}}",
    "brand_sentiment_score": "{{Claude Response Analyzer.brandSentimentScore}}",
    "clay_recommended_followup": "{{Claude Response Analyzer.clayRecommendedFollowup}}",
    "clay_followup_snippet": "{{Claude Response Analyzer.clayFollowupSnippet}}",
    "claygent_or_mcp_mentioned": "{{Claude Response Analyzer.claygentOrMcpMentioned}}",
    "number_of_tools_recommended": "{{Claude Response Analyzer.numberOfToolsRecommended}}",
    "sentiment_score": "{{Claude Response Analyzer.sentimentScore}}",
    "citation_type": "{{Claude Response Analyzer.citationType}}",
    "citations": "{{Claude Response Analyzer.citations}}",
    "competitors_mentioned": "{{Claude Response Analyzer.competitorsMentioned}}",
    "themes": "{{Claude Response Analyzer.themes}}",
    "primary_use_case_attributed": "{{Claude Response Analyzer.primaryUseCaseAttributed}}",
    "positioning_vs_competitors": "{{Claude Response Analyzer.positioningVsCompetitors}}",
    "total_credits_charged": "{{Claude Response Analyzer.totalCreditsCharged}}"
  }
}
```

### Body — ChatGPT column

Identical to the Claude body, with two changes:
- `"platform": "ChatGPT"`
- All `{{Claude ...}}` references → `{{ChatGPT ...}}`
  (e.g. `{{ChatGPT Parsed Response.response}}`, `{{Chat GPT Response Analyzer.clayMentioned}}`, etc.)

### About `run_day` (added 2026-11)

`run_day` is the DATE every dashboard chart groups by. Since 2026-10-31
the ingest job runs weekly, and a batch straddles UTC midnight: ChatGPT
finishes early, Claude + Branded finish late, so Supabase's
`CURRENT_DATE` stamps them on different calendar days. The fix is to
pin every row in a batch to the same date by sending `run_day` from
Clay.

- Pass the **Monday of the batch's scheduled week** (YYYY-MM-DD, UTC).
- Add a formula column to the Clay table named e.g. `Batch Monday`,
  with value `monday_of_this_week()` or equivalent — any Clay
  expression that returns the ISO Monday of the batch date.
- If the field is missing or empty, the RPC falls back to
  `CURRENT_DATE`, so this is a non-breaking change.
- All rows in one batch MUST share one `run_day`; mixing values across
  a batch splits the batch across chart points again.

## 3. Upsert behavior

| Scenario | Result |
|----------|--------|
| Clay runs a prompt on a new `run_day` | New response row inserted |
| Clay re-runs a prompt on the same `run_day` | Existing row overwritten (upsert) |
| Prompt metadata changes, row re-runs | Prompt + that `run_day`'s response updated |
| Same prompt, different platform, same `run_day` | Two separate rows — one per platform |
| Row deleted from Clay | Prompt marked `is_active = false` after 7 days by scheduled job |

## 4. Prompt lifecycle notes

- **Do not edit prompt text** to fix typos — this creates a new prompt record. Delete
  the old row and add a new one instead.
- To retroactively propagate a metadata change across all historical responses,
  run: `SELECT backfill_prompt_metadata('your prompt text here');`
- Dates are set by Supabase (`NOW()`), not Clay. Clay sends no date in the payload.
