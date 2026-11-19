"""Bind the Supabase writer account on the four Supabase steps of the GTM workflow.

  python3 bind_supabase.py <appAccountId>

Copies each step's HTTP tool (URL, method, body) from the Clay Team original (get_<oldId>.json), only
changing the account. Run with the GTM workspace active.
"""
import json, subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
acc = sys.argv[1]
st = json.load(open(os.path.join(HERE, 'mig_state.json'))); W = st['workflow']; m = st['idmap']
SUPA = ['wfn_0toqnp0vqe2AzQqgyi4', 'wfn_0toqnvtA7hZcEzcyeDV', 'wfn_0toqnvzKdwuwa5zW5P4', 'wfn_0toqnw7GbcwX2mzVrJA']
def remap(v):
    s = json.dumps(v)
    for o, n in m.items(): s = s.replace(o, n)
    return json.loads(s)
for old in SUPA:
    d = json.load(open(os.path.join(HERE, "source_nodes", f"get_{old}.json"))); d = d.get('node', d)
    tools = [remap(dict({k: x[k] for k in ('toolType', 'actionPackageId', 'actionKey', 'inputMappingConfig')}, appAccountId=acc)) for x in d['tools']]
    p = subprocess.run(['/root/.local/bin/clay', 'workflows', 'nodes', 'update', W, m[old], '--input', '-'],
                       input=json.dumps({'tools': tools}), capture_output=True, text=True)
    r = json.loads(p.stdout or p.stderr)
    print(d['name'], (r.get('error') or {}).get('message') or 'bound')
