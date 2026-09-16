#!/usr/bin/env python3
"""Query Google Search Console directly — no MCP connector required.

There is no Google Search Console connector in the Claude registry, so the
`gsearchconsole__*` tools some playbooks reference do not exist here. This
script is the working path: service-account (or OAuth refresh-token) auth
against the Search Console API.

Setup is in references/access.md. Requires: pip install google-auth

Usage:
    python3 gsc_query.py --list-sites
    python3 gsc_query.py --dimensions query --filter-page /sequencer
    python3 gsc_query.py --dimensions page --filter-page claygent
    python3 gsc_query.py --dimensions query,page --regex "sdr|inbound|routing"
    python3 gsc_query.py --dimensions query --days 28 --json > rows.json
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
BASE = "https://searchconsole.googleapis.com/webmasters/v3"
DEFAULT_SITE = "sc-domain:clay.com"
# GSC data lags 2-3 days; ending the window today returns a misleading partial.
LAG_DAYS = 3


def token():
    """Bearer token from a service account or an OAuth refresh token."""
    sa = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    if sa:
        try:
            from google.oauth2 import service_account
            from google.auth.transport.requests import Request
        except ImportError:
            sys.exit("google-auth not installed. Run: pip install google-auth")
        info = json.loads(sa) if sa.lstrip().startswith("{") else None
        creds = (service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
                 if info else
                 service_account.Credentials.from_service_account_file(sa, scopes=[SCOPE]))
        creds.refresh(Request())
        return creds.token

    cid, secret, refresh = (os.environ.get(k) for k in
                            ("GSC_CLIENT_ID", "GSC_CLIENT_SECRET", "GSC_REFRESH_TOKEN"))
    if all((cid, secret, refresh)):
        import requests
        resp = requests.post("https://oauth2.googleapis.com/token", timeout=30, data={
            "client_id": cid, "client_secret": secret,
            "refresh_token": refresh, "grant_type": "refresh_token"})
        if not resp.ok:
            sys.exit(f"token exchange failed ({resp.status_code}): {resp.text[:300]}")
        return resp.json()["access_token"]

    sys.exit("No credentials. Set GSC_SERVICE_ACCOUNT_JSON, or the "
             "GSC_CLIENT_ID/GSC_CLIENT_SECRET/GSC_REFRESH_TOKEN trio. "
             "See references/access.md.")


def call(path, tok, payload=None):
    import requests
    url = f"{BASE}/{path}"
    headers = {"Authorization": f"Bearer {tok}"}
    resp = (requests.post(url, headers=headers, json=payload, timeout=60)
            if payload is not None else
            requests.get(url, headers=headers, timeout=60))
    if resp.status_code == 403:
        sys.exit("403 Forbidden. Two usual causes: the service account is not a "
                 "user on this property (Search Console -> Settings -> Users and "
                 "permissions), or the site_url form is wrong "
                 "('sc-domain:clay.com' vs 'https://www.clay.com/'). "
                 "Run --list-sites to see the exact strings you can query.")
    if not resp.ok:
        sys.exit(f"{resp.status_code}: {resp.text[:400]}")
    return resp.json()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.environ.get("GSC_SITE_URL", DEFAULT_SITE))
    ap.add_argument("--list-sites", action="store_true")
    ap.add_argument("--dimensions", default="query", help="query | page | query,page | date")
    ap.add_argument("--filter-page", help="substring match on the page dimension")
    ap.add_argument("--filter-query", help="substring match on the query dimension")
    ap.add_argument("--regex", help="includingRegex on the query dimension")
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--json", action="store_true", help="raw rows, for parse_spillover.py")
    args = ap.parse_args()

    tok = token()

    if args.list_sites:
        for entry in call("sites", tok).get("siteEntry", []):
            print(f"{entry.get('permissionLevel','?'):<24}{entry['siteUrl']}")
        return 0

    end = dt.date.today() - dt.timedelta(days=LAG_DAYS)
    start = end - dt.timedelta(days=args.days)
    filters = []
    if args.filter_page:
        filters.append({"dimension": "page", "operator": "contains",
                        "expression": args.filter_page})
    if args.filter_query:
        filters.append({"dimension": "query", "operator": "contains",
                        "expression": args.filter_query})
    if args.regex:
        filters.append({"dimension": "query", "operator": "includingRegex",
                        "expression": args.regex})

    payload = {"startDate": start.isoformat(), "endDate": end.isoformat(),
               "dimensions": args.dimensions.split(","), "rowLimit": args.limit}
    if filters:
        payload["dimensionFilterGroups"] = [{"filters": filters}]

    site = urllib.parse.quote(args.site, safe="")
    rows = call(f"sites/{site}/searchAnalytics/query", tok, payload).get("rows", [])

    if args.json:
        json.dump({"rows": rows}, sys.stdout, indent=2)
        return 0

    if not rows:
        print(f"0 rows for {args.dimensions} on {args.site} ({start} to {end}).")
        print("An empty result is a finding - but rule out an over-narrow filter "
              "and GSC query anonymization first (rare queries are dropped from "
              "the query dimension entirely, so check the page dimension too).")
        return 0

    print(f"{len(rows)} rows | {args.site} | {start} to {end}\n")
    print(f"{'keys':<52}{'clicks':>8}{'impr':>9}{'pos':>7}{'ctr%':>8}")
    print("-" * 84)
    rows.sort(key=lambda r: -r.get("impressions", 0))
    for row in rows:
        label = " | ".join(row.get("keys", []))
        print(f"{label[:50]:<52}{row.get('clicks',0):>8.0f}{row.get('impressions',0):>9.0f}"
              f"{row.get('position',0):>7.1f}{row.get('ctr',0)*100:>8.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
