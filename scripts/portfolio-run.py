"""
Run the portfolio routines (Clay GTM) over a list of firms, safely and resumably. docs/portfolio-routine.md has the cadence.

    python3 -I scripts/portfolio-run.py plan <weekly|rolling|monthly|firms> <out items.json> [--sheet <sheet-sync result.json>] [--firms "A,B"]
    python3 -I scripts/portfolio-run.py run <discover|refresh> <items.json> <log.jsonl>
    python3 -I scripts/portfolio-run.py publish <snapshot_date> <log.jsonl>
    python3 -I scripts/portfolio-run.py credits

plan
  weekly   Discovery (baseline) for firms the sheet sync just created or listed again (--sheet), Refresh for every other
           listed firm.
  rolling  Discovery for the quarter of listed firms with the oldest roster, Refresh for the rest: run weekly instead of
           'weekly' and every firm is rediscovered about once a month with the spend spread evenly.
  monthly  Discovery for every listed firm: the incremental pass (reruns reuse saved companies and verifications, so they
           look for what's new: portfolio pages, funding news, the source lanes' new entries).
  firms    Discovery for the firms named in --firms (one-off baselines, e.g. the firms that hit the credit limit).
  Firms on hold (clay/portfolio-discovery/routine.json) are skipped. Writes {discover: [...], refresh: [...]} items.

run
  Starts the routine a group at a time (routine.json group size), waits for each group, logs one JSON line per firm
  ({firm, status, run}), and skips firms already logged as complete in the same log, so a rerun resumes. Before each
  group it checks the personal credit balance (clay credits balance) against the group's cost plus a reserve and stops
  with exit 7 if it can't cover it. If Clay holds a run for approval it stops with exit 8 and the request id: approve it
  with --always-allow once (docs/portfolio-routine.md) and run again. It never approves anything itself.

Auth: the Clay CLI's saved sign-in, or CLAY_API_KEY in the environment (scheduled sessions).
"""
import json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'clay/portfolio-discovery/routine.json')))
CLAY = os.environ.get('CLAY_BIN', 'clay')


def clay(*a, inp=None):
    p = subprocess.run([CLAY, *a], input=inp, capture_output=True, text=True)
    out = p.stdout.strip() or p.stderr.strip()
    try:
        return json.loads(out)
    except Exception:
        return {'error': {'code': 'unparsed', 'message': out[:300]}}


def balance():
    b = clay('credits', 'balance')
    u = b.get('user') or {}
    # No personal limit: the workspace balance is what's available.
    return u.get('balance') if u.get('limit') is not None else b.get('balance')


def log_line(path, rec):
    with open(path, 'a') as f:
        f.write(json.dumps(rec) + '\n')


def done_in(path):
    if not os.path.exists(path):
        return set()
    return {json.loads(l)['firm'] for l in open(path) if l.strip() and json.loads(l).get('status') == 'complete'}


