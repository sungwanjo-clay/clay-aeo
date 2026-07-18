#!/usr/bin/env node
/**
 * Stage 2: filter own domain, social, and competitor domains out of the
 * candidate set. Competitor list is built at runtime from the citations
 * table (citation_type = 'Competition').
 *
 * Reads .aeo-outreach/candidates.json
 * Writes .aeo-outreach/candidates_filtered.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

type Candidate = { domain: string; url: string; title: string | null; citations: number; platforms: string[] };
const candidates: Candidate[] = JSON.parse(readFileSync('.aeo-outreach/candidates.json', 'utf8'));

// Root domains we hard-block. Any subdomain also gets blocked (checked below).
const HARD_BLOCK_ROOTS = new Set([
  'clay.com',
  'youtube.com', 'linkedin.com', 'twitter.com', 'x.com', 'reddit.com',
  'facebook.com', 'instagram.com', 'tiktok.com', 'threads.net',
  'news.ycombinator.com',
  'quora.com', 'medium.com',
  // Regulatory / help-center noise
  'ftc.gov', 'ico.org.uk', 'support.google.com', 'search.ftc.gov',
]);

// Optional user-maintained override — one domain per line, # comments OK.
// Use for competitors your citation_domains labels don't cover yet.
async function loadManualDeny(): Promise<Set<string>> {
  const { readFileSync, existsSync } = await import('node:fs');
  const path = '.aeo-outreach/manual_deny.txt';
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n').map((l) => l.trim().split('#')[0].trim().toLowerCase())
      .filter(Boolean)
  );
}

function rootOf(domain: string): string {
  // Strip subdomain(s) — very rough, good enough for TLDs like .com/.io/.ai/.co.uk.
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  // Handle two-part TLDs (.co.uk, .co.jp, .com.au).
  if (parts.slice(-2).join('.').match(/^(co\.uk|co\.jp|com\.au|com\.br|org\.uk)$/)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}
const manualDeny = await loadManualDeny();
if (manualDeny.size) console.log(`Loaded ${manualDeny.size} manual deny entries from .aeo-outreach/manual_deny.txt`);

// Note: competitor domains are NOT filtered. If Apollo or ZoomInfo runs a
// listicle where Clay is missing, that's an outreach target too — we're happy
// to reciprocate with a mention in ours. Filtering happens later:
//   - Stage 4 (classifier) drops non-listicle content (docs, API refs, guides)
//   - Stage 5 (mention check) drops articles that already cite Clay
// The only competitor-adjacent block we do here is a cheap docs-subdomain
// pattern check, which saves API cost on obvious non-listicle URLs.

const DOCS_SUBDOMAIN_RE = /^(docs|developer|developers|dev|api|help|support|learn|university|kb|status|knowledge)\./i;
const DOCS_PATH_RE = /^\/(docs|reference|api|developer|help|support|learn|university|kb|status|knowledge)(\/|$)/i;

function isTechnicalDocsUrl(domain: string, url: string): boolean {
  if (DOCS_SUBDOMAIN_RE.test(domain)) return true;
  try {
    const p = new URL(url).pathname;
    if (DOCS_PATH_RE.test(p)) return true;
  } catch { /* bad URL, keep it and let the scraper fail naturally */ }
  return false;
}

const dropCounts = { hardBlock: 0, docs: 0, manualDeny: 0 };
const filtered = candidates.filter((c) => {
  const d = c.domain.toLowerCase();
  const root = rootOf(d);
  if (HARD_BLOCK_ROOTS.has(root)) { dropCounts.hardBlock++; return false; }
  if (isTechnicalDocsUrl(d, c.url)) { dropCounts.docs++; return false; }
  if (manualDeny.has(d) || manualDeny.has(root)) { dropCounts.manualDeny++; return false; }
  return true;
});
console.log(`Dropped: ${dropCounts.hardBlock} hard-block, ${dropCounts.docs} docs-pattern, ${dropCounts.manualDeny} manual-deny`);

writeFileSync('.aeo-outreach/candidates_filtered.json', JSON.stringify(filtered, null, 2));
console.log(`Filter pass: ${filtered.length} / ${candidates.length}`);
