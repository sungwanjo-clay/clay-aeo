import json, re

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def dom(u):
    u = (u or '').strip().lower()
    u = re.sub(r'^[a-z]+://', '', u); u = re.sub(r'^www\d?\.', '', u)
    u = u.split('/')[0].strip('.')
    return u if re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}', u) else ''

def tri(x):
    return 'unknown' if x is None else ('yes' if x else 'no')

LANES = ['official_page', 'official_portfolio', 'google', 'linkedin', 'x', 'dealroom', 'pitchbook', 'crunchbase', 'salesforce']

def handler(context):
    g = context.get_input
    firm = g('firm') or ''
    tv = g('to_verify') or []; held = g('held') or []
    ver = _items(g('verified'))
    snow = g('status') or {}
    snow = snow.get('result', snow) if isinstance(snow, dict) else {}
    lookup_ok = isinstance(snow, dict) and isinstance(snow.get('rows'), list)
    st = {}
    for r in (snow.get('rows') or []) if lookup_ok else []:
        try: ws = json.loads(r.get('WS_JSON') or '[]'); sf = json.loads(r.get('SF_JSON') or '[]')
        except (ValueError, TypeError): ws, sf = None, []
        num = lambda k: int(r[k]) if r.get(k) not in (None, '') else None
        st[r.get('DOMAIN')] = (ws, sf, {'n': num('WS_TOTAL'), 'paying': num('WS_PAYING'), 'ever': num('WS_EVER'), 'shared': num('WS_SHARED')})

    def clay_status(d):
        if not d: return 'unknown: no domain', 0, None, None, []
        if not lookup_ok or d not in st: return 'unknown: lookup failed', 0, None, None, []
        ws, sf, tot = st[d]
        if ws is None: return 'unknown: lookup failed', 0, None, None, sf
        ids = {w.get('workspace_id') for w in ws if w.get('workspace_id')}
        n = tot['n'] if tot['n'] is not None else len(ids)
        shared = tot['shared'] > 1 if tot['shared'] is not None else any((w.get('shared_domains') or 1) > 1 for w in ws)
        if shared: return 'needs review: workspace shared across domains', n, None, None, sf
        if not n: return 'not on Clay (no exact domain match)', 0, False, False, sf
        paying = tot['paying'] == 1 if tot['paying'] is not None else any(w.get('paying_now') == 1 for w in ws)
        ever = tot['ever'] == 1 if tot['ever'] is not None else any(w.get('ever_paid') == 1 for w in ws)
        return ('paying' if paying else 'paid before, not now' if ever else 'free workspace'), n, ever, paying, sf

    rows, review = [], []
    for i, c in enumerate(tv):
        v = ver[i] if i < len(ver) else {}
        v = v.get('output', v) if isinstance(v, dict) else {}
        v = v or {}
        d = dom(v.get('company_domain')) or dom(c.get('domain'))
        status, nws, ever, paying, sf = clay_status(d)
        backing = v.get('backing') or 'Not checked (verification failed)'
        open_pipe = any((a.get('open_pipeline') or 0) > 0 for a in sf)
        confirmed = backing == 'Confirmed'
        target = confirmed and status.startswith('not on Clay') and not open_pipe
        recent = (v.get('round_in_window') == 'Yes')
        row = {'firm': firm, 'company': v.get('company_name') or c.get('name') or '', 'domain': d, 'found_by': c.get('lanes') or [],
               'backing': backing, 'relationship': v.get('relationship') or '', 'backing_source_url': v.get('backing_source_url') or '',
               'in_portfolio_denominator': confirmed, 'is_stealth': bool(v.get('is_stealth')),
               'latest_round_type': v.get('latest_round_type') or '', 'latest_round_date': v.get('latest_round_date') or '',
               'latest_round_amount_usd': float(v.get('latest_round_amount_usd') or 0), 'latest_round_leads': v.get('latest_round_leads') or '',
               'latest_round_source_url': v.get('latest_round_source_url') or '', 'firm_in_latest_round': v.get('firm_in_latest_round') or 'Unknown',
               'funded_in_window': v.get('round_in_window') or 'Unknown',
               'clay_status': status, 'workspaces': nws, 'ever_paid': tri(ever), 'paying_now': tri(paying),
               'salesforce_accounts': [str(a.get('account_id')) for a in sf if a.get('account_id')], 'sales_tier': next((str(a.get('sales_tier')) for a in sf if a.get('sales_tier')), ''),
               'open_pipeline': open_pipe, 'target': target, 'recently_funded_target': target and recent,
               'notes': v.get('notes') or ''}
        rows.append(row)
        if backing in ('Unclear', 'Not checked (verification failed)') or status.startswith('needs review'):
            review.append({'company': row['company'], 'domain': d, 'why': backing if not status.startswith('needs review') else status})
    # Companies carried forward from earlier verification (no new signal this week): same row shape, Clay status refreshed.
    for c in g('cached') or []:
        d = dom(c.get('domain'))
        status, nws, ever, paying, sf = clay_status(d)
        backing = c.get('backing') or 'Unclear'
        open_pipe = any((a.get('open_pipeline') or 0) > 0 for a in sf)
        confirmed = backing == 'Confirmed'
        target = confirmed and status.startswith('not on Clay') and not open_pipe
        def inwin(x):
            x = (x or '')[:10]
            return 'Yes' if x and x >= (g('since') or '') else ('No' if x else 'Unknown')
        rows.append({'firm': firm, 'company': c.get('name') or '', 'domain': d, 'found_by': c.get('lanes') or [],
                     'backing': backing, 'relationship': c.get('relationship') or '', 'backing_source_url': c.get('backing_source_url') or '',
                     'in_portfolio_denominator': confirmed, 'is_stealth': False,
                     'latest_round_type': c.get('latest_round_type') or '', 'latest_round_date': c.get('latest_round_date') or '',
                     'latest_round_amount_usd': float(c.get('latest_round_amount_usd') or 0), 'latest_round_leads': c.get('latest_round_leads') or '',
                     'latest_round_source_url': c.get('latest_round_source_url') or '', 'firm_in_latest_round': c.get('firm_in_latest_round') or 'Unknown',
                     'funded_in_window': inwin(c.get('latest_round_date')),
                     'clay_status': status, 'workspaces': nws, 'ever_paid': tri(ever), 'paying_now': tri(paying),
                     'salesforce_accounts': [str(a.get('account_id')) for a in sf if a.get('account_id')],
                     'sales_tier': next((str(a.get('sales_tier')) for a in sf if a.get('sales_tier')), ''),
                     'open_pipeline': open_pipe, 'target': target, 'recently_funded_target': target and inwin(c.get('latest_round_date')) == 'Yes',
                     'notes': 'Carried forward: verified ' + (c.get('verified_at') or '')[:10]})
    # Merge rows that verification resolved to the same company domain (e.g. a PitchBook name with no website).
    order = {'Confirmed': 0, 'Unclear': 1, 'Not confirmed': 2, 'Different firm': 3}
    merged, by_d = [], {}
    for r in rows:
        k = r['domain'] or ''
        if k and k in by_d:
            m = by_d[k]
            m['found_by'] = sorted(set(m['found_by']) | set(r['found_by']))
            if order.get(r['backing'], 9) < order.get(m['backing'], 9):
                for f in ('backing', 'relationship', 'backing_source_url', 'in_portfolio_denominator'): m[f] = r[f]
            if (r['latest_round_date'] or '') > (m['latest_round_date'] or ''):
                for f in ('latest_round_type', 'latest_round_date', 'latest_round_amount_usd', 'latest_round_leads', 'latest_round_source_url', 'firm_in_latest_round', 'funded_in_window'): m[f] = r[f]
            m['target'] = m['in_portfolio_denominator'] and m['clay_status'].startswith('not on Clay') and not m['open_pipeline']
            m['recently_funded_target'] = m['target'] and m['funded_in_window'] == 'Yes'
            continue
        if k: by_d[k] = r
        merged.append(r)
    rows = merged
    review = [x for x in review if not x['domain'] or by_d.get(x['domain']) is None or not by_d[x['domain']]['in_portfolio_denominator']]
    unverified = []
    for c in held:
        d = dom(c.get('domain')); status, nws, ever, paying, sf = clay_status(d)
        unverified.append({'firm': firm, 'company': c.get('name') or '', 'domain': d, 'found_by': c.get('lanes') or [], 'latest_hint': c.get('latest_hint') or '',
                           'clay_status': status, 'workspaces': nws})

    conf = [r for r in rows if r['in_portfolio_denominator']]
    lanes = sorted({l for r in rows for l in (r['found_by'] or [])})
    summary = {
        'firm': firm, 'identity_confidence': g('identity_confidence') or '', 'window_start': g('since') or '',
        'candidates': len(tv) + len(held) + len(g('cached') or []), 'verified_this_run': len(tv), 'not_verified_this_run': int(g('held_count') or len(held)), 'carried_forward': len(g('cached') or []),
        'backing': {'confirmed': sum(r['backing'] == 'Confirmed' for r in rows), 'not_confirmed': sum(r['backing'] == 'Not confirmed' for r in rows),
                    'different_firm': sum(r['backing'] == 'Different firm' for r in rows), 'unclear': sum(r['backing'] == 'Unclear' for r in rows),
                    'not_checked': sum(r['backing'].startswith('Not checked') for r in rows)},
        'portfolio_confirmed': len(conf),
        'with_workspace': sum(1 for r in conf if r['workspaces'] > 0 and not r['clay_status'].startswith(('unknown', 'needs'))),
        'paying_now': sum(1 for r in conf if r['paying_now'] == 'yes'), 'ever_paid': sum(1 for r in conf if r['ever_paid'] == 'yes'),
        'clay_status_unknown': sum(1 for r in conf if r['clay_status'].startswith(('unknown', 'needs'))),
        'targets': sum(1 for r in conf if r['target']), 'recently_funded_targets': sum(1 for r in conf if r['recently_funded_target']),
        'funded_in_window': sum(1 for r in conf if r['funded_in_window'] == 'Yes'),
        'confirmed_by_lane': {l: sum(1 for r in conf if l in r['found_by']) for l in LANES},
        'confirmed_only_this_lane': {l: sum(1 for r in conf if r['found_by'] == [l]) for l in LANES},
        'candidates_by_lane': {l: int((g('lane_counts') or {}).get(l) or 0) for l in LANES},
        'caps': {'salesforce_capped': bool((g('caps') or {}).get('salesforce_capped')), 'salesforce_total_matches': int((g('caps') or {}).get('salesforce_total_matches') or 0),
                 'dealroom_capped': bool((g('caps') or {}).get('dealroom_capped')), 'dealroom_total': int((g('caps') or {}).get('dealroom_total') or 0),
                 'provider_rows_total': int((g('caps') or {}).get('provider_rows_total') or 0), 'provider_rows_kept': int((g('caps') or {}).get('provider_rows_kept') or 0),
                 'provider_rows_capped': bool((g('caps') or {}).get('provider_rows_capped'))},
        'portfolio_page_status': g('portfolio_page_status') or '',
        'archive_status': g('archive_status') or '', 'archive_coverage': g('archive_coverage') or '',
        'status_lookup_ok': lookup_ok, 'review_count': len(review),
    }
    return {'summary': summary, 'portfolio': rows, 'not_verified': unverified, 'review': review}
