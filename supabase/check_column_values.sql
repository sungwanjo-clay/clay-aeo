-- What are the actual distinct values in claygent_or_mcp_mentioned?
SELECT claygent_or_mcp_mentioned, COUNT(*)
FROM responses
WHERE run_day >= '2026-04-08'
GROUP BY claygent_or_mcp_mentioned
ORDER BY COUNT(*) DESC;