def firms_listed(full=False):
    """Listed firms from the portfolio database (dashboard.firms: removed firms are excluded)."""
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('sheet', os.path.join(ROOT, 'scripts/portfolio-sheet-sync.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    fs = m.current_firms()
    return fs if full else [f['name'] for f in fs]


def item(kind, firm):
    slug = ''.join(c if c.isalnum() else '-' for c in firm.lower()).strip('-')
    return {'id': slug, 'inputs': {'firm_name': firm, **CFG['routines'][kind]['inputs'], **({'run_label': 'routine'} if kind == 'discover' else {})}}


def plan(mode, out, args):
    hold = {h.lower() for h in CFG['hold']['firms']}
    if mode == 'firms':
        names = [x.strip() for x in (args.get('--firms') or '').split(',') if x.strip()]
        res = {'discover': [item('discover', n) for n in names if n.lower() not in hold], 'refresh': []}
    else:
        listed = [n for n in firms_listed() if n.lower() not in hold]
        if mode == 'monthly':
            res = {'discover': [item('discover', n) for n in listed], 'refresh': []}
        elif mode == 'rolling':
            # A quarter of the listed firms, oldest roster first: every firm is rediscovered about once a month.
            fs = [f for f in firms_listed(True) if f['name'].lower() not in hold]
            fs.sort(key=lambda f: f.get('roster_refreshed_at') or '')
            n = -(-len(fs) // CFG['rollingWeeks'])
            pick = {f['name'] for f in fs[:n]}
            res = {'discover': [item('discover', f['name']) for f in fs[:n]], 'refresh': [item('refresh', f['name']) for f in fs if f['name'] not in pick]}
        else:
            s = json.load(open(args['--sheet'])) if args.get('--sheet') else {}
            fresh = {x['name'] for x in (s.get('new') or []) + (s.get('reactivated') or [])}
            res = {'discover': [item('discover', n) for n in listed if n in fresh],
                   'refresh': [item('refresh', n) for n in listed if n not in fresh]}
    json.dump(res, open(out, 'w'), indent=1)
    cost = len(res['discover']) * CFG['routines']['discover']['cost'] + len(res['refresh']) * CFG['routines']['refresh']['cost']
    print(f"plan {mode}: {len(res['discover'])} discovery, {len(res['refresh'])} refresh; about {cost:,} credits → {out}")


def wait(run_id):
    t0 = time.time()
    while True:
        s = clay('routines', 'runs', 'get', run_id)
        if s.get('status') not in ('in_progress', 'pending', 'queued'):
            return s
        if time.time() - t0 > CFG['maxWaitMinutes'] * 60:
            return {'status': 'timeout', 'data': []}
        time.sleep(CFG['pollSeconds'])


def name(x):
    return x['inputs'].get('firm_name') or x['id']


def run(kind, items, log):
    r = CFG['routines'][kind]
    done = done_in(log)
    todo = [x for x in items if name(x) not in done]
    print(f'{kind}: {len(items) - len(todo)} already complete in {log}, {len(todo)} to run')
    ok = fail = 0
    for i in range(0, len(todo), r['group']):
        group = todo[i:i + r['group']]
        need = len(group) * r['cost'] + CFG['reserve']
        have = balance()
        if have is not None and have < need:
            print(f'stopping: {have:,.0f} credits left, the next group needs about {need:,} (incl. a {CFG["reserve"]} reserve). '
                  f'{ok} complete, {fail} failed, {len(todo) - i} not started.')
            sys.exit(7)
        res = clay('routines', 'runs', 'start', r['id'], '--input', '-', inp=json.dumps({'items': group}))
        err = res.get('error') or {}
        if err.get('code') == 'approval_required':
            aid = (err.get('details') or {}).get('actionApprovalRequestId')
            print(f'stopping: Clay holds this run for approval ({aid}). Approve it with --always-allow '
                  f'(clay approvals approve {aid} --always-allow), then run this again.')
            sys.exit(8)
        if err:
            print(f'stopping: could not start the group ({err.get("code")}: {err.get("message", "")[:200]})')
            sys.exit(1)
        s = wait(res['routineRunId'])
        by = {x.get('id'): x for x in s.get('data') or []}
        for x in group:
            st = (by.get(x['id']) or {}).get('status') or s.get('status')
            log_line(log, {'firm': name(x), 'status': st, 'run': res['routineRunId'], 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
            ok += st == 'complete'; fail += st != 'complete'
        print(f'  group {i // r["group"] + 1}: ' + ', '.join(f"{name(x)}={(by.get(x['id']) or {}).get('status') or s.get('status')}" for x in group))
    print(f'{kind}: {ok} complete, {fail} failed')
    if fail:
        sys.exit(3)


def main():
    a = sys.argv[1:]
    opts = {a[i]: a[i + 1] for i in range(len(a) - 1) if a[i].startswith('--')}
    pos = [x for i, x in enumerate(a) if not x.startswith('--') and not (i and a[i - 1].startswith('--'))]
    if not pos:
        sys.exit(__doc__)
    cmd = pos[0]
    if cmd == 'credits':
        print(json.dumps({'available': balance()}))
    elif cmd == 'plan' and len(pos) == 3:
        plan(pos[1], pos[2], opts)
    elif cmd == 'run' and len(pos) == 4:
        items = json.load(open(pos[2]))
        run(pos[1], items[pos[1]] if isinstance(items, dict) else items, pos[3])
    elif cmd == 'publish' and len(pos) == 3:
        run('publish', [{'id': f'week-{pos[1]}', 'inputs': {'snapshot_date': pos[1]}}], pos[2])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
