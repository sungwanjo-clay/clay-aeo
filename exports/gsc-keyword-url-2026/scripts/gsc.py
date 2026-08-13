"""Minimal Google Search Console Search Analytics client."""
import json, os, sys, time
import requests

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://searchconsole.googleapis.com/webmasters/v3"

_tok = {"value": None, "exp": 0}


def token():
    if _tok["value"] and time.time() < _tok["exp"] - 60:
        return _tok["value"]
    r = requests.post(TOKEN_URL, data={
        "client_id": os.environ["GSC_CLIENT_ID"],
        "client_secret": os.environ["GSC_CLIENT_SECRET"],
        "refresh_token": os.environ["GSC_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }, timeout=60)
    r.raise_for_status()
    d = r.json()
    _tok["value"] = d["access_token"]
    _tok["exp"] = time.time() + d.get("expires_in", 3600)
    return _tok["value"]


def query(site, body):
    """POST searchAnalytics/query, retrying 429/5xx and transport errors.

    The agent proxy cuts requests off around 30s, so keep each request cheap
    (narrow date range) rather than relying on these retries.
    """
    url = f"{API}/sites/{requests.utils.quote(site, safe='')}/searchAnalytics/query"
    for attempt in range(8):
        try:
            r = requests.post(url, headers={
                "Authorization": f"Bearer {token()}",
                "Content-Type": "application/json",
            }, json=body, timeout=120)
        except requests.RequestException as e:
            wait = min(2 ** attempt, 60)
            print(f"  {type(e).__name__}, retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            wait = min(2 ** attempt, 60)
            print(f"  HTTP {r.status_code}, retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
    raise RuntimeError(f"exhausted retries for {body.get('startDate')}..{body.get('endDate')} startRow={body.get('startRow')}")


def fetch_all(site, start, end, dimensions, row_limit=25000, page_cap=None):
    """Paginate searchAnalytics until exhausted. Returns list of row dicts."""
    rows, start_row = [], 0
    while True:
        body = {
            "startDate": start,
            "endDate": end,
            "dimensions": dimensions,
            "rowLimit": row_limit,
            "startRow": start_row,
            "type": "web",
            "dataState": "final",
        }
        got = query(site, body).get("rows", [])
        rows.extend(got)
        print(f"  {site} {dimensions} startRow={start_row} -> {len(got)} rows "
              f"(total {len(rows)})", file=sys.stderr)
        if len(got) < row_limit:
            break
        start_row += row_limit
        if page_cap and start_row >= page_cap:
            print(f"  WARNING: hit page_cap {page_cap}", file=sys.stderr)
            break
    return rows
