#!/usr/bin/env node
/**
 * Stage 9b: generate a paste-ready Clay entry that matches the target
 * article's exact tone and structure, so the author can drop it into their
 * listicle verbatim.
 *
 * The block mimics:
 *   - the target's heading depth for product entries (H2 vs H3 vs bold)
 *   - the sub-section pattern (Quick Snapshot / Best for / Pros & Cons / etc)
 *   - the bullet style (dashes vs asterisks, snapshot bullets vs prose)
 *   - the article's voice (formal vs punchy vs sales-y)
 *
 * Usage: node generate_mention_block.ts <scrape.json> <clay_positioning.json>
 *
 * scrape.json: the target article scrape (from scrape_url.ts)
 * clay_positioning.json: the Clay facts for the article's category
 *
 * Prints:
 *   { block_markdown, tone_notes, structure_notes, position_recommendation }
 */
import { readFileSync } from 'node:fs';

const scrapePath = process.argv[2];
const clayPath = process.argv[3];
if (!scrapePath || !clayPath) {
  console.error('Usage: node generate_mention_block.ts <scrape.json> <clay_positioning.json>');
  process.exit(1);
}

const OPENAI = process.env.OPENAI_API_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!OPENAI && !ANTHROPIC) { console.error('Need OPENAI_API_KEY or ANTHROPIC_API_KEY'); process.exit(1); }

type Scrape = { url: string; title: string | null; markdown: string; h2s: string[]; h3s: string[]; author: string | null };
type ClayFacts = {
  best_for: string;                 // one-line positioning for this article's category
  pricing_summary: string;          // one-line pricing
  key_features: string[];           // 3-6 features that matter for this category
  differentiator: string;           // one sentence: what Clay does that others don't
  proof: string;                    // one concrete customer story or stat
};

const scrape: Scrape = JSON.parse(readFileSync(scrapePath, 'utf8'));
const clay: ClayFacts = JSON.parse(readFileSync(clayPath, 'utf8'));

// --- Extract one full existing product block as a style exemplar. ---
// Find the first numbered product heading and its next sibling heading.
const lines = scrape.markdown.split('\n');
const productHeadingRe = /^(#{1,6})\s+\d+[.)]\s+\S/;
let exemplarStart = -1, exemplarEnd = lines.length;
for (let i = 0; i < lines.length; i++) {
  if (productHeadingRe.test(lines[i])) { exemplarStart = i; break; }
}
if (exemplarStart >= 0) {
  const level = lines[exemplarStart].match(/^#+/)![0].length;
  for (let j = exemplarStart + 1; j < lines.length; j++) {
    const nxt = lines[j].match(/^(#{1,6})\s+/);
    if (nxt && nxt[1].length <= level) { exemplarEnd = j; break; }
  }
}
const exemplar = exemplarStart >= 0
  ? lines.slice(exemplarStart, exemplarEnd).join('\n')
  : scrape.markdown.slice(0, 2500);

// --- LLM: mimic exemplar structure + tone for a Clay entry ---
const prompt = `You are writing a single product entry to be inserted into an existing listicle article.

The article's title: "${scrape.title ?? '(unknown)'}"
The article's URL: ${scrape.url}

Below is one existing product entry from that article — study its structure, heading levels, sub-section pattern, bullet style, sentence length, and voice. Match all of it.

--- EXEMPLAR (an existing entry from the target article) ---
${exemplar}
--- END EXEMPLAR ---

Now write a Clay entry that would slot in naturally alongside it. Use these facts (do NOT invent anything else):

  Positioning:   ${clay.best_for}
  Pricing:       ${clay.pricing_summary}
  Key features:  ${clay.key_features.join(', ')}
  What's unique: ${clay.differentiator}
  Proof:         ${clay.proof}

Rules:
1. Match the exemplar's exact heading structure — same heading level, same sub-section names (e.g. if the exemplar uses "Best for / Pricing / Pros & Cons", use those exact labels).
2. Match the exemplar's bullet style (dashes vs asterisks) and snapshot vs prose format.
3. Match voice: if the exemplar is punchy and short-sentence, be punchy. If it's formal and hedged, be formal. Never break tone.
4. Never invent facts beyond what's in the Positioning / Pricing / Key features / Unique / Proof block above.
5. Do NOT include a heading number (like "8." or "11.") — the author will number it.
6. The entry must be paste-ready markdown, nothing else. No commentary, no "here's the entry:", no preamble. Just the block.

Also return a short structural analysis (1-2 sentences each) covering:
  - tone_notes: how the exemplar sounds
  - structure_notes: what sections it has, in what order
  - position_recommendation: given the current alphabetical/thematic order, where Clay would slot in most naturally (as a numeric position or a "between X and Y" phrase)

Output valid JSON:
{
  "block_markdown": "<the paste-ready entry>",
  "tone_notes": "...",
  "structure_notes": "...",
  "position_recommendation": "..."
}`;

let raw = '';
try {
  if (OPENAI) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) { console.error(`OpenAI ${r.status}: ${await r.text()}`); process.exit(1); }
    const j = await r.json();
    raw = j.choices?.[0]?.message?.content ?? '';
  } else {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY the JSON object.' }],
      }),
    });
    if (!r.ok) { console.error(`Anthropic ${r.status}: ${await r.text()}`); process.exit(1); }
    const j = await r.json();
    raw = j.content?.[0]?.text ?? '';
  }
} catch (e) { console.error(`LLM call failed: ${(e as Error).message}`); process.exit(1); }

const jsonBlock = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
try {
  const parsed = JSON.parse(jsonBlock);
  process.stdout.write(JSON.stringify(parsed, null, 2));
} catch (e) {
  console.error(`Could not parse LLM output as JSON:\n${raw}`);
  process.exit(1);
}
