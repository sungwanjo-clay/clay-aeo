/**
 * Daily refresh of the dashboard's saved default view (for viewers without Clay Sigma).
 *
 *   node scripts/refresh-cache.mjs latest                     → {connectionId, sql} for the latest complete day
 *   node scripts/refresh-cache.mjs sql <dataEnd> <youtubeDir>  → {connectionId, main, social, startup} SQL
 *   node scripts/refresh-cache.mjs pack <name> <dataEnd> <resultFile> <sql-json> <outDir>
 *        → db documents for collection `cache`: <outDir>/<name>-<i>.json parts and <outDir>/<name>.json header
 *
 * The page reads cache/<name> (header: parts, key, storedAt, dataEnd) and cache/<name>-<i> ({s: JSON text part}),
 * the same shape it writes itself (artifact/plg/main.tsx). key must equal the SQL the page would run.
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
else if (cmd === 'sql') console.log(JSON.stringify((await lib()).defaults(args[0], args[1])))
else if (cmd === 'pack') {
  const [name, dataEnd, resultFile, sqlJson, outDir] = args
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEnd)) throw new Error('dataEnd must be YYYY-MM-DD')
  const key = JSON.parse(readFileSync(sqlJson, 'utf8'))[name]
  if (!key) throw new Error(`no SQL named ${name}`)
  const payload = payloadOf(readFileSync(resultFile, 'utf8'))
  const json = JSON.stringify(payload)
  const n = Math.max(1, Math.ceil(json.length / PART))
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < n; i++) writeFileSync(resolve(outDir, `${name}-${i}.json`), JSON.stringify({ s: json.slice(i * PART, (i + 1) * PART) }))
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify({ parts: n, key, storedAt: Date.now(), dataEnd }))
  console.log(JSON.stringify({ name, parts: n, rows: payload.rows.length, bytes: json.length }))
} else { console.error('usage: latest | sql <dataEnd> <youtubeDir> | pack <name> <dataEnd> <resultFile> <sql-json> <outDir>'); process.exit(1) }
