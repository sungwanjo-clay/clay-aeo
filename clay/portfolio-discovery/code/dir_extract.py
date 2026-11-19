import re

SOCIAL = ('linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'medium.com', 'github.com', 'tiktok.com',
          'crunchbase.com', 'angel.co', 'wellfound.com', 'cookieyes.com', 'google.com', 'apple.com', 'techcrunch.com', 'reuters.com', 'bloomberg.com',
          'forbes.com', 'businessinsider.com', 'wsj.com', 'ft.com', 'substack.com', 'notion.site', 'calendly.com', 'typeform.com', 'hubspot.com',
          'vimeo.com', 'spotify.com', 'apple.co', 'bit.ly', 'airtable.com', 'webflow.io', 'airops.com', 'privacy', 'jobs.')

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def host(u):
    u = re.sub(r'^[a-z]+://', '', (u or '').strip().lower()); u = re.sub(r'^www\d?\.', '', u)
    return u.split('/')[0].split('?')[0].split('#')[0]

def handler(context):
    g = context.get_input
    method = g('method') or ''
    firm_dom = host(g('firm_domain'))
    link_pat = g('link_pattern') or ''
    prof_pat = g('profile_pattern') or link_pat
    checkpoint = (g('checkpoint_date') or '')[:10]
    seen = set(g('known_profile_urls') or [])
    pages = _items(g('scrape'))
    robots_text = ''
    if len(pages) >= 2:
        rb = pages[-1]; rb = rb.get('result', rb) if isinstance(rb, dict) else {}
        robots_text = (rb.get('bodyText') or '') if isinstance(rb, dict) else ''
        pages = pages[:-1]
    ok_pages = 0
    companies, profiles = {}, {}
    newest = ''
    for r in pages:
        r = r.get('result', r) if isinstance(r, dict) else {}
        if not isinstance(r, dict): continue
        body = r.get('bodyText') or ''
        links = r.get('links') or []
        if body or links: ok_pages += 1
        if method == 'sitemap':
            for block in re.findall(r'<url>(.*?)</url>', body, flags=re.S) or []:
                loc = re.search(r'<loc>\s*([^<\s]+)\s*</loc>', block); mod = re.search(r'<lastmod>\s*([^<\s]+)\s*</lastmod>', block)
                if loc and (not prof_pat or re.search(prof_pat, loc.group(1))):
                    lm = (mod.group(1)[:10] if mod else '')
                    profiles[loc.group(1)] = lm; newest = max(newest, lm)
            if not profiles:   # sitemap without <url> blocks: plain locs
                for loc in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', body):
                    if not prof_pat or re.search(prof_pat, loc): profiles[loc] = ''
        else:
            for l in links:
                href = (l.get('href') or '').strip(); text = re.sub(r'\s+', ' ', (l.get('text') or '')).strip()
                h = host(href)
                if not h: continue
                if method == 'profile_pages' or (link_pat and link_pat != 'external'):
                    if re.search(prof_pat, href) and (h == firm_dom or h.endswith('.' + firm_dom)): profiles.setdefault(href, '')
                else:   # 'external': off-site company websites linked from the directory
                    if h == firm_dom or h.endswith('.' + firm_dom) or any(s in h for s in SOCIAL): continue
                    name = text if text and text.lower() not in ('visit website', 'website', 'visit', 'learn more', 'read more', '→') else ''
                    companies.setdefault(h, {'company': name, 'website': h})
                    if name and not companies[h]['company']: companies[h]['company'] = name
    found = len(companies) + len(profiles)
    # Profiles to open this run: ones never read before (sitemaps often stamp every URL with the same lastmod), capped.
    todo = sorted((u for u in profiles if u not in seen), key=lambda u: (profiles[u], u), reverse=True)
    # Informational only: whether robots.txt disallows the directory path (the scraper does not obey it).
    path = '/' + '/'.join((g('list_url') or '').split('/')[3:])
    blocked = False
    agent_rules = re.split(r'(?im)^user-agent:', robots_text)
    for blk in agent_rules[1:]:
        head = blk.split('\n', 1)[0].strip()
        if head == '*':
            for rule in re.findall(r'(?im)^disallow:\s*(\S*)', blk):
                if rule and path.startswith(rule): blocked = True
    
    root = '/'.join((g('list_url') or '').split('/')[:3])
    return {'blocked_by_robots': blocked, 'robots_url': (root + '/robots.txt') if root else '',
            'companies': [{'company': v['company'], 'website': v['website']} for v in companies.values()],
            'profile_urls_found': len(profiles), 'profiles_to_open': todo[:120], 'profiles_deferred': max(0, len(todo) - 120),
            'pages_read': ok_pages, 'found': found, 'newest_lastmod': newest, 'profiles_already_seen': len([u for u in profiles if u in seen])}
