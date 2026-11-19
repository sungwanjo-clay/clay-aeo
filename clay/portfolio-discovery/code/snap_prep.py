import json, re
from datetime import date, timedelta

def body(kind, rows):
    return json.dumps({'p_kind': kind, 'p_rows': rows}, separators=(',', ':'))

def chunk(rows, n=300):
    return [rows[i:i + n] for i in range(0, len(rows), n)]

def _json(v):
    if isinstance(v, (list, dict)): return v
    try: return json.loads(v or '[]')
    except (ValueError, TypeError): return []

def _amount(v):
    s = re.sub(r'[,$\s]', '', str(v or ''))
    m = re.fullmatch(r'(\d+(?:\.\d+)?)([kmb]?)', s.lower())
    if not m: return None
    return round(float(m.group(1)) * {'': 1, 'k': 1e3, 'm': 1e6, 'b': 1e9}[m.group(2)])

def handler(context):
    g = context.get_input
    today = date.fromisoformat((g('today') or date.today().isoformat())[:10])
    snap = (today - timedelta(days=today.weekday())).isoformat()   # the week's Monday
    run_id = g('run_id') or None

    # Clay status from the Snowflake lookup. If the lookup returned nothing at all, every company is 'failed'
    # (unknown), never 'no_exact_match'.
    st = g('status') or {}
    st = st.get('result', st) if isinstance(st, dict) else {}
    rows = st.get('rows') if isinstance(st, dict) else None
    lookup_ok = isinstance(rows, list) and len(rows) > 0
    by_dom = {}
    for r in rows or []:
        d = (r.get('DOMAIN') or '').lower()
        if d: by_dom[d] = _json(r.get('WS_JSON'))

    lookups, elig = [], []
    seen = set()
    for c in g('portfolio') or []:
        d = (c.get('domain') or '').lower().strip()
        if not d or d in seen or c.get('backing') != 'Confirmed': continue
        seen.add(d)
        if not lookup_ok:
            lookups.append({'snapshot_date': snap, 'domain': d, 'lookup_status': 'failed', 'workspaces': [], 'run_id': run_id,
                            'note': 'Snowflake status lookup returned no rows this run'})
        else:
            ws, keys = [], set()
            for w in by_dom.get(d, []):
                k = (str(w.get('workspace_id') or ''), w.get('method') or '')
                if not k[0] or k in keys or k[1] not in ('creator_domain', 'attribution_domain', 'customers_domain'): continue
                keys.add(k)
                ws.append({'workspace_id': k[0], 'match_method': k[1], 'matched_value': d,
                           'ever_paid': bool(w.get('ever_paid')), 'paying_now': bool(w.get('paying_now'))})
            lookups.append({'snapshot_date': snap, 'domain': d, 'lookup_status': 'matched' if ws else 'no_exact_match',
                            'workspaces': ws, 'run_id': run_id})
        lr = (c.get('latest_round_date') or '')[:10]
        last = lookups[-1]
        acct = ('unknown' if last['lookup_status'] == 'failed' else 'none' if last['lookup_status'] == 'no_exact_match'
                else 'paid' if any(w['paying_now'] for w in last['workspaces']) else 'free')
        # Eligibility (Seed/Series A, VC-backed, net new) belongs to the Startup Offer Eligibility workflow; discovery
        # only records the round it verified, so these stay unknown / needs_check.
        elig.append({'snapshot_date': snap, 'domain': d, 'run_id': run_id, 'clay_account': acct,
                     'funding_fit': 'unknown', 'funding_fit_reason': 'Not assessed by portfolio discovery (set by the eligibility workflow)',
                     'net_new_check': 'needs_check', 'net_new_reason': 'Not assessed by portfolio discovery',
                     'funding_stage': c.get('latest_round_type') or None,
                     'last_round_at': lr if re.fullmatch(r'\d{4}-\d{2}-\d{2}', lr) else None,
                     'last_round_amount_usd': _amount(c.get('latest_round_amount_usd'))})
    return {'snapshot_date': snap,
            # reopen: a firm run after this week was published reopens it; publishing again refreezes membership.
            'open_write': body('snapshot_open', [{'snapshot_date': snap, 'run_id': run_id, 'reopen': True}]),
            'lookup_writes': [body('workspace_lookups', ch) for ch in chunk(lookups)],
            'eligibility_writes': [body('snapshots', ch) for ch in chunk(elig)],
            'lookup_count': len(lookups), 'matched': sum(1 for l in lookups if l['lookup_status'] == 'matched'),
            'lookup_ok': lookup_ok}
