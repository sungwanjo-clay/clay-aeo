#!/usr/bin/env node
/**
 * Stage 8c: publish an enriched mirror article to Google Docs for human review.
 *
 * Uploads the enriched markdown as a Google Doc (Drive can auto-convert
 * markdown to Docs by setting mimeType='application/vnd.google-apps.document'
 * with a text/markdown source body).
 *
 * Uploads each screenshot as an image file in the same Drive folder,
 * because reliably splicing images into the Docs body via the Docs API
 * requires batchUpdate InsertInlineImageRequest calls and is much fiddlier
 * than the value it adds. The Doc references the screenshots by filename
 * and the user can drag them in during review (or accept the standalone
 * image files alongside).
 *
 * Auth: the agent proxy injects OAuth for *.googleapis.com. No key needed.
 *
 * Usage: node publish_gdoc.ts <slug>
 *   Reads:  .aeo-outreach/drafts/<slug>.enriched.md
 *           .aeo-outreach/drafts/<slug>-assets/*.png
 *   Prints: JSON { doc_url, folder_id, image_urls: {filename: url} }
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const slug = process.argv[2];
if (!slug) { console.error('Usage: node publish_gdoc.ts <slug>'); process.exit(1); }

const MD_PATH = `.aeo-outreach/drafts/${slug}.enriched.md`;
const ASSETS_DIR = `.aeo-outreach/drafts/${slug}-assets`;
const FOLDER_NAME = 'AEO Outreach';
const PARENT_HINT = 'Editorial Content';

const md = readFileSync(MD_PATH, 'utf8');
const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;

// --- Find or create the "Editorial Content / AEO Outreach" folder ---
async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (!r.ok) throw new Error(`Drive folder search ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const body: any = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Drive folder create ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.id;
}

const parentId = await findFolder(PARENT_HINT);
let folderId = parentId ? await findFolder(FOLDER_NAME, parentId) : await findFolder(FOLDER_NAME);
if (!folderId) folderId = await createFolder(FOLDER_NAME, parentId ?? undefined);
console.log(`Folder: ${folderId}`);

// --- Upload markdown → Google Doc ---
// Drive supports multipart upload with target mimeType conversion.
const boundary = 'aeo-outreach-' + Math.random().toString(36).slice(2);
const meta = { name: `AEO Outreach — ${title}`, mimeType: 'application/vnd.google-apps.document', parents: [folderId] };
const body =
  `--${boundary}\r\n` +
  `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
  JSON.stringify(meta) + `\r\n` +
  `--${boundary}\r\n` +
  `Content-Type: text/markdown\r\n\r\n` +
  md + `\r\n` +
  `--${boundary}--`;

const docR = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
  method: 'POST',
  headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  body,
});
if (!docR.ok) { console.error(`Doc upload ${docR.status}: ${await docR.text()}`); process.exit(1); }
const doc = await docR.json();
console.log(`Doc:    ${doc.webViewLink}`);

// --- Upload screenshots ---
const imageUrls: Record<string, string> = {};
try {
  const entries = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.png'));
  for (const f of entries) {
    const path = join(ASSETS_DIR, f);
    const size = statSync(path).size;
    const buf = readFileSync(path);
    const imgBoundary = 'aeo-img-' + Math.random().toString(36).slice(2);
    const imgMeta = { name: f, mimeType: 'image/png', parents: [folderId] };
    const imgBody = Buffer.concat([
      Buffer.from(
        `--${imgBoundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(imgMeta) + `\r\n` +
        `--${imgBoundary}\r\n` +
        `Content-Type: image/png\r\n\r\n`
      ),
      buf,
      Buffer.from(`\r\n--${imgBoundary}--`),
    ]);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${imgBoundary}`, 'Content-Length': String(imgBody.length) },
      body: imgBody,
    });
    if (r.ok) { const j = await r.json(); imageUrls[f] = j.webViewLink; console.log(`  image  ${f} (${size}B) → ${j.webViewLink}`); }
    else { console.error(`  image ${f} failed ${r.status}`); }
  }
} catch (e) {
  console.error(`Screenshots dir missing or empty (${(e as Error).message}) — skipping image upload`);
}

process.stdout.write(JSON.stringify({
  doc_url: doc.webViewLink,
  doc_id: doc.id,
  folder_id: folderId,
  image_urls: imageUrls,
}, null, 2));
