#!/usr/bin/env python3
"""Upsert private PostHog traffic dashboards and execute each saved query."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', type=Path, default=Path.home()/'.posthog/credentials.json')
parser.add_argument('--plan', type=Path, default=Path(__file__).resolve().parents[1]/'agent/traffic-dashboards.json')
parser.add_argument('--receipt', type=Path, default=Path('/tmp/serena-traffic-dashboard-receipt.json'))
parser.add_argument('--check-only', action='store_true')
args = parser.parse_args()
plan = json.loads(args.plan.read_text())
token = json.loads(args.credentials.read_text())['token']
base = f"https://us.posthog.com/api/projects/{plan['project_id']}/"

def api(path, data=None, method=None):
    request = urllib.request.Request(base+path, data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization': 'Bearer '+token, 'Content-Type':'application/json'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"PostHog {path} returned HTTP {error.code}") from None

def query_source(query):
    return query.get('source', query)

existing_dashboards = {row['name']:row for row in api('dashboards/?limit=100')['results']}
existing_insights = {row['name']:row for row in api('insights/?limit=200')['results']}
receipt = []
for entry in plan['dashboards']:
    dashboard = existing_dashboards.get(entry['name'])
    if not args.check_only:
        body = {'name':entry['name'],'description':entry['description'],'pinned':True,'tags':['serena-launch'], 'filters':{'filterTestAccounts':True}}
        dashboard = api(f"dashboards/{dashboard['id']}/",body,'PATCH') if dashboard else api('dashboards/',body)
    if not dashboard:
        raise RuntimeError(f"Missing dashboard: {entry['name']}")
    checks = []
    for insight in entry['insights']:
        saved = existing_insights.get(insight['name'])
        if not args.check_only:
            body = {**insight,'dashboards':[dashboard['id']],'tags':['serena-launch']}
            saved = api(f"insights/{saved['id']}/",body,'PATCH') if saved else api('insights/',body)
        if not saved:
            raise RuntimeError(f"Missing insight: {insight['name']}")
        # Read back provider state before claiming the stored report works.
        saved = api(f"insights/{saved['id']}/")
        result = api('query/',{'query':query_source(saved['query']),'name':'Prelaunch validation: '+insight['name']})
        if result.get('error') or result.get('results', result.get('result')) is None:
            raise RuntimeError(f"Query failed: {insight['name']}")
        checks.append({'id':saved['id'],'name':insight['name'],'query_ok':True,'rows':len(result.get('results', result.get('result',[])) or [])})
        print('Validated:',insight['name'], flush=True)
    receipt.append({'id':dashboard['id'],'name':entry['name'],'url':f"https://us.posthog.com/project/{plan['project_id']}/dashboard/{dashboard['id']}",'checks':checks})
args.receipt.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
for row in receipt:
    print(row['url'])
