"""Add a domain-only company check to the Startup Offer Eligibility draft (workspace 4515).
Run with XDG_CONFIG_HOME pointing at the 4515-switched CLI config. Saves created ids to built.json."""
import json, os, subprocess, sys

E = os.path.dirname(os.path.abspath(__file__))
W = 'wf_0toaxjv4qn3RJ53FEeU'
WEBHOOK, READ_PARTNERS, VALIDATE = 'wfn_0toaxrpkaDimGPnadXg', 'wfn_0togiblcih4XgDQtYAY', 'wfn_0toaxrs2pSvnj8GAMfh'
CUSTPREP, COLLECT, APPREQ = 'wfn_0tobakpabuUkXEXBwvf', 'wfn_0togjpl79MWAZHHshhp', 'wfn_0togjpmxmkFPUKqH9ah'
STATE = os.path.join(E, 'built.json')
st = json.load(open(STATE)) if os.path.exists(STATE) else {}


def clay(*a, inp=None):
    args = ['/root/.local/bin/clay', *a]
    if inp is not None:
        args += ['--input', json.dumps(inp)]
    p = subprocess.run(args, capture_output=True, text=True)
    try:
        return json.loads(p.stdout or p.stderr)
    except Exception:
        return {'raw': (p.stdout + p.stderr)[:500]}


def save():
    json.dump(st, open(STATE, 'w'), indent=1)


def need(r, what):
    if 'error' in r or 'raw' in r:
        print('FAILED', what, json.dumps(r)[:600]); save(); sys.exit(1)
    bad = [u for u in (r.get('appliedUpdates') or []) if not u.get('success')]
    if bad:
        print('PARTIAL', what, json.dumps(bad)[:600]); save(); sys.exit(1)
    print('ok', what)
    return r


def node(i):
    return clay('workflows', 'nodes', 'get', W, i)['node']


# 1. Manual trigger: a domain, optionally a name and claimed investors.
if 'trigger' not in st:
    r = need(clay('workflows', 'triggers', 'create', W, inp={'triggerType': 'manual', 'inputSchema': {
        'type': 'object', 'required': ['domain'], 'properties': {
            'domain': {'type': 'string', 'description': 'Company website or domain'},
            'company_name': {'type': 'string'}, 'investors': {'type': 'string', 'description': 'Optional claimed investors'}}}}),
        'create trigger')
    st['trigger'] = r['resourceId']; st['trigger_node'] = r.get('workflowNodeId'); save()
if not st.get('trigger_node'):
    st['trigger_node'] = clay('workflows', 'triggers', 'get', st['trigger']).get('workflowNodeId'); save()
TN = st['trigger_node']
need(clay('workflows', 'nodes', 'update', W, TN, inp={'name': 'Company check: domain only',
     'description': 'Starts a company-only eligibility check from a domain. No applicant, no email, no application log or Slack review: ends in a yes/no company result.'}), 'name trigger')

# 2. Merge both entry points ahead of the shared registry read.
if 'merge' not in st:
    r = need(clay('workflows', 'nodes', 'create', W, inp={'name': 'Start: application or domain-only check', 'nodeType': 'merge',
        'description': 'Either the application webhook or the domain-only company check starts the shared checks.',
        'incomingEdges': [{'sourceNode': TN}]}), 'create merge')
    st['merge'] = r.get('resourceId') or r.get('nodeId'); save()
# A trigger has one outgoing edge: move the registry read onto the merge first, then hang the webhook on the merge.
need(clay('workflows', 'nodes', 'update', W, READ_PARTNERS, inp={'incomingEdges': [{'sourceNode': st['merge']}]}), 'rewire registry read')
need(clay('workflows', 'nodes', 'update', W, st['merge'], inp={'incomingEdges': [{'sourceNode': WEBHOOK}, {'sourceNode': TN}]}), 'merge both triggers')

# 3. Intake reads the domain-only inputs too.
v = node(VALIDATE)
props = dict(v['inputSchema']['properties'])
for k, src in (('check_domain', '$.domain'), ('check_company_name', '$.company_name'), ('check_investors', '$.investors')):
    props[k] = {'type': 'string', 'sourceNodeId': TN, 'sourcePath': src}
out = dict(v['outputSchema']); out['properties'] = dict(out.get('properties') or {}, check_mode={'type': 'string'})
need(clay('workflows', 'nodes', 'update', W, VALIDATE, inp={'inputSchema': dict(v['inputSchema'], properties=props)}), 'intake inputs')
need(clay('workflows', 'nodes', 'update', W, VALIDATE, inp={'outputSchema': out}), 'intake outputs')
need(clay('workflows', 'nodes', 'update', W, VALIDATE, inp={'code': open(os.path.join(E, 'new/validate.py')).read()}), 'intake code')

