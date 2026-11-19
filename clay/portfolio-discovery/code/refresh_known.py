import uuid
from datetime import date

def handler(context):
    """Known companies for a status-only refresh: every company saved as Confirmed for this firm, with its domain and
    latest round, in the shapes the status query and snapshot prep take."""
    st = context.get_input('state') or {}
    st = st.get('result', st) if isinstance(st, dict) else {}
    known = st.get('known_companies') or [] if isinstance(st, dict) else []
    cached, portfolio = [], []
    for k in known:
        d = (k.get('domain') or '').strip().lower()
        if not d or k.get('backing') != 'Confirmed': continue
        cached.append({'domain': d})
        portfolio.append({'domain': d, 'backing': 'Confirmed', 'latest_round_type': k.get('latest_round_type') or '',
                          'latest_round_date': k.get('latest_round_date') or '', 'latest_round_amount_usd': str(k.get('latest_round_amount_usd') or '')})
    return {'cached': cached, 'portfolio': portfolio, 'company_count': len(cached), 'today': date.today().isoformat(),
            'run_id': str(uuid.uuid4()), 'firm_known': bool(st.get('firm_known')) if isinstance(st, dict) else False}
