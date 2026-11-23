/**
 * Daily refresh of the dashboard's saved default view (for viewers without Clay Sigma).
 *
 *   node scripts/refresh-cache.mjs latest                     → {connectionId, sql}: per-source daily row counts (lib/plg/freshness.ts)
 *   node scripts/refresh-cache.mjs dataend <resultFile>       → the last day every source has fully loaded (DATAEND), with
 *        each source's verdict on stderr. Exits 3 when a source has no whole day (don't refresh).
 *   node scripts/refresh-cache.mjs sql <dataEnd> <youtubeDir>  → {connectionId, ranges, main, social, startup, slg, tier4, tier4list}: one query per
 *        tab covering every preset × comparison (lib/plg/offline.ts)
 *   node scripts/refresh-cache.mjs pack <name> <dataEnd> <resultFile> <sql-json> <outDir>
 *        → db documents for collection `cache`: <outDir>/<name>-<i>.json parts and <outDir>/<name>.json header.
 *        Exits 3 (writing nothing) when the result breaks its data contract (lib/plg/contracts.ts).
 *
 * The page reads cache/<name> (header: parts, key, storedAt, dataEnd) and cache/<name>-<i> ({s: JSON text part}),
 * the same parts shape the page writes itself (artifact/plg/main.tsx). The header's `ranges` marks a multi-view copy,
 * which the page never overwrites with a single view.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [cmd, ...args] = process.argv.slice(2)
const PART = 200_000

async function lib() {
  const out = resolve(tmpdir(), `plg-default-sql-${process.pid}.mjs`)
  await build({ entryPoints: [resolve(root, 'scripts/cache/default-sql.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out,
    tsconfig: resolve(root, 'tsconfig.json'), logLevel: 'error' })
  return import(pathToFileURL(out).href)
}

/** A Sigma query tool result, as saved by the session: {columns, rows} JSON, possibly wrapped in an MCP content envelope. */
function payloadOf(text) {
  let j = JSON.parse(text)
  if (Array.isArray(j)) j = j.find(x => x?.type === 'text')?.text ?? j
  if (j && typeof j === 'object' && Array.isArray(j.content)) j = j.content.find(x => x?.type === 'text')?.text ?? j
  if (typeof j === 'string') j = JSON.parse(j)
  if (!j || !Array.isArray(j.columns) || !Array.isArray(j.rows)) throw new Error('not a Sigma result: expected {columns, rows}')
  return { columns: j.columns, rows: j.rows }
}

if (cmd === 'latest') console.log(JSON.stringify((await lib()).latest()))
else if (cmd === 'dataend') {
  const f = (await lib()).dataEnd(payloadOf(readFileSync(args[0], 'utf8')))
  for (const s of f.sources) console.error(`${s.src.padEnd(10)} newest ${s.newest ?? '—'}  last full ${s.lastFull ?? '—'}  (${s.n} rows, typical ${s.typical == null ? '—' : Math.round(s.typical)}) ${s.note}`)
  if (!f.dataEnd) { console.error(`no complete day: ${f.limitedBy.join(', ')}`); process.exit(3) }
  console.error(`data end ${f.dataEnd} (limited by ${f.limitedBy.join(', ')})`)
  console.log(f.dataEnd)
}
else if (cmd === 'sql') console.log(JSON.stringify((await lib()).defaults(args[0], args[1])))
else if (cmd === 'pack') {
  const [name, dataEnd, resultFile, sqlJson, outDir] = args
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEnd)) throw new Error('dataEnd must be YYYY-MM-DD')
  const sqls = JSON.parse(readFileSync(sqlJson, 'utf8'))
  const key = sqls[name]
  if (!key) throw new Error(`no SQL named ${name}`)
  const ranges = sqls.ranges?.[name]
  const payload = payloadOf(readFileSync(resultFile, 'utf8'))
  // Data contract (lib/plg/contracts.ts): a result that breaks it is never stored over the current copy.
  const verdict = (await lib()).validate(name, payload, ranges ?? [])
  if (!verdict.ok) {
    console.error(JSON.stringify({ name, refused: true, rows: verdict.rows, problems: verdict.problems }))
    process.exit(3)
  }
  const json = JSON.stringify(payload)
  const n = Math.max(1, Math.ceil(json.length / PART))
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < n; i++) writeFileSync(resolve(outDir, `${name}-${i}.json`), JSON.stringify({ s: json.slice(i * PART, (i + 1) * PART) }))
  // ranges: the date ranges this copy covers (lib/plg/offline.ts); the page offers every preset × comparison in it.
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify({ parts: n, key: `saved:${name}`, storedAt: Date.now(), dataEnd, ...(ranges ? { ranges } : {}) }))
  console.log(JSON.stringify({ name, parts: n, rows: payload.rows.length, bytes: json.length, ranges: ranges?.length ?? 0 }))
} else { console.error('usage: latest | dataend <resultFile> | sql <dataEnd> <youtubeDir> | pack <name> <dataEnd> <resultFile> <sql-json> <outDir>'); process.exit(1) }
