import json, re

LANES = ['official_page', 'official_portfolio', 'google', 'linkedin', 'x', 'dealroom', 'pitchbook', 'crunchbase', 'salesforce']
BAD_DOMAINS = {'linkedin.com', 'crunchbase.com', 'twitter.com', 'x.com', 'facebook.com', 'medium.com', 'techcrunch.com', 'ycombinator.com', 'angel.co', 'wellfound.com', 'github.com', 'notion.site', 'google.com'}

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def _res(it):
    return it.get('result') if isinstance(it, dict) and 'result' in it else it

_PROTO = re.compile(r'^[a-z]+://'); _WWW = re.compile(r'^www\d?\.'); _DOMOK = re.compile(r'[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}')
_PAREN = re.compile(r'\s*\([^)]*\)\s*$')
_SUFFIX = re.compile(r'\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|sas|ab|oy|bv|plc|labs?|technologies|technology|ai|hq|app)\b\.?')
_NONAL = re.compile(r'[^a-z0-9]+')
_dc, _nc = {}, {}

def dom(u):
    if u in _dc: return _dc[u]
    x = (u or '').strip().lower()
    x = _WWW.sub('', _PROTO.sub('', x))
    x = x.split('/')[0].split('?')[0].split('#')[0].strip('.')
    r = x if (_DOMOK.fullmatch(x) and x not in BAD_DOMAINS) else ''
    _dc[u] = r
    return r

def nkey(n):
    if n in _nc: return _nc[n]
    r = _NONAL.sub('', _SUFFIX.sub(' ', (n or '').lower()))
    _nc[n] = r
    return r

def handler(context):
    """Step 1 of 2: fold the provider rows (Dealroom, PitchBook, Crunchbase, Salesforce) into one line per company,
    so the combine step stays under Clay's 1-second code limit for very large portfolios."""
    g = context.get_input
    cos, by_dom, by_name = [], {}, {}
    lane_raw = {l: 0 for l in LANES}
    def upsert(name, domain, lane, ev):
        # PitchBook appends the industry: "Punch (Business/Productivity Software)". Emails are page junk, not companies.
        name = name or ''
        if '(' in name: name = _PAREN.sub('', name)
        name = name.strip()
        if '@' in name: name = ''
        if '@' in (domain or ''): domain = ''
        d, k = dom(domain), nkey(name)
        if not d and not k: return
        c = None
        if d and d in by_dom: c = by_dom[d]
        elif k and k in by_name: c = by_name[k]
        if c is None:
            c = {'name': (name or d).strip(), 'domain': d, 'lanes': [], 'ev': [], 'latest': '', 'round_hints': []}
            cos.append(c)
        if d and not c['domain']: c['domain'] = d
        if d: by_dom[d] = c
        if k: by_name.setdefault(k, c)
        if lane not in c['lanes']: c['lanes'].append(lane)
        # Evidence is kept raw and only formatted for the companies sent to verification.
        if len(c['ev']) < 5: c['ev'].append((lane, ev))
        dt = ev.get('date')
        if dt and str(dt) > c['latest']: c['latest'] = str(dt)
        if ev.get('round') and len(c['round_hints']) < 3: c['round_hints'].append(str(ev['round']))
        lane_raw[lane] += 1

    for line in g('provider_rows') or []:
        f = (line.split('\t') + [''] * 8)[:8]
        upsert(f[1], f[2], f[0], {'date': f[3], 'round': f[4], 'url': f[5], 'id': f[6], 'note': f[7]})
    out = []
    for c in cos:
        ev = [[l, e.get('date') or '', e.get('round') or '', e.get('url') or '', e.get('id') or '', e.get('note') or ''] for l, e in c['ev']]
        out.append('\t'.join([','.join(c['lanes']), c['name'].replace('\t', ' '), c['domain'], c['latest'], ';'.join(c['round_hints']),
                              json.dumps(ev, separators=(',', ':'))]))
    return {'merged': out, 'lane_raw': lane_raw, 'rows_in': len(g('provider_rows') or [])}
