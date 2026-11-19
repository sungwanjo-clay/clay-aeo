from datetime import date

ROW_CAP = 5000

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def _clean(v):
    return str(v or '').replace('\t', ' ').replace('\n', ' ')

def row(lane, name, domain, date='', rnd='', url='', rid='', note=''):
    return '\t'.join(_clean(x) for x in (lane, name, domain, date, rnd, url, rid, note))

def handler(context):
    g = context.get_input
    rows = []
    for src in ('dealroom_p1', 'dealroom_more'):
        for r in _items(g(src)):
            r = r.get('result', r) if isinstance(r, dict) else {}
            for x in (r.get('data') or []) if isinstance(r, dict) else []:
                if (x.get('type') or 'company') == 'company':
                    rows.append(row('dealroom', x.get('name'), x.get('website_url'), note='Dealroom investor investments'))
    for r in _items(g('pitchbook')):
        r = r.get('result', r) if isinstance(r, dict) else r
        for x in (r if isinstance(r, list) else (r or {}).get('items') or []) if r else []:
            if isinstance(x, dict):
                rows.append(row('pitchbook', x.get('companyName'), x.get('website') or x.get('companyWebsite'),
                                (x.get('investmentDate') or x.get('investorSince') or '')[:10], rid=x.get('investmentDealId') or x.get('companyId'), note='PitchBook active investment'))
    for r in _items(g('crunchbase')):
        r = r.get('result', r) if isinstance(r, dict) else {}
        for x in (r.get('investments') or []) if isinstance(r, dict) else []:
            org = x.get('organization') or {}; fr = x.get('funding_round') or {}
            rnd = (fr.get('value') or '').split(' - ')[0]
            link = ('https://www.crunchbase.com/organization/' + org['permalink']) if org.get('permalink') else ''
            rows.append(row('crunchbase', org.get('value'), '', (x.get('announced_on') or '')[:10], rnd, link, fr.get('uuid') or org.get('uuid'),
                            'Crunchbase investment: ' + _clean(x.get('name'))[:160]))
    sf = g('salesforce') or {}
    sf = sf.get('result', sf) if isinstance(sf, dict) else {}
    total = 0
    for x in (sf.get('rows') or []) if isinstance(sf, dict) else []:
        total = max(total, int(x.get('TOTAL_MATCHES') or 0))
        rows.append(row('salesforce', x.get('NAME'), x.get('DOMAIN'), x.get('LAST_FUNDING_DATE'), x.get('LAST_FUNDING_TYPE'), x.get('SOURCE_LINK'), x.get('ID'),
                        'Salesforce investors: ' + _clean(x.get('INVESTORS'))[:200]))
    sf_rows = sum(1 for r in rows if r.startswith('salesforce\t'))
    # Very large portfolios (YC: ~11k rows) exceed what one code step can process in Clay's 1-second limit. Keep every
    # Salesforce and Crunchbase row, then the newest PitchBook/Dealroom rows, plus a slice of older ones that rotates
    # weekly so every company is still seen over a few weeks.
    total_rows = len(rows)
    if total_rows > ROW_CAP:
        keep = [r for r in rows if r.startswith(('salesforce\t', 'crunchbase\t'))]
        rest = sorted((r for r in rows if not r.startswith(('salesforce\t', 'crunchbase\t'))), key=lambda r: r.split('\t')[3], reverse=True)
        budget = max(0, ROW_CAP - len(keep)); newest = int(budget * 0.7)
        older = rest[newest:]; slice_n = budget - newest
        if older and slice_n:
            start = (date.today().isocalendar()[1] * slice_n) % len(older)
            older = (older[start:] + older[:start])[:slice_n]
        else:
            older = []
        rows = keep + rest[:newest] + older
    fails = {k: int((g(k) or {}).get('failedCount') or 0) if isinstance(g(k), dict) else 0 for k in ('dealroom_p1', 'dealroom_more', 'pitchbook', 'crunchbase', 'linkedin', 'google')}
    return {'provider_rows': rows, 'salesforce_total': total, 'salesforce_rows': sf_rows,
            'provider_rows_total': total_rows, 'provider_rows_kept': len(rows),
            'failed_counts': {'dealroom': fails['dealroom_p1'] + fails['dealroom_more'], 'pitchbook': fails['pitchbook'], 'crunchbase': fails['crunchbase'], 'linkedin': fails['linkedin'], 'google': fails['google']}}
