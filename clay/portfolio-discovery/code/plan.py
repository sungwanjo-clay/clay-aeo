import json, re
from datetime import date, timedelta

def _split(s):
    return [x.strip() for x in (s or '').split('|') if x.strip()]

def _sql_str(s):
    return "'" + s.replace("'", "''") + "'"

def handler(context):
    raw = context.get_input
    cached = raw('cached_identity') or {}
    fresh = bool(raw('identity_fresh'))
    def g(k):
        # Fresh research (when it ran) wins; otherwise the identity saved by an earlier run.
        v = raw(k)
        if (v is None or v == '') and k in cached: return cached.get(k)
        return v
    name = (g('official_name') or g('firm_name') or '').strip()
    listed = (g('firm_name') or '').strip()
    domain = (g('firm_domain') or g('firm_domain_hint') or '').strip().lower()
    domain = re.sub(r'^https?://', '', domain); domain = re.sub(r'^www\.', '', domain).split('/')[0]
    months = int(g('lookback_months') or 12)
    since = (date.today() - timedelta(days=round(months * 30.44))).isoformat()
    aliases = []
    for a in [name, listed] + _split(g('aliases')):
        if a and a.lower() not in [x.lower() for x in aliases]:
            aliases.append(a)
    collisions = _split(g('alias_collisions'))
    cb = (g('crunchbase_url') or '').strip()
    cb = cb if re.match(r'^https://www\.crunchbase\.com/organization/[a-z0-9-]+/?$', cb) else ''
    li = (g('linkedin_url') or '').strip()
    li = li if re.match(r'^https://(www\.)?linkedin\.com/company/[^/?#]+/?$', li) else ''
    quoted = '"' + name + '"'
    google = [
        f'{quoted} led seed round {date.today().year}',
        f'{quoted} leads Series A',
        f'{quoted} backed startup raises',
        f'{quoted} invests in',
        f'{quoted} portfolio company announces funding',
    ]
    if (g('firm_type') or '').lower().startswith('accel'):
        google += [f'{quoted} new cohort startups', f'{quoted} demo day companies', f'{quoted} batch announced']
    # Salesforce reverse lookup: whole-word alias match on the investor-names field.
    # Confusable names (e.g. Accel-KKR) are blanked out of the text first, so a row naming both still matches.
    # Snowflake: REGEXP_LIKE is anchored to the whole string, so use REGEXP_INSTR > 0; and backslashes are
    # string escapes, so special characters are bracketed ([.]) instead of backslash-escaped.
    def lit(a):
        out = ''
        for ch in a.lower():
            out += ch if (ch.isalnum() or ch == ' ') else ('[' + ch + ']' if ch not in '^]\\' else '')
        return out
    x = "LOWER(a.FUNDING_INVESTOR_NAMES_C)"
    for c in collisions:
        x = f"REGEXP_REPLACE({x}, {_sql_str(lit(c))}, ' ')"
    likes = ' OR '.join(f"REGEXP_INSTR({x}, {_sql_str('(^|[^a-z0-9])' + lit(a) + '($|[^a-z0-9])')}) > 0" for a in aliases) or 'FALSE'
    sf = f"""WITH hits AS (
  SELECT a.ID, a.NAME, LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NULLIF(a.DOMAIN_C, ''), a.WEBSITE, ''), '^https?://', ''), '^www[.]', '')) AS DOMAIN,
         a.FUNDING_INVESTOR_NAMES_C AS INVESTORS, TO_VARCHAR(a.LAST_FUNDING_DATE_C::DATE) AS LAST_FUNDING_DATE, a.LAST_FUNDING_TYPE_C AS LAST_FUNDING_TYPE,
         a.LAST_FUNDING_AMOUNT_C AS LAST_FUNDING_AMOUNT, a.FUNDING_SOURCE_LINK_C AS SOURCE_LINK, a.FUNDING_SOURCE_C AS SOURCE,
         a.COMPANY_SEGMENT_C AS SEGMENT, TO_VARCHAR(a.CREATED_DATE::DATE) AS SF_CREATED
  FROM FIVETRAN.SALESFORCE.ACCOUNT a
  WHERE a.IS_DELETED = FALSE AND a.FUNDING_INVESTOR_NAMES_C IS NOT NULL AND ({likes}))
SELECT COUNT(*) OVER () AS TOTAL_MATCHES, * FROM hits ORDER BY LAST_FUNDING_DATE DESC NULLS LAST LIMIT 1500"""
    news_urls = (raw('news_urls') or '') if not fresh else (raw('cached_news_urls') or raw('news_urls') or '')
    return {
        'firm': name, 'firm_listed': listed, 'firm_domain': domain, 'since': since, 'lookback_months': months,
        'news_since': raw('news_since') or since, 'news_urls': news_urls, 'portfolio_url': g('portfolio_url') or '',
        'identity_refreshed': not fresh, 'official_name': name, 'firm_type': g('firm_type') or '', 'x_url': g('x_url') or '',
        'aliases_text': ' | '.join(aliases), 'collisions_text': ' | '.join(collisions), 'crunchbase_url': cb, 'linkedin_url': li,
        'identity_confidence': g('identity_confidence') or '',
        'aliases': aliases, 'collisions': collisions,
        'crunchbase_urls': [cb] if cb else [],
        'dealroom_domains': [domain] if domain else [],
        'pitchbook_queries': [domain] if domain else [],
        'linkedin_urls': [li] if li else [],
        'google_queries': google,
        'sf_query': sf,
        'max_verify': int(g('max_verify') or 300),
    }
