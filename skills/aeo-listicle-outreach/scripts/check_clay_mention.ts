#!/usr/bin/env node
/**
 * Stage 5: given a scraped article JSON on stdin, decide whether Clay is
 * already mentioned prominently enough that we should NOT target this URL.
 *
 * Emits JSON { mentioned: boolean, evidence: string | null, kind: 'link'|'heading'|'body'|'footer'|null }.
 *
 * Rules (in order):
 *   1. Any clay.com href → mentioned (link)
 *   2. "Clay" as a word in any H2/H3 → mentioned (heading — it's a listicle entry)
 *   3. "Clay" in body text > 3 occurrences AND not only in the last 15% of markdown → mentioned (body)
 *   4. Only-in-footer / see-also / navigation → NOT mentioned (footer)
 *   5. Otherwise → NOT mentioned
 */
import { readFileSync } from 'node:fs';

type Scrape = {
  url: string; title: string | null; markdown: string; h2s: string[]; h3s: string[];
};

const input: Scrape = JSON.parse(readFileSync(0, 'utf8'));
const md = input.markdown ?? '';
const headings = [...(input.h2s ?? []), ...(input.h3s ?? [])];

// 1. clay.com link check — case-insensitive, must be actual URL.
const linkMatch = md.match(/\bhttps?:\/\/(?:www\.)?clay\.com[\w\-./#?=&%]*/i);
if (linkMatch) {
  emit(true, linkMatch[0], 'link');
}

// 2. "Clay" as a section heading (word boundary, not "Barclays" etc.)
const headingHit = headings.find((h) => /(^|[^A-Za-z])Clay($|[^A-Za-z])/i.test(h));
if (headingHit) emit(true, headingHit, 'heading');

// 3/4. Body occurrences
const bodyMatches = [...md.matchAll(/(^|[^A-Za-z])(Clay)($|[^A-Za-z])/gi)];
const filtered = bodyMatches.filter((m) => {
  // Filter out common false positives.
  const ctx = md.slice(Math.max(0, m.index! - 30), m.index! + 30);
  if (/\bBarclays?\b/i.test(ctx)) return false;         // "Barclays"
  if (/\bClaymore\b/i.test(ctx)) return false;
  if (/\bclay\s+(pot|court|animation|target|pigeon)\b/i.test(ctx)) return false;
  return true;
});

if (filtered.length === 0) emit(false, null, null);

// Where do the mentions fall?
const bodyLen = md.length || 1;
const tailStart = bodyLen * 0.85;
const meaningfulInBody = filtered.filter((m) => (m.index ?? 0) < tailStart);

if (meaningfulInBody.length >= 3) {
  emit(true, meaningfulInBody[0][0], 'body');
} else if (filtered.length && meaningfulInBody.length === 0) {
  emit(false, filtered[0][0], 'footer');
} else if (meaningfulInBody.length >= 1 && meaningfulInBody.length < 3) {
  // Ambiguous — treat as NOT prominently mentioned so we still target,
  // but note it so the drafter knows there's an existing weak mention.
  emit(false, meaningfulInBody[0][0], 'body');
} else {
  emit(false, null, null);
}

function emit(mentioned: boolean, evidence: string | null, kind: 'link'|'heading'|'body'|'footer'|null): never {
  process.stdout.write(JSON.stringify({ mentioned, evidence, kind }));
  process.exit(0);
}
