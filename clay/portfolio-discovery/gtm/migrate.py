"""Rebuild the v2 portfolio discovery pipeline from Clay Team into Clay GTM, 1:1.

Reads get_<nodeId>.json (clay workflows nodes get, Team) in v2ids.txt order and recreates each node in the
target workflow, remapping node ids and app accounts. Trigify (not in GTM) is replaced by a Crunchbase step.
State: mig_state.json (old->new ids) so a rerun resumes instead of duplicating.
"""
import json, subprocess, sys, re, os

C = '/root/.local/bin/clay'
HERE = os.path.dirname(os.path.abspath(__file__))
ST = os.path.join(HERE, 'mig_state.json')
state = json.load(open(ST)) if os.path.exists(ST) else {}
W = state['workflow']; TRIG_NEW = state['trigger_node']

OLD_TRIG = 'wfn_0toqjpsufUzUeSDNvaG'
TRIGIFY = 'wfn_0toqk16FTamzgSa5DZ2'
ACCOUNTS = {
    'aa_0sw5puj2EoD7kCZGR92': 'aa_0sw5puj2EoD7kCZGR92',   # Clay-managed Dealroom (same in both)
    'aa_0tazhcz7VoQQTDY9Nxe': 'aa_0tb0pr5tFgqVjrNuY4s',   # PitchBook HTTP: gtm-ops-pb -> GTM "pitchbook"
    'aa_0tdyu9hvui3Kk9fkgmd': 'aa_0t8wzsjMatauEavWaxc',   # Snowflake: gtm-ops-prod -> prod-snowflake
    'aa_0toqdhyeQEaFYikN2JU': None,                       # Supabase writer: bound later
}
CRUNCHBASE = {
    'name': 'Crunchbase: firm investment activity', 'nodeType': 'tool',
    'description': "The firm's recent investments on Crunchbase (company, round, date). Names only; the verify step finds each website.",
    'tools': [{'toolType': 'clay_action', 'actionPackageId': '3886cce5-91b9-4d64-bec5-03bc15eb6a5e',
               'actionKey': 'crunchbase-find-principal-investment-activity', 'appAccountId': 'aa_0t5y29gMFBJZk2arkbn',
               'inputMappingConfig': {'crunchbase_url': {'type': 'item', 'path': '$'}}}],
    'listMode': True, 'listFailureMode': 'ignore_errors',
    'listEntriesRef': {'sourceNodeId': 'wfn_0toqjw72jYAJQqNCPXw', 'path': '$.crunchbase_urls'},
}

def clay(args, payload=None):
    p = subprocess.run([C] + args + (['--input', '-'] if payload is not None else []),
                       input=json.dumps(payload) if payload is not None else None, capture_output=True, text=True)
    try: return json.loads(p.stdout or p.stderr)
    except Exception: return {'error': {'raw': (p.stdout + p.stderr)[:500]}}

def save(): json.dump(state, open(ST, 'w'), indent=1)

ids = open(os.path.join(HERE, 'v2ids.txt')).read().split()
nodes = {}
for i in ids:
    d = json.load(open(os.path.join(HERE, "source_nodes", f"get_{i}.json"))); nodes[i] = d.get('node', d)
nodes[TRIGIFY] = dict(CRUNCHBASE, id=TRIGIFY, incomingEdges=nodes[TRIGIFY]['incomingEdges'],
                      outgoingEdges=nodes[TRIGIFY]['outgoingEdges'], inputSchema=None)

# Drop Trigify inputs downstream; LinkedIn is read by the announcements Claygent's web search instead.
ann = nodes['wfn_0toqk9vwqh6oSnj2cvb']
ann['inputSchema']['properties'].pop('linkedin_posts', None)
ann['agentPrompt'] = ann['agentPrompt'].replace(
    "3. LinkedIn: these are the firm's recent LinkedIn posts; record investment or cohort announcements in them: {{linkedin_posts}}",
    "3. LinkedIn: if the firm has a LinkedIn page, check its recent posts for investment or cohort announcements, if you can access them.")
nodes['wfn_0toqnu24GrASMbZN8BW']['inputSchema']['properties'].pop('linkedin', None)

idmap = state.setdefault('idmap', {OLD_TRIG: TRIG_NEW})
def remap(v):
    s = json.dumps(v)
    for o, n in idmap.items(): s = s.replace(o, n)
    return json.loads(s)
def edges(d, only_created):
    out = []
    for e in d.get('incomingEdges') or []:
        src = e['sourceNode']
        if src not in idmap:
            if only_created: continue
            raise SystemExit(f"unmapped source {src} for {d['name']}")
        out.append(dict(e, sourceNode=idmap[src]))
    return out

errors = []
# Pass 1: create (minimal), in topological order.
for i in ids:
    if i == OLD_TRIG or i in idmap: continue
    d = nodes[i]
    inc = edges(d, True)
    if not inc: raise SystemExit(f"no created predecessor for {d['name']}")
    m = {'name': d['name'], 'nodeType': d['nodeType'], 'incomingEdges': inc[:1]}
    if d['nodeType'] == 'agent': m.update(agentName=d['agentName'], agentPrompt=d['agentPrompt'])
    r = clay(['workflows', 'nodes', 'create', W], m)
    if not r.get('nodeId'): raise SystemExit(f"CREATE FAILED {d['name']}: {json.dumps(r)[:600]}")
    idmap[i] = r['nodeId']; save(); print('created', d['name'], r['nodeId'], flush=True)

# Pass 2: settings, one field group per request.
for i in ids:
    if i == OLD_TRIG: continue
    d = nodes[i]; t = d['nodeType']; ups = []
    if d.get('description'): ups.append({'description': d['description']})
    if d.get('inputSchema'): ups.append({'inputSchema': remap(d['inputSchema'])})
    if t == 'code':
        ups += [{'code': d['code']}, {'outputSchema': d['outputSchema']}]
    elif t == 'tool':
        tools = []
        for x in d['tools']:
            w = {k: x[k] for k in ('toolType', 'actionPackageId', 'actionKey', 'inputMappingConfig') if k in x}
            acc = x.get('appAccountId')
            if acc: w['appAccountId'] = ACCOUNTS.get(acc, acc) if acc in ACCOUNTS else acc
            if w.get('appAccountId') is None: w.pop('appAccountId', None)
            tools.append(remap(w))
        ups.append({'tools': tools})
    elif t == 'conditional':
        ups.append({'conditionalMode': d['conditionalMode'], 'rulesConditionalConfig': remap(d['rulesConditionalConfig'])})
    elif t == 'agent':
        ups += [{'agentModel': d['agentModel'], 'agentInternetSearchEnabled': d['agentInternetSearchEnabled']},
                {'outputSchema': d['outputSchema']}]
    if d.get('listMode'):
        ups.append({'listMode': True, 'listEntriesRef': remap(d['listEntriesRef']), 'listFailureMode': d.get('listFailureMode') or 'ignore_errors'})
    ups.append({'incomingEdges': edges(d, False)})
    for u in ups:
        r = clay(['workflows', 'nodes', 'update', W, idmap[i]], u)
        if 'error' in r: errors.append((d['name'], list(u), json.dumps(r)[:400]))
    print('configured', d['name'], flush=True)

save()
print('ERRORS', len(errors))
for e in errors: print(*e)
