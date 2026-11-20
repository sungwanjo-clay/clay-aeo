/**
 * Landing page types for the Conversion section: the growth team's URL grouping, updated for today's site and
 * consolidated where groups were too small to read on their own (sizes checked on 28 days of new-visitor entries):
 *
 *   - Pricing is split from Conversion pages: it's a key page with its own intent.
 *   - Use cases and Solutions merge; Glossary, Tools, Templates, Claybooks, Number of Employees and Data Tests merge
 *     into one SEO resources group (each was under ~2% of entries, some under 0.1%).
 *   - Added: newer product pages (/mcp, /agent*, /workflows, /functions, /inbound-sdr, signal catalogue), the Ploy
 *     landing-page sites (ploy-*), the signup / login / university / guides sites, a Not found (404) group (a
 *     fixable leak) and a Company & community group (about, press, partners, legal, community, FAQ, experts).
 *
 * Rules are checked in order; the first match wins. `site` is MARKETING_WEBSITE_SESSIONS.SITE, `path` the entry path
 * lower-cased with locale prefixes (/fr, /en, /es, /de) stripped.
 */
export type PageType =
  | 'Homepage' | 'Pricing' | 'Conversion pages' | 'Product' | 'Integrations' | 'Solutions & use cases' | 'Customer stories'
  | 'Blog' | 'Dossier' | 'Guides' | 'University' | 'SEO resources' | 'Webinars & livestreams' | 'Landing pages'
  | 'Careers' | 'Company & community' | 'Not found (404)' | 'Other'

type Rule = { type: PageType; sites?: string[]; sitePrefix?: string; eq?: string[]; like?: string[] }

/** `like` entries are SQL LIKE patterns on the path ('%' = anything). */
export const PAGE_RULES: Rule[] = [
  { type: 'Conversion pages', sites: ['signup', 'login'] },
  { type: 'University', sites: ['university'] },
  { type: 'Guides', sites: ['ploy-guides'] },
  { type: 'Landing pages', sitePrefix: 'ploy-' },
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
  { type: 'Dossier', like: ['/dossier%'] },
  { type: 'Guides', like: ['/guides%'] },
  { type: 'SEO resources', like: ['/glossary%', '/tools%', '/all-tools%', '/templates%', '/claybooks%', '/number-of-employees%', '/data-tests%'] },
  { type: 'Webinars & livestreams', like: ['/webinar%', '/livestreams%'] },
  { type: 'Landing pages', like: ['/lp/%'] },
  { type: 'Careers', like: ['/jobs%', '/careers%', '/job-board%'] },
  { type: 'Not found (404)', like: ['/404%'] },
  { type: 'Company & community', like: ['/about%', '/press%', '/partners%', '/legal%', '/privacy%', '/community%', '/slack-community%',
    '/clay-campus%', '/community-scholarship%', '/series-%', '/gift%', '/the-wheel%', '/faq%', '/experts%'] },
]
export const PAGE_TYPES: PageType[] = ['Homepage', 'Pricing', 'Conversion pages', 'Product', 'Integrations', 'Solutions & use cases',
  'Customer stories', 'Blog', 'Dossier', 'Guides', 'University', 'SEO resources', 'Webinars & livestreams', 'Landing pages', 'Careers',
  'Company & community', 'Not found (404)', 'Other']

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
/** SQL CASE expression giving the page type of (site, path). */
export function pageTypeSql(site: string, path: string): string {
  const cond = (r: Rule) => [
    r.sites ? `${site} IN (${r.sites.map(q).join(', ')})` : null,
    r.sitePrefix ? `${site} LIKE ${q(r.sitePrefix + '%')}` : null,
    r.eq || r.like ? `${site} = 'marketing_website' AND (${[...(r.eq ?? []).map(e => `${path} = ${q(e)}`), ...(r.like ?? []).map(l => `${path} LIKE ${q(l)}`)].join(' OR ')})` : null,
  ].filter(Boolean).join(' AND ')
  return `CASE ${PAGE_RULES.map(r => `WHEN ${cond(r)} THEN ${q(r.type)}`).join('\n      ')} ELSE 'Other' END`
}

/** The same rules in TypeScript (for entry pages whose type isn't in the row). */
export function pageTypeOf(site: string, path: string): PageType {
  const like = (pat: string, s: string) => new RegExp('^' + pat.split('%').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$').test(s)
  for (const r of PAGE_RULES) {
    if (r.sites && !r.sites.includes(site)) continue
    if (r.sitePrefix && !site.startsWith(r.sitePrefix)) continue
    if ((r.eq || r.like) && !(site === 'marketing_website' && ((r.eq ?? []).includes(path) || (r.like ?? []).some(l => like(l, path))))) continue
    return r.type
  }
  return 'Other'
}
