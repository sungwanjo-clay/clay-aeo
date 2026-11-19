import json, uuid
from datetime import date, datetime, timedelta

def _d(s):
    try: return datetime.fromisoformat(str(s)[:19].replace('Z', '')).date()
    except (ValueError, TypeError): return None

def handler(context):
    g = context.get_input
    raw = g('state')
    st = raw.get('result', raw) if isinstance(raw, dict) else {}
    if not isinstance(st, dict) or 'firm_known' not in st: st = {}
    ok_state = bool(st)
    today = date.today()
    months = int(g('lookback_months') or 12)
    window_start = today - timedelta(days=round(months * 30.44))
    ident = st.get('identity') or {}
    checked = _d(ident.get('identity_checked_at'))
    sources = st.get('sources') or []
    news = [s for s in sources if s.get('source_type') in ('news', 'blog', 'press', 'portfolio_news', 'cohort', 'feed') and s.get('status') != 'retired']
    any_news_broken = any(s.get('status') == 'broken' for s in news)
    identity_fresh = bool(checked and (today - checked).days <= 90 and ident.get('identity_confidence') in ('High', 'Medium') and not any_news_broken)
    news_ok = [s for s in news if s.get('status') != 'broken']
    cps = [_d(s.get('checkpoint_date')) for s in news_ok if s.get('checkpoint_date')]
    news_since = max(window_start, (min(cps) - timedelta(days=14))) if cps else window_start
    dirs = [s for s in sources if s.get('source_type') == 'portfolio_directory' and s.get('status') in ('verified', 'candidate')]
    dirs.sort(key=lambda s: (s.get('status') == 'verified', s.get('updated_at') or ''), reverse=True)
    rec = dirs[0] if dirs else {}
    recipe_ok = bool(rec.get('method') and rec.get('method') != 'agent_only' and rec.get('list_url') and int(rec.get('consecutive_failures') or 0) == 0)
    known = []
    for k in st.get('known_companies') or []:
        known.append({f: ('' if k.get(f) is None else str(k.get(f))) for f in
                      ('name', 'domain', 'verification_status', 'verified_at', 'backing', 'relationship', 'backing_source_url', 'latest_round_type',
                       'latest_round_date', 'latest_round_amount_usd', 'latest_round_leads', 'latest_round_source_url', 'firm_in_latest_round', 'signal_key')})
    return {
        'run_id': str(uuid.uuid4()), 'state_loaded': ok_state, 'first_run': not known,
        'identity_fresh': identity_fresh,
        'cached_identity': {f: ('' if ident.get(f) is None else (' | '.join(ident.get(f)) if isinstance(ident.get(f), list) else str(ident.get(f))))
                            for f in ('official_name', 'firm_domain', 'firm_type', 'aliases', 'alias_collisions', 'crunchbase_url', 'linkedin_url', 'x_url', 'portfolio_url', 'identity_confidence')},
        'cached_news_urls': ' | '.join(s.get('url') for s in news_ok if s.get('url')),
        'news_since': news_since.isoformat(), 'window_start': window_start.isoformat(),
        'recipe_ok': recipe_ok,
        'recipe': {f: ('' if rec.get(f) is None else str(rec.get(f))) for f in ('url', 'method', 'list_url', 'link_pattern', 'profile_pattern', 'expected_count', 'last_count', 'checkpoint_date', 'recipe_version')}
                  | {'needs_js': bool(rec.get('needs_js'))},
        'known_companies': known, 'known_count': len(known), 'today': today.isoformat(),
        'known_profile_urls': [u for u in (st.get('known_profile_urls') or []) if isinstance(u, str)][:20000],
    }
