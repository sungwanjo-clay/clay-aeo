import re
from urllib.parse import urlsplit

PERSONAL = {'gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','me.com','aol.com','proton.me','protonmail.com','pm.me','hey.com','fastmail.com','mail.com','gmx.com','yandex.com','qq.com','163.com','126.com','msn.com'}

def domain(value):
    raw = str(value or '').strip().lower()
    if not raw:
        return ''
    try:
        parsed = urlsplit(raw if '://' in raw else 'https://' + raw)
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password:
            return ''
        host = (parsed.hostname or '').rstrip('.').encode('idna').decode('ascii')
        if host.startswith('www.'):
            host = host[4:]
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',host) or '.' not in host or '..' in host:
            return ''
        if all(p.isdigit() for p in host.split('.')) or any(not p or p.startswith('-') or p.endswith('-') for p in host.split('.')):
            return ''
        return host
    except (ValueError,UnicodeError):
        return ''

def handler(context):
    name = str(context.get_input('company_name') or '').strip()[:300]
    website = domain(context.get_input('company_website'))
    email = str(context.get_input('work_email') or '').strip()
    valid_email = bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email))
    email_domain = domain(email.rsplit('@',1)[-1]) if valid_email else ''
    # Preliminary literal match only; research resolves canonical domains and aliases.
    aligned = bool(website and email_domain and (email_domain == website or email_domain.endswith('.'+website)))
    reasons = []
    if not name: reasons.append('company_name_missing')
    if not website: reasons.append('company_website_invalid')
    if not valid_email: reasons.append('work_email_invalid')
    if email_domain in PERSONAL or email_domain.startswith(('yahoo.','hotmail.','outlook.','live.','gmx.','protonmail.')): reasons.append('personal_email_requires_review')
    investors = str(context.get_input('investors') or '').strip()[:4000]
    raw_id = str(context.get_input('submission_id') or '').strip()[:200]
    return {'company_name':name,'domain':website,'work_email':email,'email_domain':email_domain,'email_domain_match':aligned,'claimed_investors':investors,'intake_valid':not reasons,'intake_reasons':reasons,'submission_id':raw_id,'application_key':raw_id or (email.lower()+'|'+website),'dedupe_key_only':True,'source':str(context.get_input('source') or 'startups_form')[:200],'referring_partner_id':str(context.get_input('referring_partner_id') or '')[:200]}


# Domain-only company check (second manual trigger): no applicant, no email. The company domain stands in for the
# email domain so the shared funding, backing and payment checks run unchanged; nothing applicant-specific is recorded.
_form_handler = handler
def handler(context):
    dom = domain(context.get_input('check_domain'))
    if not dom and not str(context.get_input('check_domain') or '').strip():
        out = _form_handler(context)
        out['check_mode'] = 'application'
        return out
    name = str(context.get_input('check_company_name') or '').strip()[:300] or dom
    reasons = [] if dom else ['company_website_invalid']
    return {'company_name': name, 'domain': dom, 'work_email': '', 'email_domain': dom, 'email_domain_match': bool(dom),
            'claimed_investors': str(context.get_input('check_investors') or '').strip()[:4000], 'intake_valid': not reasons,
            'intake_reasons': reasons, 'submission_id': '', 'application_key': 'company_check|' + dom, 'dedupe_key_only': True,
            'source': 'company_check_domain_only', 'referring_partner_id': '', 'check_mode': 'domain_only'}
