"""Strict harness receipt derived from the committed DETERMINISTIC_GATES.json; fails closed on any non-pass value."""
import json,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent
committed=json.loads(subprocess.check_output(['git','show','HEAD:reports/lcsp360-authoring-memory-20261018/DETERMINISTIC_GATES.json'],cwd=P.parents[1],text=True))
assert committed==json.loads((P/'DETERMINISTIC_GATES.json').read_text()),'working copy differs from the committed gates'
PASSING=('PASS','PROVEN','CORRECT','YES')
receipt={'derivedFrom':'DETERMINISTIC_GATES.json@'+subprocess.check_output(['git','rev-parse','HEAD'],cwd=P.parents[1],text=True).strip(),
         'gates':{}}
for name,value in committed['gates'].items():
    assert value.split(' ',1)[0] in PASSING,(name,value)
    receipt['gates'][name]='PASS'
(P/'DISPOSABLE_GATE_RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'gates':len(receipt['gates']),'derivedFrom':receipt['derivedFrom']}))
