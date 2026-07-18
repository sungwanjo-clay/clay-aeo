#!/usr/bin/env node
/**
 * Capture a screenshot for a product's block in the mirror article.
 *
 * Strategy: try {product_domain}/pricing first — that page usually has the
 * feature/pricing table that best captures what the tool does. If /pricing
 * isn't a real page (404 or thin content), fall back to the homepage hero.
 *
 * Uses Playwright with the pre-installed Chromium at /opt/pw-browsers.
 *
 * Usage:
 *   node capture_screenshot.ts <product_url> <out_path>
 *
 * Prints JSON: { path, source: 'pricing'|'homepage'|'failed', title, url_used }
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const productUrl = process.argv[2];
const outPath = process.argv[3];
if (!productUrl || !outPath) {
  console.error('Usage: node capture_screenshot.ts <product_url> <out_path>');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chromium/120';
const VIEWPORT = { width: 1440, height: 900 };
const PRICING_PATHS = ['/pricing', '/plans', '/pricing/'];

mkdirSync(dirname(outPath), { recursive: true });

function normalizeBase(u: string): string {
  const url = new URL(u);
  return `${url.protocol}//${url.host}`;
}

async function main() {
  const base = normalizeBase(productUrl);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    headless: true,
  });
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA });
  const page = await context.newPage();

  const attempts: { url: string; label: 'pricing' | 'homepage' }[] = [
    ...PRICING_PATHS.map((p) => ({ url: base + p, label: 'pricing' as const })),
    { url: base, label: 'homepage' as const },
  ];

  let succeeded: { url: string; label: 'pricing' | 'homepage' } | null = null;
  let title = '';

  for (const attempt of attempts) {
    try {
      const resp = await page.goto(attempt.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      if (!resp || resp.status() >= 400) continue;

      // Wait a beat for hero images / tables to render.
      await page.waitForTimeout(1500);

      // For pricing pages, require a plausible pricing table.
      if (attempt.label === 'pricing') {
        const hasPricingTable = await page.evaluate(() => {
          const txt = document.body?.innerText ?? '';
          return /\$\d/.test(txt) || /per month|per user|\/month|\/mo\b/i.test(txt);
        });
        if (!hasPricingTable) continue;
      }

      title = await page.title();
      succeeded = attempt;
      break;
    } catch { /* try next */ }
  }

  if (!succeeded) {
    await browser.close();
    process.stdout.write(JSON.stringify({ path: null, source: 'failed', title: null, url_used: null }));
    process.exit(2);
  }

  // Dismiss common cookie banners.
  await page.evaluate(() => {
    const patterns = [/cookie/i, /accept all/i, /got it/i];
    document.querySelectorAll<HTMLButtonElement>('button, a').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (patterns.some((r) => r.test(t))) el.click();
    });
  }).catch(() => {});
  await page.waitForTimeout(300);

  await page.screenshot({ path: outPath, type: 'png', fullPage: false });
  await browser.close();

  process.stdout.write(JSON.stringify({
    path: outPath,
    source: succeeded.label,
    title,
    url_used: succeeded.url,
  }));
}
main().catch((e) => { console.error(e); process.exit(1); });
