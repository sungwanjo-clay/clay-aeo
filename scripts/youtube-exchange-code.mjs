/**
 * Turn a channel owner's OAuth consent into a refresh token for that channel.
 *
 *   node scripts/youtube-exchange-code.mjs '<code or the full oauthplayground URL>' <out-file>
 *
 * The owner opens the consent link (client = YOUTUBE_CLIENT_ID, redirect = Google OAuth Playground,
 * scopes yt-analytics.readonly + youtube.readonly, access_type=offline, prompt=consent), approves, and
 * sends back the URL they land on. Codes are single-use and expire after about 10 minutes, so run
 * this promptly.
 *
 * Prints only which channel the token belongs to. The refresh token is written to <out-file>
 * (mode 600) and never printed; add it to the environment as YOUTUBE_REFRESH_TOKEN_<CHANNEL KEY>.
 */
import { writeFileSync } from 'node:fs'

const [, , input, outFile] = process.argv
if (!input || !outFile) {
  console.error('usage: node scripts/youtube-exchange-code.mjs <code|url> <out-file>')
  process.exit(1)
}
const code = input.startsWith('http') ? new URL(input).searchParams.get('code') : input
if (!code) { console.error('no ?code= in that URL'); process.exit(1) }

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    code, client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    redirect_uri: 'https://developers.google.com/oauthplayground', grant_type: 'authorization_code',
  }),
})
const tok = await res.json()
if (!tok.refresh_token) {
  console.error(`exchange failed: ${tok.error ?? res.status} ${tok.error_description ?? ''}`.trim())
  console.error('Codes expire after ~10 minutes and work once; ask for a fresh one if it was already used.')
  process.exit(2)
}
const me = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
  headers: { Authorization: `Bearer ${tok.access_token}` },
})).json()
const ch = me.items?.[0]
writeFileSync(outFile, tok.refresh_token + '\n', { mode: 0o600 })
console.log(`token belongs to channel: ${ch ? `${ch.snippet.title} (${ch.id})` : 'none found'}`)
console.log(`scopes granted: ${tok.scope}`)
console.log(`refresh token written to ${outFile} (not printed)`)
