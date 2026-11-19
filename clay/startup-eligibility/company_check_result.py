import json
from datetime import datetime, timezone

def handler(context):
    raw = context.get_input('screening_record')
    try:
        r = json.loads(raw) if isinstance(raw, str) and raw else (raw if isinstance(raw, dict) else {})
    except (ValueError, TypeError):
        r = {}
    decision = r.get('decision') or 'manual_review'
    counts = ((r.get('customer_check') or {}).get('customer_match_counts') or {})
    ever_paid = (counts.get('HISTORIC_PAYMENT_MATCH_COUNT') or 0) > 0 or (counts.get('CURRENT_PAID_MATCH_COUNT') or 0) > 0
    reasons = list(r.get('decision_reasons') or [])
    if not r:
        reasons = list(context.get_input('intake_reasons') or []) or ['screening_record_missing']
    # Binary: only a clean eligible decision is yes. Ineligible and anything that would need a human are no.
    eligible = decision == 'eligible_candidate' and not ever_paid
    outcome = 'eligible' if eligible else 'not_eligible' if decision == 'ineligible' or ever_paid else 'excluded_needs_review'
    if ever_paid and 'domain_has_paid_clay' not in reasons:
        reasons.insert(0, 'domain_has_paid_clay')
    result = {
        'domain': context.get_input('domain') or r.get('company_domain') or '',
        'company_name': context.get_input('company_name') or r.get('company_name') or '',
        'eligible': eligible, 'outcome': outcome, 'reasons': reasons,
        'funding_stage': r.get('funding_stage') or '', 'funding_date': r.get('funding_date') or '',
        'funding_source_url': r.get('funding_source_url') or '', 'offer_tier': r.get('offer_tier_candidate') or 'unassigned',
        'matched_approved_partners': r.get('matched_approved_partners') or [], 'verified_investors': r.get('verified_investors') or [],
        'ever_paid_clay': ever_paid, 'checked_at': datetime.now(timezone.utc).isoformat(),
    }
    result['result_json'] = json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    return result
