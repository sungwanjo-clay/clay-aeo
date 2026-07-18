#!/usr/bin/env node
/**
 * Stage 8b: enrich a drafted mirror article by replacing placeholders with
 * real assets. Reads the outline saved by the format skill, walks each
 * product block, and:
 *   - captures a screenshot (pricing page → homepage fallback)
 *   - extracts pricing structure via the LLM
 *   - substitutes into the article text
 *
 * Usage: node enrich_article.ts <slug>
 *   Reads:  .aeo-outreach/drafts/<slug>.md
 *           .aeo-outreach/drafts/<slug>.products.json  (list of products with resolved domains)
 *   Writes: .aeo-outreach/drafts/<slug>.enriched.md
 *           .aeo-outreach/drafts/<slug>-assets/*.png
 *
 * The products.json is written by the skill body after stage 8a — each entry:
 *   { name: "Clay", domain: "clay.com", is_clay: true }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const slug = process.argv[2];
if (!slug) { console.error('Usage: node enrich_article.ts <slug>'); process.exit(1); }

const DRAFT_PATH = `.aeo-outreach/drafts/${slug}.md`;
const PRODUCTS_PATH = `.aeo-outreach/drafts/${slug}.products.json`;
const OUT_PATH = `.aeo-outreach/drafts/${slug}.enriched.md`;
const ASSETS_DIR = `.aeo-outreach/drafts/${slug}-assets`;

const SCRIPT_DIR = new URL('.', import.meta.url).pathname;

let article = readFileSync(DRAFT_PATH, 'utf8');
const products: { name: string; domain: string; is_clay?: boolean }[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

mkdirSync(ASSETS_DIR, { recursive: true });

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A product's block starts at "## N. Product" or "### N. Product" and ends
// at the next heading of same or higher level.
type Block = { name: string; start: number; end: number; text: string };
const blocks: Block[] = [];
const lines = article.split('\n');

const headingRe = /^(#{1,6})\s+\d+[.)]\s+(.+?)\s*$/;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(headingRe);
  if (!m) continue;
  const level = m[1].length;
  const name = m[2].trim();
  // Find next heading at same or higher level.
  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) {
    const nxt = lines[j].match(/^(#{1,6})\s+/);
    if (nxt && nxt[1].length <= level) { end = j; break; }
  }
  blocks.push({ name, start: i, end, text: lines.slice(i, end).join('\n') });
}

console.log(`Found ${blocks.length} product blocks in ${DRAFT_PATH}`);

const enrichmentLog: any[] = [];

for (const block of blocks) {
  const matched = products.find((p) => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(block.name));
  if (!matched) { console.log(`  ? no product match for "${block.name}" — skipping`); continue; }

  console.log(`\n▸ ${matched.name} (${matched.domain})`);

  // --- Screenshot ---
  const shotPath = `${ASSETS_DIR}/${slugify(matched.name)}.png`;
  const shotR = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/capture_screenshot.ts`, `https://${matched.domain}/`, shotPath], { encoding: 'utf8' });
  let shot: { path: string | null; source: string; url_used: string | null } = { path: null, source: 'failed', url_used: null };
  if (shotR.status === 0) {
    try { shot = JSON.parse(shotR.stdout); } catch { /* skip */ }
  }
  console.log(`  screenshot: ${shot.source} → ${shot.path ?? 'none'}`);

  // --- Pricing ---
  const priceR = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/extract_pricing.ts`, `https://${matched.domain}/`], { encoding: 'utf8' });
  let pricing: { model: string; entry_price: string | null; tiers: string[]; summary: string; source_url: string } = {
    model: 'unknown', entry_price: null, tiers: [], summary: 'Pricing varies — verify on the official site', source_url: `https://${matched.domain}/`,
  };
  if (priceR.status === 0) {
    try { pricing = JSON.parse(priceR.stdout); } catch { /* keep default */ }
  }
  console.log(`  pricing:   ${pricing.summary}`);

  // --- Substitute in the block ---
  let newText = block.text;

  // Replace pricing snapshot bullet.
  newText = newText.replace(
    /^(\s*[-*]?\s*)Pricing:\s*Pricing varies\s*[—-]\s*verify on the official site.*$/gim,
    `$1Pricing: ${pricing.summary}`
  );
  // Also swap any other "Pricing:" line whose value contains the placeholder.
  newText = newText.replace(
    /^(\s*[-*]?\s*)Pricing:\s*.*\(verify on the official site\).*$/gim,
    `$1Pricing: ${pricing.summary}`
  );

  // Replace [Add photo] / [Add product photo] placeholders with the screenshot.
  if (shot.path) {
    const imgMd = `![${matched.name} — ${shot.source} screenshot](${shot.path})`;
    newText = newText.replace(/^\s*\[Add (product )?photo\]\s*$/gim, imgMd);
    // If no placeholder existed but the block has a "Quick Snapshot" section, insert after it.
    if (!newText.includes(imgMd)) {
      newText = newText.replace(/(Quick Snapshot[\s\S]*?)(\n\n)/, `$1\n\n${imgMd}\n$2`);
    }
  }

  // Update the article buffer.
  article = article.replace(block.text, newText);

  enrichmentLog.push({
    product: matched.name,
    domain: matched.domain,
    screenshot: shot,
    pricing,
  });
}

writeFileSync(OUT_PATH, article);
writeFileSync(`.aeo-outreach/drafts/${slug}.enrichment.json`, JSON.stringify(enrichmentLog, null, 2));

console.log(`\nWrote ${OUT_PATH}`);
console.log(`Assets:   ${ASSETS_DIR}/`);
console.log(`Log:      .aeo-outreach/drafts/${slug}.enrichment.json`);
