#!/usr/bin/env node
/**
 * Stage 4b: classify a scraped article as one of:
 *   listicle | comparison | review | guide | news | other
 *
 * Uses a small heuristic first (cheap, catches ~80%), falls back to an
 * LLM classifier only when heuristics are inconclusive.
 *
 * Usage: cat scrape.json | node detect_listicle.ts
 * Emits: { format: 'listicle'|'comparison'|'review'|'guide'|'news'|'other', confidence: 0..1, method: 'heuristic'|'llm' }
 */
import { readFileSync } from 'node:fs';

type Scrape = { url: string; title: string | null; markdown: string; h2s: string[]; h3s: string[] };
const s: Scrape = JSON.parse(readFileSync(0, 'utf8'));

const title = (s.title ?? '').toLowerCase();
const h2s = s.h2s ?? [];
const h3s = s.h3s ?? [];
const md = s.markdown ?? '';

// --- Heuristic pass ---
const titleHasCount = /\b(\d{1,3})\s+(best|top|leading|great|proven|essential|popular|amazing|useful)\b/i.test(title)
  || /\bbest\s+\d+\b/i.test(title);
const titleHasBestOrTop = /\b(best|top|leading)\b/i.test(title);
const titleHasVs = /\b(vs\.?|versus|alternatives?|compared|comparison)\b/i.test(title);
const titleHasReview = /\breview\b/i.test(title);
const titleHasHowTo = /\bhow\s+to\b/i.test(title);
const titleHasGuide = /\b(guide|tutorial|complete|ultimate)\b/i.test(title);
const numberedH2s = h2s.filter((h) => /^\s*\d+[.)]\s+\S/.test(h)).length;
const numberedH3s = h3s.filter((h) => /^\s*\d+[.)]\s+\S/.test(h)).length;
const numberedItems = Math.max(numberedH2s, numberedH3s);

if (titleHasVs) return emit('comparison', 0.9, 'heuristic');
if (titleHasReview && !titleHasCount) return emit('review', 0.85, 'heuristic');
if (titleHasHowTo && !titleHasCount) return emit('guide', 0.85, 'heuristic');

if (numberedItems >= 5 && (titleHasCount || titleHasBestOrTop)) return emit('listicle', 0.95, 'heuristic');
if (numberedItems >= 8) return emit('listicle', 0.9, 'heuristic');
if (titleHasCount && titleHasBestOrTop) return emit('listicle', 0.85, 'heuristic');

if (titleHasGuide) return emit('guide', 0.7, 'heuristic');

// --- LLM fallback: OpenAI-style chat completion ---
// If no LLM key present, degrade to a low-confidence 'other'.
const OPENAI = process.env.OPENAI_API_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!OPENAI && !ANTHROPIC) emit('other', 0.3, 'heuristic');

const excerpt = md.slice(0, 1500);
const headingList = [...h2s.slice(0, 15), ...h3s.slice(0, 15)].join('\n');
const prompt = `Classify this article into exactly one of: listicle, comparison, review, guide, news, other.

- listicle: repeating product/tool/item blocks, usually numbered (e.g. "10 Best X Tools")
- comparison: focused on comparing 2-N specific named products (e.g. "Notion vs Coda")
- review: single-product deep dive
- guide: how-to / tutorial / explainer without a repeating product structure
- news: dated announcement or event report
- other: none of the above

Title: ${s.title ?? '(unknown)'}
URL: ${s.url}

Headings:
${headingList}

First ~1500 chars of body:
${excerpt}

Reply with a single line: <label> <confidence 0-1>
Example: listicle 0.92`;

let label = 'other';
let confidence = 0.3;

try {
  if (OPENAI) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 20,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content?.trim() ?? '';
      const m = text.match(/^(listicle|comparison|review|guide|news|other)\s+(\d*\.?\d+)/i);
      if (m) { label = m[1].toLowerCase(); confidence = Math.min(1, Number(m[2])); }
    }
  } else if (ANTHROPIC) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j.content?.[0]?.text?.trim() ?? '';
      const m = text.match(/^(listicle|comparison|review|guide|news|other)\s+(\d*\.?\d+)/i);
      if (m) { label = m[1].toLowerCase(); confidence = Math.min(1, Number(m[2])); }
    }
  }
} catch (e) {
  process.stderr.write(`LLM classifier failed: ${(e as Error).message}\n`);
}

emit(label as any, confidence, 'llm');

function emit(format: string, confidence: number, method: string): never {
  process.stdout.write(JSON.stringify({ format, confidence, method }));
  process.exit(0);
}
