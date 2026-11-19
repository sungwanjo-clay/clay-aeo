import json, re
from datetime import datetime, timezone

LANE_SOURCE = {'official_page': 'official_page', 'official_portfolio': 'official_portfolio', 'google': 'google', 'linkedin': 'linkedin',
               'x': 'x', 'dealroom': 'dealroom', 'pitchbook': 'pitchbook', 'crunchbase': 'crunchbase', 'salesforce': 'salesforce'}

def _items(x):
    if isinstance(x, list): return x
    if isinstance(x, dict):
        for k in ('results', 'entries', 'items', 'outputs'):
            if isinstance(x.get(k), list): return x[k]
        return [x]
    return []

def body(kind, rows):
    return json.dumps({'p_kind': kind, 'p_rows': rows}, separators=(',', ':'))

def chunk(rows, n=300):
    return [rows[i:i + n] for i in range(0, len(rows), n)]

def handler(context):
    g = context.get_input
    firm = g('firm_listed') or g('firm') or ''
    run_id = g('run_id') or ''
    now = datetime.now(timezone.utc).isoformat()
    meta = []
    # 1. Identity, when this run re-researched it.
    if g('identity_refreshed') and g('official_name'):
        split = lambda s: [x.strip() for x in (s or '').split('|') if x.strip()]
        meta.append(body('firm_identity', [{'firm': firm, 'official_name': g('official_name'), 'firm_domain': g('firm_domain'), 'firm_type': g('firm_type'),
            'aliases': split(g('aliases')), 'alias_collisions': split(g('alias_collisions')), 'crunchbase_url': g('crunchbase_url') or '',
            'linkedin_url': g('linkedin_url') or '', 'x_url': g('x_url') or '', 'portfolio_url': g('portfolio_url') or '', 'identity_confidence': g('identity_confidence') or ''}]))
    # 2. Sources: the directory recipe and its health, and each announcement page with its checkpoint.
    srcs = []
    dstat = g('directory_status') or ''
    if g('directory_source_url'):
        row = {'firm': firm, 'url': g('directory_source_url'), 'source_type': 'portfolio_directory',
               'outcome': 'ok' if dstat == 'ok' else ('failed' if dstat == 'broken' else 'partial'),
               'last_count': int(g('directory_found') or 0)}
        row['last_success_at' if dstat in ('ok', 'partial') else 'last_failure_at'] = now
        if g('is_new_recipe'):
            row.update({k: g('recipe_' + k) for k in ('method', 'list_url', 'link_pattern', 'profile_pattern', 'recipe_notes')})
            row['needs_js'] = bool(g('recipe_needs_js')); row['expected_count'] = int(g('recipe_expected_count') or 0)
        srcs.append(row)
    try: news = json.loads(g('news_sources_json') or '[]')
    except (ValueError, TypeError): news = []
    for n in news if isinstance(news, list) else []:
        if not isinstance(n, dict) or not n.get('url'): continue
        # The directory page is often also read for news; its directory health owns the record.
        if n['url'].rstrip('/') == (g('directory_source_url') or '').rstrip('/'): continue
        ok = n.get('status') == 'ok'
        r = {'firm': firm, 'url': n['url'], 'source_type': n.get('source_type') or 'news', 'outcome': 'ok' if ok else 'failed'}
        r['last_success_at' if ok else 'last_failure_at'] = now
        if ok and re.match(r'^\d{4}-\d{2}-\d{2}$', n.get('newest_date') or ''):
            r['checkpoint_date'] = n['newest_date']; r['checkpoint_url'] = n.get('newest_url') or ''
        srcs.append(r)
    if srcs: meta.append(body('firm_sources', srcs))
    # 3. Per-source run status (a failed source is recorded as failed, never as zero companies).
    counts = g('lane_counts') or {}; caps = g('caps') or {}
    fails = {'dealroom': g('dealroom_failed'), 'pitchbook': g('pitchbook_failed'), 'linkedin': g('linkedin_failed'), 'google': g('google_failed')}
    runs = []
    for lane, src in LANE_SOURCE.items():
        c = int(counts.get(lane) or 0)
        if lane == 'official_portfolio': st = {'ok': 'ok', 'partial': 'partial', 'broken': 'failed', 'no_recipe': 'partial'}.get(dstat, 'ok' if c else 'no_new')
        elif lane == 'official_page': st = {'Read through window': 'ok', 'Partial: stopped early': 'partial', 'Fetch failed': 'failed'}.get(g('archive_status') or '', 'ok' if c else 'no_new')
        elif int(fails.get(lane) or 0) > 0 and c == 0: st = 'failed'
        elif (lane == 'dealroom' and caps.get('dealroom_capped')) or (lane == 'salesforce' and caps.get('salesforce_capped')): st = 'capped'
        else: st = 'ok' if c else 'no_new'
        runs.append({'run_id': run_id, 'firm': firm, 'source': src, 'status': st, 'companies': c, 'new_companies': 0,
                     'cap_hit': st == 'capped', 'checkpoint': '', 'error': ''})
    if run_id: meta.append(body('source_runs', runs))
    # 4. Roster evidence for every verified company, grouped by company so parallel batches never share one.
    ver = _items(g('verified')); tv = g('to_verify') or []
    roster, verifs = [], []
    for i, c in enumerate(tv):
        v = ver[i] if i < len(ver) else {}
        v = v.get('output', v) if isinstance(v, dict) else {}
        if not isinstance(v, dict) or v.get('backing') not in ('Confirmed', 'Not confirmed', 'Different firm', 'Unclear'): continue
        domain = v.get('company_domain') or c.get('domain') or ''
        name = v.get('company_name') or c.get('name') or ''
        group = []
        for e in c.get('evidence') or []:
            src = LANE_SOURCE.get(e.get('lane'))
            if not src: continue
            ref = e.get('id') or e.get('url') or (src + ':' + (domain or name))
            group.append({'firm': firm, 'source': src, 'source_ref': ref[:500], 'company_name': name, 'domain': domain,
                          'evidence_url': e.get('url') or '', 'observed_at': now, 'run_id': run_id or None,
                          'round_or_batch': e.get('round') or '', 'invested_at': e.get('date') if re.match(r'^\d{4}-\d{2}-\d{2}$', e.get('date') or '') else None,
                          'payload': {'note': e.get('note') or '', 'role': e.get('role') or '', 'event': e.get('event') or ''}})
        if group: roster.append(group)
        verifs.append({'firm': firm, 'domain': domain, 'company_name': name, 'backing': v.get('backing'), 'relationship': v.get('relationship') or '',
                       'backing_source_url': v.get('backing_source_url') or '', 'latest_round_type': v.get('latest_round_type') or '',
                       'latest_round_date': v.get('latest_round_date') or '', 'latest_round_amount_usd': v.get('latest_round_amount_usd') or 0,
                       'latest_round_leads': v.get('latest_round_leads') or '', 'latest_round_source_url': v.get('latest_round_source_url') or '',
                       'firm_in_latest_round': v.get('firm_in_latest_round') or 'Unknown', 'signal_key': c.get('latest_hint') or '', 'run_id': run_id or None})
    roster_bodies, cur, n = [], [], 0
    for grp in roster:
        if n + len(grp) > 400 and cur: roster_bodies.append(body('roster', cur)); cur, n = [], 0
        cur += grp; n += len(grp)
    if cur: roster_bodies.append(body('roster', cur))
    return {'meta_writes': meta, 'roster_writes': roster_bodies, 'verification_writes': [body('verifications', ch) for ch in chunk(verifs)],
            'counts': {'meta': len(meta), 'roster_rows': sum(len(x) for x in roster), 'verifications': len(verifs), 'sources': len(srcs)}}
