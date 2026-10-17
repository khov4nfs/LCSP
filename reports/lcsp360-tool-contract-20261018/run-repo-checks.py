"""Repository-level gates with exit-code receipts (no provider, no database)."""
import json,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
checks=[('typecheck',['pnpm','run','typecheck:run']),('api-build',['pnpm','--filter','@lcsp/api','build']),('imports',['node','scripts/check-import-policy.mjs']),
 ('contract-literals',['node','scripts/check-contract-literals.mjs']),('legal-v1-retired',['node','scripts/check-legal-v1-authority-retired.mjs']),
 ('terminology',['node','reports/lcsp360-tool-contract-20261018/terminology.mjs']),
 ('compileall',['deepagents/.venv/bin/python','-m','compileall','-q','-x',r'/(\.venv|\.uv-cache|__pycache__)/','deepagents']),('diff-check',['git','diff','--check'])]
out=[]
for name,cmd in checks:
    with (HERE/f'check-{name}.log').open('w') as log:rc=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT).returncode
    out.append({'check':name,'exitCode':rc,'command':cmd});print(name,rc,flush=True)
    (HERE/'checks-checks.json').write_text(json.dumps(out,indent=2)+'\n')
