"""
Weekly firm-list sync: the Venture Partner Program sheet → the portfolio database's firm list (migration 010).

    python3 -I scripts/portfolio-sheet-sync.py <workbook.xlsx> <out.json> [--apply]

The workbook is the sheet exported as .xlsx (Google Drive connector, download_file_content with the xlsx export type).
Rows come from the All Priority tab (one firm per row); the To Approve tab marks pending firms and the Proven tab
(column B) marks firms on the Proven list, the same rules as the Nov 19 load. Firms match the database by name,
lower-cased and trimmed (portfolio.resolve_firm), so renaming a firm in the sheet reads as one removal plus one new firm.

Without --apply: reads the current list (dashboard.firms, read key) and writes the preview to <out.json>:
  {sheet: n, database: n, new: [names], removed: [names], changed: [{name, field, from, to}]}
With --apply: sends the full list to portfolio_ingest_h kind 'firm_list' (key PORTFOLIO_SHEET_KEY), which creates new
firms, updates sheet fields, removes firms no longer listed and lists returning ones, and refuses to remove more than 20%
at once. Writes the database's answer to <out.json> (new firm ids for their baseline discovery). Prints one line either way.

Env (or files of the same names in PORTFOLIO_SECRETS_DIR): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PORTFOLIO_READ_KEY,
PORTFOLIO_SHEET_KEY (apply only). Prints no keys and no contact columns (POC names and emails are never read).
"""
import json, os, sys, urllib.request

import openpyxl


def secret(name, required=True):
    v = os.environ.get(name)
    d = os.environ.get('PORTFOLIO_SECRETS_DIR')
    if not v and d and os.path.exists(os.path.join(d, name)):
        v = open(os.path.join(d, name)).read()
    if not v and required:
        sys.exit(f'missing {name} (env or PORTFOLIO_SECRETS_DIR/{name})')
    return (v or '').strip()


def norm(s):
    return str(s or '').strip().lower()


def cell(v):
    return '' if v is None else str(v).strip()


def read_sheet(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for tab in ('All Priority', 'To Approve', 'Proven'):
        if tab not in wb.sheetnames:
            sys.exit(f'sheet has no "{tab}" tab (tabs: {wb.sheetnames}); refusing to sync')
    rows = list(wb['All Priority'].iter_rows(values_only=True))
    hdr = [norm(x) for x in rows[0]]
    col = {h: i for i, h in enumerate(hdr) if h}
    for need in ('firm', 'partner'):
        if need not in col:
            sys.exit(f'All Priority has no "{need}" column (columns: {[h for h in hdr if h]}); refusing to sync')
    pending = {norm(r[0]) for r in list(wb['To Approve'].iter_rows(values_only=True))[1:] if r and cell(r[0])}
    proven = {norm(r[1]) for r in list(wb['Proven'].iter_rows(values_only=True))[1:] if r and len(r) > 1 and cell(r[1])}
    get = lambda r, h: cell(r[col[h]]) if h in col and col[h] < len(r) else ''
    firms, seen = [], set()
    for r in rows[1:]:
        if not r or not cell(r[0]):
            continue
        name = cell(r[0])
        if norm(name) in seen:
            continue
        seen.add(norm(name))
        firms.append({
            'firm': name,
            'partner_checkbox': get(r, 'partner').upper() == 'TRUE',
            'on_to_approve_tab': norm(name) in pending,
            'on_proven_tab': norm(name) in proven,
            'stage_focus': get(r, 'stage focus') or None,
            'sector_focus': get(r, 'sector focus') or None,
            'region': get(r, 'region') or None,
            'referral_url': get(r, 'utm link') or None,
            'outreached': get(r, 'outreached').upper() == 'TRUE',
        })
    return firms


def rpc(fn, body, headers=None):
    url = secret('SUPABASE_URL').rstrip('/') + f'/rest/v1/rpc/{fn}'
    h = {'apikey': secret('SUPABASE_PUBLISHABLE_KEY'), 'Content-Type': 'application/json', **(headers or {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'{fn} failed: HTTP {e.code} {e.read().decode()[:300]}')


def current_firms():
    out, off = [], 0
    while True:
        page = rpc('portfolio_export', {'p_key': secret('PORTFOLIO_READ_KEY'), 'p_view': 'firms', 'p_offset': off, 'p_limit': 5000})
        out += page.get('rows') or []
        if page.get('done') or not page.get('rows'):
            return out
        off += 5000


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        sys.exit(__doc__)
    sheet = read_sheet(args[0])
    if len(sheet) < 50:
        sys.exit(f'only {len(sheet)} firms in the sheet; refusing (expected about 250)')
    db = {norm(f['name']): f for f in current_firms()}
    sh = {norm(f['firm']): f for f in sheet}
    changed = []
    for k, f in sh.items():
        if k in db:
            for field in ('partner_checkbox', 'on_to_approve_tab', 'on_proven_tab'):
                if bool(db[k].get(field)) != bool(f[field]):
                    changed.append({'name': f['firm'], 'field': field, 'from': bool(db[k].get(field)), 'to': f[field]})
    preview = {'sheet': len(sheet), 'database': len(db), 'new': [sh[k]['firm'] for k in sh if k not in db],
               'removed': [db[k]['name'] for k in db if k not in sh], 'changed': changed}
    if '--apply' not in sys.argv:
        json.dump(preview, open(args[1], 'w'), indent=1)
        print(f"preview: {preview['sheet']} in the sheet, {preview['database']} listed; {len(preview['new'])} new, "
              f"{len(preview['removed'])} removed, {len(changed)} flag changes → {args[1]}")
        return
    res = rpc('portfolio_ingest_h', {'p_kind': 'firm_list', 'p_rows': sheet}, {'x-portfolio-key': secret('PORTFOLIO_SHEET_KEY')})
    res['preview'] = preview
    json.dump(res, open(args[1], 'w'), indent=1)
    print(f"applied: {res.get('listed')} listed; {len(res.get('new') or [])} new, {len(res.get('removed') or [])} removed, "
          f"{len(res.get('reactivated') or [])} back on the list → {args[1]}")


if __name__ == '__main__':
    main()
