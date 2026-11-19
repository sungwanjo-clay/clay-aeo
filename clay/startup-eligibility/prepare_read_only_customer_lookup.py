def handler(context):
    email=str(context.get_input('work_email') or '').strip().lower()
    domain=str(context.get_input('domain') or '').strip().lower()
    email_domain=str(context.get_input('email_domain') or '').strip().lower()
    domain_only=context.get_input('check_mode')=='domain_only'
    # Hex literals prevent applicant text from becoming SQL syntax.
    def literal(value):
        return "HEX_DECODE_STRING('"+value.encode('utf-8').hex()+"')"
    if domain_only:
        # Company check from a domain alone: any customer record on the company domain.
        if not domain:
            raise ValueError('Missing lookup domain; do not treat as new customer')
        domains="LOWER(TRIM(DOMAIN)) = "+literal(domain)
        query="SELECT COUNT(*) AS MATCH_COUNT, 0 AS EMAIL_MATCH_COUNT, COUNT(*) AS DOMAIN_MATCH_COUNT, COUNT_IF(BINARY_CURRENT_CUSTOMER = 1 AND COALESCE(MRR,0) > 0) AS CURRENT_PAID_MATCH_COUNT, COUNT_IF(BINARY_CURRENT_CUSTOMER = 1 OR COALESCE(MRR,0) > 0) AS ACTIVE_OR_REVENUE_MATCH_COUNT, COUNT_IF(COALESCE(TOTAL_COLLECTED,0) > 0) AS HISTORIC_PAYMENT_MATCH_COUNT FROM DBT.PROD.CUSTOMERS WHERE "+domains
        return {'query':query,'customer_lookup_table':'DBT.PROD.CUSTOMERS','customer_lookup_identity':{'email':'','company_domain':domain,'email_domain':domain}}
    if not email or not domain or not email_domain:
        raise ValueError('Missing lookup identity; do not treat as new customer')
    exact="LOWER(TRIM(EMAIL)) = "+literal(email)
    domains="LOWER(TRIM(DOMAIN)) IN ("+literal(domain)+","+literal(email_domain)+")"
    query="SELECT COUNT(*) AS MATCH_COUNT, COUNT_IF("+exact+") AS EMAIL_MATCH_COUNT, COUNT_IF("+domains+") AS DOMAIN_MATCH_COUNT, COUNT_IF(BINARY_CURRENT_CUSTOMER = 1 AND COALESCE(MRR,0) > 0) AS CURRENT_PAID_MATCH_COUNT, COUNT_IF(BINARY_CURRENT_CUSTOMER = 1 OR COALESCE(MRR,0) > 0) AS ACTIVE_OR_REVENUE_MATCH_COUNT, COUNT_IF(COALESCE(TOTAL_COLLECTED,0) > 0) AS HISTORIC_PAYMENT_MATCH_COUNT FROM DBT.PROD.CUSTOMERS WHERE ("+exact+") OR ("+domains+")"
    return {'query':query,'customer_lookup_table':'DBT.PROD.CUSTOMERS','customer_lookup_identity':{'email':email,'company_domain':domain,'email_domain':email_domain}}
