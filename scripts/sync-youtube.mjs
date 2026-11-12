/**
 * Pulls YouTube channel + per-video daily stats for the Social video tab and
 * writes one JSON document per channel to dist/youtube/<channelId>.json, which
 * is then stored in the artifact's db at youtube/<channelId>.
 *
 *   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN  (read-only scopes)
 *   node scripts/sync-youtube.mjs [since=2026-07-01]
 *
 * The OAuth user is not the channel owner, so every call names the channel id
 * explicitly (channel==MINE would return the user's own empty channel).
 * Impressions / thumbnail CTR are NOT available from the Analytics API: they need
 * the Reporting API (channel_reach_basic_a1), authorized by the channel owner.
 * Access here is via Viewer permission on the channel, which Google does not
 * officially support for APIs; 401/403 is reported as NO ACCESS and the previous
 * document is kept.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Creator channels on the Social tab. Add Payton / Eric / the Clay brand channel here once confirmed.
const CHANNELS = [
  { id: 'UC1C7lmXOfNHlS2cORnPbgaA', key: 'peter' },
]
const since = process.argv[2] ?? '2026-07-01'
const today = new Date().toISOString().slice(0, 10)
const outDir = resolve(import.meta.dirname, '../dist/youtube')

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  const j = await r.json()
  if (!j.access_token) throw new Error(`token refresh failed: ${j.error ?? r.status}`)
  return j.access_token
}

const at = await token()
class AccessError extends Error {}
async function get(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } })
  const j = await r.json()
  if (j.error) {
    const msg = `${url.split('?')[0].split('/').slice(-2).join('/')}: ${j.error.code} ${j.error.message}`
    // 401/403 = the Viewer access this relies on was revoked or doesn't cover this channel.
    throw (j.error.code === 401 || j.error.code === 403) ? new AccessError(msg) : new Error(msg)
  }
  return j
}
const analytics = (ch, params) =>
  get(`https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: `channel==${ch}`, startDate: since, endDate: today, ...params })}`)

/**
 * Every link in the description, classified. video_id → utm_campaign comes
 * from clay.com / clay.link links carrying utm_campaign. Short links whose
 * target we can't resolve (clay.link is blocked by the network policy, dub.sh
 * is third-party) are flagged, never guessed.
 */
function parseLinks(description) {
  const urls = [...new Set(description.match(/https?:\/\/[^\s)\]]+/g) ?? [])]
  const links = urls.map(raw => {
    let u
    try { u = new URL(raw) } catch { return null }
    const host = u.hostname.replace(/^www\./, '')
    const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map(k => [k, u.searchParams.get(k)?.toLowerCase() ?? null]))
    const kind = host === 'clay.link' ? 'clay_short' : host === 'dub.sh' ? 'short' : /(^|\.)clay\.com$/.test(host) ? 'clay' : 'external'
    return { url: `${host}${u.pathname}`.replace(/\/$/, ''), host, kind, ...utm }
  }).filter(Boolean)
  const clayLinks = links.filter(l => l.kind === 'clay' || l.kind === 'clay_short')
  const tagged = clayLinks.find(l => l.utm_campaign)
  const primary = tagged ?? clayLinks[0] ?? links.find(l => l.kind === 'short') ?? null
  return {
    campaign: tagged?.utm_campaign ?? null,
    destination: primary ? primary.url : null,
    destinationKind: primary ? (primary.kind === 'clay_short' || primary.kind === 'short' ? 'short_unresolved' : primary.kind) : 'none',
    links: links.filter(l => l.kind !== 'external').map(l => ({ url: l.url, kind: l.kind, campaign: l.utm_campaign })),
  }
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1
const isoDur = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? '') ?? []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) }

mkdirSync(outDir, { recursive: true })
let failures = 0
for (const ch of CHANNELS) {
 try {
  const info = (await get(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${ch.id}`)).items[0]
  const uploads = info.contentDetails.relatedPlaylists.uploads
  const ids = []
  let page = ''
  do {
    const p = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`)
    ids.push(...p.items.map(i => i.contentDetails.videoId))
    page = p.nextPageToken ?? ''
  } while (page)
  const vids = []
  for (let i = 0; i < ids.length; i += 50) {
    const v = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(',')}`)
    vids.push(...v.items)
  }
  const daily = (await analytics(ch.id, { metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewPercentage', dimensions: 'day', sort: 'day' })).rows ?? []
  const videos = []
  for (const v of vids) {
    const published = v.snippet.publishedAt.slice(0, 10)
    const metrics = 'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained'
    const rows = published > today ? [] : ((await analytics(ch.id, { metrics, dimensions: 'day', sort: 'day', filters: `video==${v.id}` })).rows ?? [])
    // Exact first-28-day cohort (averageViewPercentage is not additive across days).
    const cohortEnd = [addDays(published, 27), today].sort()[0]
    const coh = published > today ? null : ((await analytics(ch.id, { metrics, startDate: published, endDate: cohortEnd, filters: `video==${v.id}` })).rows ?? [])[0] ?? null
    videos.push({
      id: v.id, title: v.snippet.title, published, durationSec: isoDur(v.contentDetails.duration),
      lifetimeViews: Number(v.statistics.viewCount ?? 0), ...parseLinks(v.snippet.description ?? ''),
      // [day, views, minutes, avgViewPct, subsGained]
      daily: rows.filter(r => r[1] > 0 || r[2] > 0).map(r => [r[0], r[1], r[2], r[3], r[4]]),
      cohort28: coh ? { start: published, end: cohortEnd, days: daysBetween(published, cohortEnd), views: coh[0], minutes: coh[1], avgViewPct: coh[2], subsGained: coh[3] } : null,
    })
  }
  const doc = {
    channelId: ch.id, key: ch.key, title: info.snippet.title, handle: info.snippet.customUrl,
    subscribers: Number(info.statistics.subscriberCount), lifetimeViews: Number(info.statistics.viewCount),
    videoCount: Number(info.statistics.videoCount), since, fetchedAt: new Date().toISOString(),
    // [day, views, minutes, subsGained, subsLost, avgViewPct]
    daily: daily.map(r => [r[0], r[1], r[2], r[3], r[4], r[5]]), videos,
  }
  writeFileSync(resolve(outDir, `${ch.id}.json`), JSON.stringify(doc))
  console.log(`${ch.key}: ${daily.length} days, ${videos.length} videos → dist/youtube/${ch.id}.json (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`)
 } catch (e) {
  failures++
  // Leave the previous document in place; the page shows its fetchedAt as stale.
  console.error(`${ch.key}: ${e instanceof AccessError ? 'NO ACCESS (Viewer permission revoked or missing?)' : 'FAILED'} - ${e.message}`)
 }
}
if (failures) process.exit(2)
