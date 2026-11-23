/**
 * Landing page types for the Conversion section: the growth team's URL grouping, updated for today's site.
 *
 *   - Pricing is split from Conversion pages: it's a key page with its own intent.
 *   - Marketplace: marketplace.clay.com (its homepage comes in as site 'ploy-' with path '/', skill pages as site
 *     'ploy-skills') and any /skills* path.
 *   - University (university.clay.com, docs.clay.com) and Guides (Ploy-hosted, served on clay.com) are told apart by
 *     the session's SITE, which the tracking sets per property.
 *   - Glossary, Tools and Templates/Claybooks are their own types; number-of-employees pages are Dossier.
 *   - No landing-page or SEO-resources groups: Ploy campaign sites (makes.clay.com, *.ploy.live) and /lp/ pages fall
 *     to Other, like data tests and the certification sites.
 *   - Product includes the newer pages (/mcp, /agent*, /workflows, /functions, /inbound-sdr, signal catalogue); Not
 *     found (404) and Company & community are kept as groups.
 *
 * Rules are checked in order; the first match wins. `site` is MARKETING_WEBSITE_SESSIONS.SITE, `host` the session URL's
 * host, `path` the entry path lower-cased with locale prefixes (/fr, /en, /es, /de) stripped. Workspaces whose
 * attributed first-touch session isn't in the sessions table (MCP and CLI sign-ups, survey-only, unattributable) are
 * 'No attributed session'.
 */
export type PageType =
  | 'Homepage' | 'Pricing' | 'Conversion pages' | 'Product' | 'Integrations' | 'Solutions & use cases' | 'Customer stories'
  | 'Blog' | 'Dossier' | 'Guides' | 'University' | 'Marketplace' | 'Tools' | 'Glossary' | 'Templates/Claybooks'
  | 'Webinars & livestreams' | 'Careers' | 'Company & community' | 'Not found (404)' | 'Other' | 'No attributed session'

type Rule = { type: PageType; sites?: string[]; hosts?: string[]; anySite?: string[]; eq?: string[]; like?: string[] }

/** `like` / `anySite` entries are SQL LIKE patterns on the path ('%' = anything); `like` and `eq` apply to clay.com only. */
export const PAGE_RULES: Rule[] = [
  { type: 'Conversion pages', sites: ['signup', 'login'] },
  { type: 'University', sites: ['university'] },
  { type: 'Marketplace', hosts: ['marketplace.clay.com'] },
  { type: 'Marketplace', anySite: ['/skills%'] },
  { type: 'Guides', sites: ['ploy-guides'] },
  { type: 'Homepage', eq: ['/'] },
  { type: 'Pricing', like: ['/pricing%'] },
  { type: 'Conversion pages', like: ['/signup%', '/demo%', '/contact%', '/quote%'] },
  { type: 'Product', like: ['/claygent%', '/waterfall-enrichment%', '/signals%', '/ads%', '/audiences%', '/sequencer%', '/sculptor%',
    '/ai-formula%', '/clay-in-chatgpt%', '/sdr%', '/inbound-sdr%', '/changelog%', '/mcp%', '/agent%', '/account-agents%', '/workflows%',
    '/functions%', '/providers-signal%', '/forms%'] },
  { type: 'Integrations', like: ['/integrations%'] },
  { type: 'Solutions & use cases', like: ['/use-cases/%', '/clay-for-%', '/enterprise%', '/solutions%', '/gtm-engineering%'] },
  { type: 'Customer stories', like: ['/customers%', '/customer-%'] },
  { type: 'Blog', like: ['/blog%'] },
  { type: 'Dossier', like: ['/dossier%', '/number-of-employees%'] },
  { type: 'Guides', like: ['/guides%'] },
  { type: 'Tools', like: ['/tools%', '/all-tools%'] },
  { type: 'Glossary', like: ['/glossary%'] },
  { type: 'Templates/Claybooks', like: ['/templates%', '/claybooks%'] },
  { type: 'Webinars & livestreams', like: ['/webinar%', '/livestreams%'] },
  { type: 'Careers', like: ['/jobs%', '/careers%', '/job-board%'] },
  { type: 'Not found (404)', like: ['/404%'] },
  { type: 'Company & community', like: ['/about%', '/press%', '/partners%', '/legal%', '/privacy%', '/community%', '/slack-community%',
    '/clay-campus%', '/community-scholarship%', '/series-%', '/gift%', '/the-wheel%', '/faq%', '/experts%'] },
]
export const PAGE_TYPES: PageType[] = ['Homepage', 'Pricing', 'Conversion pages', 'Product', 'Integrations', 'Solutions & use cases',
  'Customer stories', 'Blog', 'Dossier', 'Guides', 'University', 'Marketplace', 'Tools', 'Glossary', 'Templates/Claybooks',
  'Webinars & livestreams', 'Careers', 'Company & community', 'Not found (404)', 'Other', 'No attributed session']

/** SQL host of a session URL (no scheme, port path or query). */
export const hostSql = (url: string) => `SPLIT_PART(SPLIT_PART(SPLIT_PART(LOWER(COALESCE(${url}, '')), '://', 2), '/', 1), '?', 1)`

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
/** SQL CASE expression giving the page type of (site, host, path). */
export function pageTypeSql(site: string, path: string, host: string): string {
  const cond = (r: Rule) => [
    r.sites ? `${site} IN (${r.sites.map(q).join(', ')})` : null,
    r.hosts ? `${host} IN (${r.hosts.map(q).join(', ')})` : null,
    r.anySite ? `(${r.anySite.map(l => `${path} LIKE ${q(l)}`).join(' OR ')})` : null,
    r.eq || r.like ? `${site} = 'marketing_website' AND (${[...(r.eq ?? []).map(e => `${path} = ${q(e)}`), ...(r.like ?? []).map(l => `${path} LIKE ${q(l)}`)].join(' OR ')})` : null,
  ].filter(Boolean).join(' AND ')
  return `CASE ${PAGE_RULES.map(r => `WHEN ${cond(r)} THEN ${q(r.type)}`).join('\n      ')} ELSE 'Other' END`
}

/** The same rules in TypeScript (for entry pages whose type isn't in the row). */
export function pageTypeOf(site: string, path: string, host = ''): PageType {
  const like = (pat: string, s: string) => new RegExp('^' + pat.split('%').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$').test(s)
  for (const r of PAGE_RULES) {
    if (r.sites && !r.sites.includes(site)) continue
    if (r.hosts && !r.hosts.includes(host)) continue
    if (r.anySite && !r.anySite.some(l => like(l, path))) continue
    if ((r.eq || r.like) && !(site === 'marketing_website' && ((r.eq ?? []).includes(path) || (r.like ?? []).some(l => like(l, path))))) continue
    return r.type
  }
  return 'Other'
}
