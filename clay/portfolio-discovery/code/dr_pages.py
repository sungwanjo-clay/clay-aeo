import math

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def handler(context):
    first = _items(context.get_input('page1'))
    domains = context.get_input('domains') or []
    pages, total, page_size, seen = [], 0, 100, 0
    for i, it in enumerate(first):
        r = (it.get('result', it) if isinstance(it, dict) else None)
        if not isinstance(r, dict): continue
        total = int(r.get('total') or 0)
        seen = len(r.get('data') or [])
        page_size = max(seen, 1) if total > seen else 100
        dom = domains[i] if i < len(domains) else ''
        last = min(math.ceil(total / 100), 30)          # hard cap: 30 pages = 3,000 companies
        pages += [{'domain': dom, 'page': p} for p in range(2, last + 1)]
    capped = total > 3000
    return {'dealroom_pages': pages, 'dealroom_total': total, 'dealroom_capped': capped}
