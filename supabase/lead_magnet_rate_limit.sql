-- ============================================================
-- Lead magnet rate limiting
--
-- Fixed-window counters shared by every serverless instance that
-- serves /api/lead-magnets/*. Keys are hashed by the API route
-- (no raw IPs are stored). Old windows are pruned as new hits
-- arrive.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_magnet_rate_limits (
  key          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE lead_magnet_rate_limits ENABLE ROW LEVEL SECURITY;

-- Records one hit against p_key in the current p_window_seconds window
-- and returns the hit count for that window, including this one.
CREATE OR REPLACE FUNCTION lead_magnet_hit(p_key TEXT, p_window_seconds INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window TIMESTAMPTZ := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );
  v_hits INTEGER;
BEGIN
  INSERT INTO lead_magnet_rate_limits (key, window_start, hits)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET hits = lead_magnet_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  IF random() < 0.01 THEN
    DELETE FROM lead_magnet_rate_limits WHERE window_start < now() - INTERVAL '2 days';
  END IF;

  RETURN v_hits;
END;
$$;

REVOKE ALL ON FUNCTION lead_magnet_hit(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lead_magnet_hit(TEXT, INTEGER) TO service_role;
