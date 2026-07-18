#!/usr/bin/env node
/**
 * Stage 1: fetch top-cited URLs from aeo_cache_domain_urls for benchmark
 * keywords over the last N days. Writes .aeo-outreach/candidates.json.
 *
 * Usage: node fetch_candidates.ts [--days 14] [--limit 200]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, [])
);
const days = Number(args.get('days') ?? 14);
const limit = Number(args.get('limit') ?? 200);
const platforms = (args.get('platforms') ?? '').split(',').filter(Boolean);

const sinceDay = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// Supabase PostgREST doesn't support GROUP BY natively — we use a stored
// query via .rpc if available, or fall back to pagination + aggregation here.
const url =
  `${SUPABASE_URL}/rest/v1/aeo_cache_domain_urls` +
  `?select=domain,url,title,url_count,platform,run_day` +
  `&run_day=gte.${sinceDay}` +
  `&prompt_type=ilike.benchmark` +
  (platforms.length ? `&platform=in.(${platforms.join(',')})` : '') +
  `&order=url_count.desc` +
  `&limit=${Math.min(10_000, limit * 20)}`;

const res = await fetch(url, {
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: 'application/json',
  },
});
if (!res.ok) {
  console.error(`Supabase ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const rows: {
  domain: string;
  url: string;
  title: string | null;
  url_count: number;
  platform: string;
  run_day: string;
}[] = await res.json();

// Aggregate url_count by (domain, url) across platforms + days.
const agg = new Map<string, { domain: string; url: string; title: string | null; citations: number; platforms: Set<string> }>();
for (const r of rows) {
  const key = `${r.domain}::${r.url}`;
  const cur = agg.get(key) ?? { domain: r.domain, url: r.url, title: r.title, citations: 0, platforms: new Set<string>() };
  cur.citations += Number(r.url_count) || 0;
  if (r.title && !cur.title) cur.title = r.title;
  cur.platforms.add(r.platform);
  agg.set(key, cur);
}

const candidates = [...agg.values()]
  .sort((a, b) => b.citations - a.citations)
  .slice(0, limit)
  .map((r) => ({ ...r, platforms: [...r.platforms] }));

mkdirSync('.aeo-outreach', { recursive: true });
writeFileSync('.aeo-outreach/candidates.json', JSON.stringify(candidates, null, 2));

console.log(`Wrote ${candidates.length} candidates to .aeo-outreach/candidates.json`);
console.log(`\nTop 20 by citation count:\n`);
console.log(`  # | Cites | Domain / URL`);
console.log(`  --+-------+-------------`);
for (const [i, c] of candidates.slice(0, 20).entries()) {
  const n = String(i + 1).padStart(2);
  const cites = String(c.citations).padStart(5);
  console.log(`  ${n} | ${cites} | ${c.domain}  ${c.url}`);
}
