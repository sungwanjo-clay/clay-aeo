#!/usr/bin/env node
/**
 * Extract structured pricing info for a product from its /pricing page.
 *
 * Usage: node extract_pricing.ts <product_url>
 * Prints JSON:
 *   { model: 'freemium'|'paid_tiers'|'usage_based'|'enterprise'|'quote_only'|'unknown',
 *     entry_price: 'free' | string | null,
 *     tiers: string[],
 *     summary: string,   // one-line for the "Pricing:" snapshot bullet
 *     source_url: string }
 *
 * Delegates the actual parsing to the same LLM used elsewhere in this skill
 * (OPENAI_API_KEY or ANTHROPIC_API_KEY). Scraping is the same
 * fetch+Readability→Firecrawl fallback as scrape_url.ts.
 */
import { spawnSync } from 'node:child_process';

const productUrl = process.argv[2];
if (!productUrl) { console.error('Usage: node extract_pricing.ts <product_url>'); process.exit(1); }

const OPENAI = process.env.OPENAI_API_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!OPENAI && !ANTHROPIC) { emit({ model: 'unknown', entry_price: null, tiers: [], summary: 'Pricing varies — verify on the official site', source_url: productUrl }); process.exit(0); }

const base = new URL(productUrl);
const attempts = [
  `${base.protocol}//${base.host}/pricing`,
  `${base.protocol}//${base.host}/plans`,
  `${base.protocol}//${base.host}/`,
];

const SCRIPT_DIR = new URL('.', import.meta.url).pathname;

let scrape: any = null;
let usedUrl = '';
for (const u of attempts) {
  const r = spawnSync('npx', ['tsx', `${SCRIPT_DIR}/scrape_url.ts`, u], { encoding: 'utf8' });
  if (r.status === 0) {
    try {
      const parsed = JSON.parse(r.stdout);
      if ((parsed.markdown ?? '').length > 800) { scrape = parsed; usedUrl = u; break; }
    } catch { /* skip */ }
  }
}
if (!scrape) { emit({ model: 'unknown', entry_price: null, tiers: [], summary: 'Pricing varies — verify on the official site', source_url: productUrl }); process.exit(0); }

const md = scrape.markdown.slice(0, 6000);
const prompt = `Extract pricing info from this pricing page markdown. Return strict JSON only.

Return shape:
{
  "model": one of "freemium" | "paid_tiers" | "usage_based" | "enterprise" | "quote_only" | "unknown",
  "entry_price": string like "$29/mo" or "free" or null if not shown,
  "tiers": ["Starter","Pro","Enterprise"] (names only, up to 5),
  "summary": one-line for a "Pricing:" bullet, e.g. "Free plan, then Launch/Growth/Enterprise credit tiers"
}

Rules:
- If pricing is not disclosed on the page ("contact sales", "custom", no numbers), model = "quote_only" or "enterprise", entry_price = null.
- Never invent numbers. If unclear, use null.
- summary must be < 120 chars and never end with a period.

Page markdown (first 6000 chars):
${md}`;

let answer = '';
try {
  if (OPENAI) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (r.ok) { const j = await r.json(); answer = j.choices?.[0]?.message?.content ?? ''; }
  } else {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt + '\n\nRespond with ONLY the JSON object.' }],
      }),
    });
    if (r.ok) { const j = await r.json(); answer = j.content?.[0]?.text ?? ''; }
  }
} catch (e) { console.error(`LLM pricing extract failed: ${(e as Error).message}`); }

let parsed: any = { model: 'unknown', entry_price: null, tiers: [], summary: 'Pricing varies — verify on the official site' };
try {
  const jsonBlock = answer.match(/\{[\s\S]*\}/)?.[0];
  if (jsonBlock) parsed = { ...parsed, ...JSON.parse(jsonBlock) };
} catch { /* keep default */ }

emit({ ...parsed, source_url: usedUrl });

function emit(x: object) { process.stdout.write(JSON.stringify(x)); }
