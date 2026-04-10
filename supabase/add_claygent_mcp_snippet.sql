-- Run this in the Supabase SQL Editor to add the claygent/MCP snippet column.
-- Once applied, the MCP & Agent breakdown table will show the dedicated snippet
-- instead of falling back to clay_mention_snippet.

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS claygent_or_mcp_snippet TEXT;
