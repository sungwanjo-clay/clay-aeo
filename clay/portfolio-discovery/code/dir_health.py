import re

SOCIAL = ('linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'medium.com', 'github.com', 'tiktok.com',
          'crunchbase.com', 'angel.co', 'wellfound.com', 'google.com', 'apple.com', 'startupschool.org', 'amazon.com', 'bit.ly', 'calendly.com')

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

SEASON = re.compile(r'(Winter|Summer|Spring|Fall|Autumn)\s*(20\d\d)(?!\d)')
FUND = re.compile(r'\bFund\s+([IVX]+|\d+)\b')
STATUS = re.compile(r'(Active|Acquired|Inactive|Public|Exited|Closed)(?=[A-Z]|\s|$)')

def handler(context):
    g = context.get_input
    firm_dom = host(g('firm_domain'))
    urls = g('profiles_to_open') or []
    listed = g('companies') or []
    found = int(g('found') or 0); pages_read = int(g('pages_read') or 0)
    last = int(g('last_count') or 0); expected = int(g('expected_count') or 0)
    recipe_known = bool(g('method'))
    out, failed_profiles = [], 0
    for i, r in enumerate(_items(g('profile_scrape'))):
        r = r.get('result', r) if isinstance(r, dict) else {}
        url = urls[i] if i < len(urls) else ''
        if not isinstance(r, dict) or not (r.get('bodyText') or r.get('links')):
            failed_profiles += 1; continue
        title = re.split(r'\s[:|–-]\s|:', r.get('title') or '')[0].strip()
        site = ''
        for l in r.get('links') or []:
            h = host(l.get('href'))
            if h and h != firm_dom and not h.endswith('.' + firm_dom) and not any(s in h for s in SOCIAL):
                site = h; break
        body = r.get('bodyText') or ''
        m = SEASON.search(body) or FUND.search(body); s = STATUS.search(body)
        batch = (m.group(1) + ' ' + m.group(2)) if m and m.re is SEASON else (m.group(0) if m else '')
        out.append({'company': title, 'website': site, 'fund_or_batch': batch, 'status': s.group(1) if s else '', 'profile_url': url})
    for c in listed:
        out.append({'company': c.get('company') or c.get('website') or '', 'website': c.get('website') or '', 'fund_or_batch': '', 'status': '', 'profile_url': ''})
    # Health: is the recipe still reading this site?
    reasons = []
    if pages_read == 0: reasons.append('the directory fetch returned nothing')
    if found == 0: reasons.append('no company links matched the recipe')
    if last and found < 0.5 * last: reasons.append(f'found {found} vs {last} last time')
    if urls and failed_profiles > 0.5 * len(urls): reasons.append(f'{failed_profiles} of {len(urls)} profile pages failed')
    if not recipe_known: status = 'no_recipe'
    elif reasons: status = 'broken'
    elif expected and found < 0.8 * expected: status = 'partial'
    else: status = 'ok'
    return {'directory_companies': out, 'directory_status': status, 'directory_found': found, 'profiles_read': len(urls) - failed_profiles,
            'health_reason': '; '.join(reasons) or ('below the site\'s stated total' if status == 'partial' else ''), 'needs_fallback': status in ('broken', 'no_recipe')}
