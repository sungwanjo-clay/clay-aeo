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
    g = context.get_input
    firm = g('firm') or ''
    since = g('since') or ''
    max_verify = int(g('max_verify') or 300)
    cos, by_dom, by_name = [], {}, {}
    lane_raw = {l: 0 for l in LANES}

    def upsert(name, domain, lane, ev):
        # PitchBook appends the industry: "Punch (Business/Productivity Software)". Emails are page junk, not companies.
        name = _PAREN.sub('', name or '').strip()
        if '@' in name: name = ''
        if '@' in (domain or ''): domain = ''
        d, k = dom(domain), nkey(name)
        if not d and not k: return
        c = None
        if d and d in by_dom: c = by_dom[d]
        elif k and k in by_name: c = by_name[k]
        if c is None:
            c = {'name': (name or d).strip(), 'domain': d, 'lanes': [], 'evidence': [], 'dates': [], 'round_hints': []}
            cos.append(c)
        if d and not c['domain']: c['domain'] = d
        if d: by_dom[d] = c
        if k: by_name.setdefault(k, c)
        if lane not in c['lanes']: c['lanes'].append(lane)
        if len(c['evidence']) < 8:
            e = {k: str(ev.get(k) or '') for k in ('note', 'date', 'round', 'url', 'id', 'role', 'event')}
            e['lane'] = lane
            c['evidence'].append(e)
        if ev.get('date'): c['dates'].append(str(ev['date']))
        if ev.get('round'): c['round_hints'].append(str(ev['round']))
        lane_raw[lane] += 1

    # Dealroom, PitchBook and Salesforce, already flattened by the normalize step (lane, name, domain, date, round, url, id, note).
    sf_total = int(g('salesforce_total') or 0); sf_rows = int(g('salesforce_rows') or 0)
    for line in g('provider_rows') or []:
        f = (line.split('\t') + [''] * 8)[:8]
        upsert(f[1], f[2], f[0], {'date': f[3], 'round': f[4], 'url': f[5], 'id': f[6], 'note': f[7]})
    # Announcements from official pages, Google, LinkedIn, X.
    try: ann = json.loads(g('announcements_json') or '[]')
    except (ValueError, TypeError): ann = []
    ann_bad = not isinstance(ann, list)
    for a in ann if isinstance(ann, list) else []:
        if not isinstance(a, dict): continue
        lane = a.get('source_lane') if a.get('source_lane') in LANES else 'google'
        upsert(a.get('company'), a.get('company_domain'), lane,
               {'date': a.get('announced_on') or '', 'round': a.get('round_type') or a.get('event_type') or '', 'url': a.get('source_url') or '',
                'role': a.get('firm_role') or '', 'event': a.get('event_type') or ''})

    # Official portfolio directory (undated membership): the deterministic reader first, then the research fallback.
    try: port = json.loads(g('portfolio_json') or '[]')
    except (ValueError, TypeError): port = []
    port = (g('directory_companies') or []) + (port if isinstance(port, list) else [])
    for p in port if isinstance(port, list) else []:
        if isinstance(p, dict):
            upsert(p.get('company') or p.get('website'), p.get('website') or p.get('domain'), 'official_portfolio',
                   {'note': ('Official portfolio page' + (': ' + str(p.get('fund_or_batch')) if p.get('fund_or_batch') else '') + (' (' + str(p.get('status')) + ')' if p.get('status') else '')),
                    'url': p.get('profile_url') or '', 'id': p.get('profile_url') or dom(p.get('website') or '')})
    # Coverage: companies per lane and companies only that lane found.
    per_lane = {l: sum(1 for c in cos if l in c['lanes']) for l in LANES}
    only = {l: sum(1 for c in cos if c['lanes'] == [l]) for l in LANES}
    caps = {'salesforce_capped': sf_total > sf_rows, 'salesforce_total_matches': sf_total,
            'dealroom_capped': bool(g('dealroom_capped')), 'dealroom_total': int(g('dealroom_total') or 0)}

    # Incremental: what we already know about this firm's companies.
    known_by = {}
    for k in g('known_companies') or []:
        if '@' in (k.get('name') or ''): continue
        for key in filter(None, [dom(k.get('domain')), 'name:' + nkey(k.get('name'))]):
            known_by.setdefault(key, k)
    # Verified names are often longer than lane names ("Opus Training" vs "Opus", "The Climate Choice" vs
    # "ClimateChoice"). Fall back to containment on normalized names, accepted only when exactly one known fits.
    def loose(n):
        n = _PAREN.sub('', n or '')
        return re.sub(r'^the', '', nkey(n))
    known_loose = [(loose(k.get('name')), k) for k in g('known_companies') or [] if '@' not in (k.get('name') or '') and len(loose(k.get('name'))) >= 3]
    def fuzzy_known(name):
        q = loose(name)
        if len(q) < 3: return None
        hits = {id(k): k for kn, k in known_loose if kn.startswith(q) or q.startswith(kn) or (len(q) >= 6 and q in kn)}
        return next(iter(hits.values())) if len(hits) == 1 else None
    today = (g('today') or '')[:10]
    def prio(c):
        recent = max(c['dates']) if c['dates'] else ''
        independent = [l for l in c['lanes'] if l != 'salesforce']
        return ((('official_page' in c['lanes']) or ('official_portfolio' in c['lanes'])), len(independent), recent >= since, recent)
    ranked = sorted(cos, key=prio, reverse=True)
    rotation_budget = max(1, max_verify // 10)
    picked, reasons = 0, {'new': 0, 'changed': 0, 'unresolved': 0, 'refresh': 0}
    verify, held, cached = [], [], []
    used_known = set()
    for c in ranked:
        c['latest_hint'] = max(c['dates']) if c['dates'] else ''
        k = known_by.get(c['domain']) or known_by.get('name:' + nkey(c['name'])) or fuzzy_known(c['name'])
        if k:
            # A name-only lane hit for a company we already resolved keeps the saved domain, and two lane hits for the
            # same saved company collapse into one row.
            kid = k.get('company_id') or dom(k.get('domain')) or nkey(k.get('name'))
            if kid in used_known: continue
            used_known.add(kid)
            if not c['domain']: c['domain'] = dom(k.get('domain'))
        c['key'] = c['domain'] or 'name:' + nkey(c['name'])
        why = ''
        if not k: why = 'new'
        elif k.get('backing') in ('', 'Unclear'): why = 'unresolved'
        elif c['latest_hint'] and c['latest_hint'] > (k.get('signal_key') or ''): why = 'changed'
        elif k.get('verified_at') and today and k['verified_at'][:10] < today and (int(today[:4]) * 12 + int(today[5:7])) - (int(k['verified_at'][:4]) * 12 + int(k['verified_at'][5:7])) >= 6 and rotation_budget > 0:
            why = 'refresh'; rotation_budget -= 1
        item = {'key': c['key'], 'name': c['name'] or '', 'domain': c['domain'] or '', 'lanes': c['lanes'], 'evidence': c['evidence'][:5],
                'latest_hint': c['latest_hint'] or '', 'round_hints': c['round_hints'][:3], 'why': why or 'cached'}
        if why and picked < max_verify:
            verify.append(item); picked += 1; reasons[why] += 1
        elif why:
            held.append({x: item[x] for x in ('key', 'name', 'domain', 'lanes', 'latest_hint')})
        else:
            cached.append(dict({x: item[x] for x in ('key', 'name', 'domain', 'lanes', 'latest_hint')},
                               **{f: k.get(f) or '' for f in ('backing', 'relationship', 'backing_source_url', 'latest_round_type', 'latest_round_date',
                                                              'latest_round_amount_usd', 'latest_round_leads', 'latest_round_source_url', 'firm_in_latest_round', 'verified_at')}))
    # Known companies no lane found this week stay in the portfolio (a lane missing a company isn't evidence it left).
    seen = set()
    for c in ranked:
        seen.add(c['domain']); seen.add('name:' + nkey(c['name']))
    for k in g('known_companies') or []:
        if dom(k.get('domain')) in seen or ('name:' + nkey(k.get('name'))) in seen: continue
        if k.get('backing') != 'Confirmed' or '@' in (k.get('name') or ''): continue
        cached.append({'key': dom(k.get('domain')) or 'name:' + nkey(k.get('name')), 'name': k.get('name') or '', 'domain': dom(k.get('domain')),
                       'lanes': ['previous_run'], 'latest_hint': k.get('signal_key') or '',
                       **{f: k.get(f) or '' for f in ('backing', 'relationship', 'backing_source_url', 'latest_round_type', 'latest_round_date',
                                                      'latest_round_amount_usd', 'latest_round_leads', 'latest_round_source_url', 'firm_in_latest_round', 'verified_at')}})
    return {'companies_total': len(cos), 'to_verify': verify, 'not_verified_this_run': held[:500], 'not_verified_count': len(held),
            'not_verified_domains': [h['domain'] for h in held if h['domain']], 'cached': cached, 'verify_reasons': reasons,
            'lane_counts': per_lane, 'lane_only_counts': only, 'caps': caps, 'announcements_parse_error': ann_bad,
            'firm': firm}
