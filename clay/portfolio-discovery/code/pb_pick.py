import re

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def _dom(u):
    u = (u or '').lower().strip()
    u = re.sub(r'^https?://', '', u); u = re.sub(r'^www\.', '', u)
    return u.split('/')[0]

def handler(context):
    want = _dom(context.get_input('firm_domain'))
    name = (context.get_input('firm') or '').lower()
    picks, candidates = [], []
    for it in _items(context.get_input('search')):
        r = (it.get('result', it) if isinstance(it, dict) else None)
        for c in ((r or {}).get('items') or []) if isinstance(r, dict) else []:
            types = [((c.get('primaryFirmType') or {}).get('type') or '')] + [(t or {}).get('type') or '' for t in (c.get('otherFirmTypes') or [])]
            is_inv = any(re.search(r'invest|venture|accelerat|fund', t or '', re.I) for t in types)
            cand = {'pb_id': str(c.get('pbId') or ''), 'name': c.get('name') or '', 'website': _dom(c.get('website')), 'types': [t for t in types if t]}
            candidates.append(cand)
            if c.get('pbId') and is_inv and want and cand['website'] == want:
                picks.append(c['pbId'])
    if not picks:   # fall back to an exact name match on an investor record
        for c in candidates:
            if c['pb_id'] and (c['name'] or '').lower() == name and any(re.search(r'invest|venture|accelerat|fund', t, re.I) for t in c['types']):
                picks.append(c['pb_id'])
    picks = list(dict.fromkeys(picks))[:2]
    return {'pb_ids': picks, 'pb_candidates': candidates[:10], 'pb_match': 'domain' if picks and any(c['website'] == want for c in candidates) else ('name' if picks else 'none')}
