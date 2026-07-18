#!/usr/bin/env node
/**
 * Stage 3: query Ahrefs Site Explorer for domain rating + monthly organic
 * traffic on each candidate domain. Rejects rows below the configured floors.
 *
 * Ahrefs API v3 reference: https://docs.ahrefs.com/api/v3
 * Auth: Bearer token from Account Settings → API Keys → Generate MCP key
 *
 * Usage: node ahrefs_check.ts --min-dr 30 --min-traffic 5000
 * Reads .aeo-outreach/candidates_filtered.json
 * Writes .aeo-outreach/candidates_dr_passed.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.AHREFS_TOKEN;
if (!TOKEN) { console.error('AHREFS_TOKEN missing'); process.exit(1); }

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, [])
);
const MIN_DR = Number(args.get('min-dr') ?? 30);
const MIN_TRAFFIC = Number(args.get('min-traffic') ?? 5000);
const CONCURRENCY = 5;

type Candidate = { domain: string; url: string; title: string | null; citations: number; platforms: string[] };
const candidates: Candidate[] = JSON.parse(readFileSync('.aeo-outreach/candidates_filtered.json', 'utf8'));

// Group by domain — one Ahrefs call per unique domain.
const domains = [...new Set(candidates.map((c) => c.domain))];

type DomainMetrics = { dr: number | null; traffic: number | null; error?: string };
const metrics = new Map<string, DomainMetrics>();

async function fetchDomain(domain: string): Promise<DomainMetrics> {
  const params = new URLSearchParams({
    target: domain,
    mode: 'domain',
    protocol: 'both',
    select: 'domain_rating,traffic',
  });
  const res = await fetch(`https://api.ahrefs.com/v3/site-explorer/overview?${params}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) return { dr: null, traffic: null, error: `HTTP ${res.status}` };
  const data: { overview?: { domain_rating?: number; traffic?: number } } = await res.json();
  return { dr: data.overview?.domain_rating ?? null, traffic: data.overview?.traffic ?? null };
}

async function runBatch() {
  const queue = [...domains];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const d = queue.shift()!;
      try { metrics.set(d, await fetchDomain(d)); }
      catch (e) { metrics.set(d, { dr: null, traffic: null, error: (e as Error).message }); }
    }
  });
  await Promise.all(workers);
}
await runBatch();

const enriched = candidates.map((c) => {
  const m = metrics.get(c.domain) ?? { dr: null, traffic: null };
  return { ...c, ahrefs_dr: m.dr, ahrefs_traffic: m.traffic, ahrefs_error: m.error ?? null };
});

const passed = enriched.filter((c) => {
  if (c.ahrefs_dr === null || c.ahrefs_traffic === null) return false;
  return c.ahrefs_dr >= MIN_DR && c.ahrefs_traffic >= MIN_TRAFFIC;
});

writeFileSync('.aeo-outreach/candidates_dr_passed.json', JSON.stringify(passed, null, 2));
writeFileSync('.aeo-outreach/candidates_dr_all.json', JSON.stringify(enriched, null, 2));

console.log(`Ahrefs pass: ${passed.length} / ${enriched.length}  (min_dr=${MIN_DR}, min_traffic=${MIN_TRAFFIC})`);
const errored = enriched.filter((c) => c.ahrefs_error);
if (errored.length) {
  console.log(`\n${errored.length} domains errored — first 5:`);
  for (const e of errored.slice(0, 5)) console.log(`  ${e.domain}  →  ${e.ahrefs_error}`);
}
