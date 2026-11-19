import re

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
    return u if re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}', u) and '..' not in u else ''

def handler(context):
    tv = context.get_input('to_verify') or []
    held = context.get_input('held') or []
    ver = _items(context.get_input('verified'))
    doms = []
    for i, c in enumerate(tv):
        v = ver[i] if i < len(ver) else {}
        v = v.get('output', v) if isinstance(v, dict) else {}
        d = dom((v or {}).get('company_domain')) or dom(c.get('domain'))
        if d: doms.append(d)
    doms += [dom(c.get('domain')) for c in held if dom(c.get('domain'))]
    doms += [dom(x) for x in (context.get_input('held_domains') or []) if dom(x)]
    doms += [dom(c.get('domain')) for c in (context.get_input('cached') or []) if dom(c.get('domain'))]
    doms = sorted(set(doms))[:4000]
    if not doms:
        return {'query': "SELECT NULL AS DOMAIN, '[]' AS WS_JSON, '[]' AS SF_JSON WHERE FALSE", 'domains': [], 'domain_count': 0}
    vals = ', '.join("('" + d + "')" for d in doms)
    q = f"""WITH roster AS (SELECT COLUMN1 AS DOMAIN FROM VALUES {vals}),
m AS (
  SELECT DISTINCT r.DOMAIN, TO_VARCHAR(w.WORKSPACE_ID) AS WORKSPACE_ID, 'creator_domain' AS METHOD
  FROM roster r JOIN DBT.PROD.IDENTITY_RESOLUTION_WORKSPACE_BASE w
    ON REGEXP_REPLACE(LOWER(TRIM(w.WORKSPACE_CREATED_BY_USER_DOMAIN)), '^www[.]', '') = r.DOMAIN WHERE w.WORKSPACE_ID IS NOT NULL
  UNION ALL
  SELECT DISTINCT r.DOMAIN, TO_VARCHAR(w.WORKSPACE_ID), 'attribution_domain'
  FROM roster r JOIN DBT.PROD.FCT_PLG_WORKSPACE_ATTRIBUTION_MAP w
    ON REGEXP_REPLACE(LOWER(TRIM(w.CUSTOMER_DOMAIN)), '^www[.]', '') = r.DOMAIN WHERE w.WORKSPACE_ID IS NOT NULL),
p AS (
  SELECT TO_VARCHAR(WORKSPACE_ID) AS WORKSPACE_ID, MAX(IFF(FIRST_INVOICE_UTC IS NOT NULL, 1, 0)) AS EVER_PAID,
         MAX(IFF(BINARY_CURRENT_CUSTOMER = 1, 1, 0)) AS PAYING_NOW, TO_VARCHAR(MIN(CREATED_AT_UTC)::DATE) AS WS_CREATED,
         TO_VARCHAR(MIN(FIRST_INVOICE_UTC)::DATE) AS FIRST_PAID
  FROM DBT.PROD.CUSTOMERS WHERE TO_VARCHAR(WORKSPACE_ID) IN (SELECT WORKSPACE_ID FROM m) GROUP BY 1),
shared AS (SELECT WORKSPACE_ID, COUNT(DISTINCT DOMAIN) AS N_DOMAINS FROM m GROUP BY 1),
wsj AS (
  SELECT m.DOMAIN, ARRAY_AGG(OBJECT_CONSTRUCT('workspace_id', m.WORKSPACE_ID, 'method', m.METHOD, 'ever_paid', p.EVER_PAID,
         'paying_now', p.PAYING_NOW, 'created', p.WS_CREATED, 'first_paid', p.FIRST_PAID, 'shared_domains', s.N_DOMAINS)) AS WS
  FROM m LEFT JOIN p USING (WORKSPACE_ID) LEFT JOIN shared s USING (WORKSPACE_ID) GROUP BY m.DOMAIN),
sf AS (
  SELECT LOWER(REGEXP_REPLACE(REGEXP_REPLACE(a.DOMAIN_C, '^https?://', ''), '^www[.]', '')) AS DOMAIN,
         ARRAY_AGG(OBJECT_CONSTRUCT('account_id', a.ID, 'owner_id', a.OWNER_ID, 'sales_tier', a.SALES_TIER_C, 'open_pipeline', a.OPEN_PIPELINE_C,
                   'account_stage', a.ACCOUNT_STAGE_C, 'gtme', a.GTME_C, 'segment', a.COMPANY_SEGMENT_C)) AS SF
  FROM FIVETRAN.SALESFORCE.ACCOUNT a
  WHERE a.IS_DELETED = FALSE AND LOWER(REGEXP_REPLACE(REGEXP_REPLACE(a.DOMAIN_C, '^https?://', ''), '^www[.]', '')) IN (SELECT DOMAIN FROM roster)
  GROUP BY 1)
SELECT r.DOMAIN, TO_JSON(COALESCE(wsj.WS, ARRAY_CONSTRUCT())) AS WS_JSON, TO_JSON(COALESCE(sf.SF, ARRAY_CONSTRUCT())) AS SF_JSON
FROM roster r LEFT JOIN wsj USING (DOMAIN) LEFT JOIN sf USING (DOMAIN) ORDER BY r.DOMAIN"""
    return {'query': q, 'domains': doms, 'domain_count': len(doms)}
