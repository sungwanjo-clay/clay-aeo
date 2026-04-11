-- Quick patch: drop refresh_dashboard_cache() so the return type can be changed.
-- Run this FIRST, then run speed_up_sentiment_tab.sql in full.

DROP FUNCTION IF EXISTS refresh_dashboard_cache();
