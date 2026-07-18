#!/usr/bin/env node
/**
 * Runner that drives stages 1-6 sequentially and prints the shortlist for
 * stage 7 human approval. Stages 8-9 (drafting) are handled by the skill
 * body via handoff to outline-from-url-skill + a format skill — not by this
 * runner.
 *
 * Usage: tsx run_pipeline.ts [--days 14] [--limit 200] [--min-dr 30] [--min-traffic 5000]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = new Map(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, [])
);
const days = args.get('days') ?? '14';
const limit = args.get('limit') ?? '200';
const minDr = args.get('min-dr') ?? '30';
const minTraffic = args.get('min-traffic') ?? '5000';
const SCRIPT_DIR = new URL('.', import.meta.url).pathname;

mkdirSync('.aeo-outreach', { recursive: true });

function run(script: string, extra: string[] = []) {
  console.log(`\n\x1b[1m▸ ${script} ${extra.join(' ')}\x1b[0m`);
  const r = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/${script}`, ...extra], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\x1b[31m${script} exited ${r.status}\x1b[0m`); process.exit(r.status ?? 1); }
}

function pipe(script: string, stdin: string): { code: number; stdout: string } {
  const r = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/${script}`], { input: stdin, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout };
}

// Stage 1
run('fetch_candidates.ts', ['--days', days, '--limit', limit]);
// Stage 2
run('domain_filter.ts');
// Stage 3
run('ahrefs_check.ts', ['--min-dr', minDr, '--min-traffic', minTraffic]);

// Stage 4 + 5 (per-URL): scrape → classify → mention check
type Row = { domain: string; url: string; title: string | null; citations: number; ahrefs_dr: number | null; ahrefs_traffic: number | null };
const rows: Row[] = JSON.parse(readFileSync('.aeo-outreach/candidates_dr_passed.json', 'utf8'));
console.log(`\n\x1b[1m▸ scrape + classify + mention check across ${rows.length} URLs\x1b[0m`);

const targets: any[] = [];
for (const [i, row] of rows.entries()) {
  process.stdout.write(`  [${i + 1}/${rows.length}] ${row.domain} ... `);
  const scrapeR = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/scrape_url.ts`, row.url], { encoding: 'utf8' });
  if (scrapeR.status !== 0) { console.log('scrape failed'); continue; }
  const scrape = JSON.parse(scrapeR.stdout);

  const cls = pipe('detect_listicle.ts', JSON.stringify(scrape));
  if (cls.code !== 0) { console.log('classify failed'); continue; }
  const { format, confidence } = JSON.parse(cls.stdout);
  if (!['listicle', 'comparison'].includes(format)) { console.log(`skip (${format} ${confidence})`); continue; }

  const men = pipe('check_clay_mention.ts', JSON.stringify(scrape));
  if (men.code !== 0) { console.log('mention check failed'); continue; }
  const mention = JSON.parse(men.stdout);
  if (mention.mentioned) { console.log(`already mentions Clay (${mention.kind})`); continue; }

  console.log(`\x1b[32mTARGET\x1b[0m — ${format} — author: ${scrape.author ?? '(unknown)'}`);
  targets.push({
    ...row,
    scrape_title: scrape.title,
    author: scrape.author,
    published_date: scrape.published_date,
    format,
    format_confidence: confidence,
    existing_mention_kind: mention.kind,
    h2s: scrape.h2s,
    markdown_preview: scrape.markdown.slice(0, 2000),
  });
}
writeFileSync('.aeo-outreach/targets.json', JSON.stringify(targets, null, 2));

console.log(`\n\x1b[1m═════ Shortlist (${targets.length} targets) ═════\x1b[0m`);
console.log(`  # | DR | Traffic | Domain / Author / Title`);
console.log(`  --+----+---------+------------------------`);
for (const [i, t] of targets.entries()) {
  const n = String(i + 1).padStart(2);
  const dr = String(t.ahrefs_dr ?? '?').padStart(2);
  const tf = String(t.ahrefs_traffic ?? '?').padStart(7);
  console.log(`  ${n} | ${dr} | ${tf} | ${t.domain}`);
  console.log(`     |    |         |   ${t.scrape_title ?? t.title ?? '(no title)'}`);
  console.log(`     |    |         |   author: ${t.author ?? '(unknown)'}`);
  console.log(`     |    |         |   ${t.url}`);
}
console.log(`\nNext: run \`enrich_authors.ts\` (Clay MCP) via the skill body, then approve the subset before drafting.`);
