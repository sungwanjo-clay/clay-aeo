#!/usr/bin/env node
/**
 * Stage 4: scrape a URL with fetch + Mozilla Readability, falling back to
 * Firecrawl for JS-heavy pages that return < 500 chars of body text.
 *
 * Usage: node scrape_url.ts <url>
 * Prints JSON to stdout: { url, title, author, published_date, markdown, h2s, h3s, source: 'readability'|'firecrawl' }
 */
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const url = process.argv[2];
if (!url) { console.error('Usage: node scrape_url.ts <url>'); process.exit(1); }

const MIN_BODY_CHARS = 500;
const UA = 'Mozilla/5.0 (compatible; AEOListicleOutreach/1.0; +https://clay.com)';

type ScrapeResult = {
  url: string;
  title: string | null;
  author: string | null;
  published_date: string | null;
  markdown: string;
  h2s: string[];
  h3s: string[];
  source: 'readability' | 'firecrawl';
};

async function tryReadability(u: string): Promise<ScrapeResult | null> {
  const res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } });
  if (!res.ok) return null;
  const html = await res.text();
  const dom = new JSDOM(html, { url: u });
  const doc = dom.window.document;

  // Grab headings before Readability strips them into flat text.
  const h2s = [...doc.querySelectorAll('h2')].map((n) => n.textContent?.trim() ?? '').filter(Boolean);
  const h3s = [...doc.querySelectorAll('h3')].map((n) => n.textContent?.trim() ?? '').filter(Boolean);

  const article = new Readability(doc).parse();
  if (!article || (article.textContent?.length ?? 0) < MIN_BODY_CHARS) return null;

  return {
    url: u,
    title: article.title ?? doc.querySelector('title')?.textContent?.trim() ?? null,
    author: article.byline ?? extractMetaAuthor(doc),
    published_date: extractPublishDate(doc),
    markdown: htmlToMarkdown(article.content ?? ''),
    h2s,
    h3s,
    source: 'readability',
  };
}

async function tryFirecrawl(u: string): Promise<ScrapeResult | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) { console.error('FIRECRAWL_API_KEY missing — Firecrawl fallback unavailable'); return null; }

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: u, formats: ['markdown'], onlyMainContent: true }),
  });
  if (!res.ok) return null;
  const data: {
    data?: {
      markdown?: string;
      metadata?: { title?: string; author?: string; publishedTime?: string };
    };
  } = await res.json();
  const md = data.data?.markdown ?? '';
  if (md.length < MIN_BODY_CHARS) return null;

  const h2s = extractHeadingsFromMd(md, 2);
  const h3s = extractHeadingsFromMd(md, 3);

  return {
    url: u,
    title: data.data?.metadata?.title ?? null,
    author: data.data?.metadata?.author ?? null,
    published_date: data.data?.metadata?.publishedTime ?? null,
    markdown: md,
    h2s,
    h3s,
    source: 'firecrawl',
  };
}

function extractMetaAuthor(doc: Document): string | null {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="author"]')?.content
    ?? doc.querySelector<HTMLMetaElement>('meta[property="article:author"]')?.content
    ?? doc.querySelector('[rel="author"]')?.textContent
    ?? doc.querySelector('.author, .byline, [class*="author"]')?.textContent;
  return meta?.trim() || null;
}

function extractPublishDate(doc: Document): string | null {
  const m = doc.querySelector<HTMLMetaElement>('meta[property="article:published_time"]')?.content
    ?? doc.querySelector<HTMLMetaElement>('meta[name="publish-date"]')?.content
    ?? doc.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime;
  return m ?? null;
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_m, lvl, txt) => `\n${'#'.repeat(Number(lvl))} ${stripTags(txt)}\n`)
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_m, t) => `- ${stripTags(t)}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gis, (_m, t) => `\n${stripTags(t)}\n`)
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, (_m, href, t) => `[${stripTags(t)}](${href})`)
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim(); }

function extractHeadingsFromMd(md: string, level: 2 | 3): string[] {
  const prefix = '#'.repeat(level) + ' ';
  return md.split('\n').filter((l) => l.startsWith(prefix) && !l.startsWith(prefix + '#')).map((l) => l.slice(prefix.length).trim());
}

async function main() {
  let out: ScrapeResult | null = null;
  try { out = await tryReadability(url); } catch (e) { console.error(`Readability failed: ${(e as Error).message}`); }
  if (!out) {
    try { out = await tryFirecrawl(url); } catch (e) { console.error(`Firecrawl failed: ${(e as Error).message}`); }
  }
  if (!out) { console.error('Both scrapers failed or returned insufficient content'); process.exit(2); }
  process.stdout.write(JSON.stringify(out, null, 2));
}
main();