# 4. Customer lookup: domain only in that mode.
c = node(CUSTPREP)
props = dict(c['inputSchema']['properties'], check_mode={'type': 'string', 'sourceNodeId': VALIDATE, 'sourcePath': '$.check_mode'})
need(clay('workflows', 'nodes', 'update', W, CUSTPREP, inp={'inputSchema': dict(c['inputSchema'], properties=props)}), 'lookup inputs')
need(clay('workflows', 'nodes', 'update', W, CUSTPREP, inp={'code': open(os.path.join(E, 'new/custprep.py')).read()}), 'lookup code')

# 5. Branch after the screening result: domain-only checks stop at a yes/no result.
if 'cond' not in st:
    r = need(clay('workflows', 'nodes', 'create', W, inp={'name': 'Domain-only company check?', 'nodeType': 'conditional',
        'description': 'Domain-only checks end in a yes/no company result; applications continue to the application log and review.',
        'incomingEdges': [{'sourceNode': COLLECT}]}), 'create branch')
    st['cond'] = r.get('resourceId') or r.get('nodeId'); save()
need(clay('workflows', 'nodes', 'update', W, st['cond'], inp={
    'inputSchema': {'type': 'object', 'properties': {'value': {'type': 'string', 'sourceNodeId': VALIDATE, 'sourcePath': '$.check_mode'}}}}), 'branch input')
need(clay('workflows', 'nodes', 'update', W, st['cond'], inp={'conditionalMode': 'rules', 'rulesConditionalConfig': {'rules': [
    {'id': 'domain_only', 'name': 'domain_only', 'condition': {'type': 'GroupOp', 'combinationMode': 'And',
     'items': [{'type': 'BinOp', 'value': 'domain_only', 'dataPath': ['value'], 'operator': 'Equal'}]}}]}}), 'branch rules')
if 'verdict' not in st:
    r = need(clay('workflows', 'nodes', 'create', W, inp={'name': 'Company check result (yes/no)', 'nodeType': 'code',
        'description': 'Binary company eligibility: yes only for a clean eligible decision on a domain that has never paid Clay; ineligible and anything needing review are no, with reasons.',
        'incomingEdges': [{'sourceNode': st['cond'], 'ruleId': 'domain_only', 'ruleName': 'domain_only'}]}), 'create result step')
    st['verdict'] = r.get('resourceId') or r.get('nodeId'); save()
need(clay('workflows', 'nodes', 'update', W, st['verdict'], inp={'inputSchema': {'type': 'object', 'properties': {
    'screening_record': {'type': 'string', 'sourceNodeId': COLLECT, 'sourcePath': '$.screening_record'},
    'domain': {'type': 'string', 'sourceNodeId': VALIDATE, 'sourcePath': '$.domain'},
    'company_name': {'type': 'string', 'sourceNodeId': VALIDATE, 'sourcePath': '$.company_name'},
    'intake_reasons': {'type': 'array', 'sourceNodeId': VALIDATE, 'sourcePath': '$.intake_reasons'}}}}), 'result inputs')
need(clay('workflows', 'nodes', 'update', W, st['verdict'], inp={'outputSchema': {'type': 'object', 'required': ['eligible', 'outcome'], 'properties': {
    'domain': {'type': 'string'}, 'company_name': {'type': 'string'}, 'eligible': {'type': 'boolean'}, 'outcome': {'type': 'string'},
    'reasons': {'type': 'array', 'items': {'type': 'string'}}, 'funding_stage': {'type': 'string'}, 'funding_date': {'type': 'string'},
    'funding_source_url': {'type': 'string'}, 'offer_tier': {'type': 'string'}, 'matched_approved_partners': {'type': 'array'},
    'verified_investors': {'type': 'array'}, 'ever_paid_clay': {'type': 'boolean'}, 'checked_at': {'type': 'string'}, 'result_json': {'type': 'string'}}}}), 'result outputs')
need(clay('workflows', 'nodes', 'update', W, st['verdict'], inp={'code': open(os.path.join(E, 'new/verdict.py')).read()}), 'result code')

# 6. Applications take the branch's default route, as before.
need(clay('workflows', 'nodes', 'update', W, APPREQ, inp={'incomingEdges': [{'sourceNode': st['cond'], 'isDefaultRoute': True}]}), 'rewire application path')
save()
print(json.dumps(st))
print(json.dumps(clay('workflows', 'graph', 'validate', W))[:1500])
