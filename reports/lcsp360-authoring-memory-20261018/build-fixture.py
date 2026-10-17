"""Deterministic sanitized fixture of the live-frozen 48-claim inventory (run 7fefb641); read-only, no DB/provider."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OBS=ROOT/'reports/lcsp360-rule-authoring-20261017/disposable-observation.json'
OUT=ROOT/'deepagents/tests/fixtures/retained-authoring-memory-failure-7fefb641.json'
d=json.loads(OBS.read_text())
run=d['RuleSetPreparationRun'][0];version=run['legalSourceVersionId'];m=d['LegalDocumentMaterialization'][0];doc=d['LegalSourceDocument'][0];inv=d['RuleSetPreparationClaimInventory'][0]
assert run['id']=='7fefb641-d65b-446a-b48f-7baa770c3d4c' and len(inv['graph']['claims'])==48 and inv['revision']==1
drop=lambda row,*k:{a:b for a,b in row.items() if a not in k}
graph={'materializationId':m['id'],'legalSourceVersionId':version,'parserRevision':m['parserRevision'],'materializationRevision':m['materializationRevision'],'sourceDigest':m['sourceDigest'],'graphDigest':m['graphDigest'],'inputModes':m['inputModes'],
 'nodes':sorted([drop(n,'materializationId') for n in d['LegalDocumentNode']],key=lambda n:(n['documentId'],n['structuralPath'])),
 'references':[drop(r,'materializationId','legalSourceVersionId') for r in d['LegalDocumentReference']],
 'chunkMappings':[{'chunkId':r['chunkId'],'legalDocumentNodeId':r['legalDocumentNodeId']} for r in d['LegalDocumentChunkNode']],
 'retrievalUnits':sorted([drop(u,'materializationId','legalSourceVersionId') for u in d['LegalDocumentRetrievalUnit']],key=lambda u:(u['legalDocumentNodeId'],u['ordinal']))}
chunks=[{k:c[k] for k in ('id','documentId','locator','contentSha256','legalStatus','legalEffectStatus','legalStatusSourceRef','content','hierarchy','pageStart','pageEnd')}|{'sourceEffectStatus':doc['sourceEffectStatus']} for c in d['LegalDocumentChunk']]
snap=None
for e in sorted(d['AssessmentRuntimeEvent'],key=lambda e:e['sequence']):
    p=((e['outputSummaryJson'] or {}).get('semanticPayloads') or [{}])[0]
    if p.get('tool_name')=='start_rule_authoring' and p.get('review_frontier'):snap=p['review_frontier']
assert snap,'frontier snapshot'
fixture={'preparationId':run['id'],'sourceVersionId':version,'nativeRunId':d['nativeRuns'][0]['run_id'],'graph':graph,'chunks':chunks,'documents':[doc],
 'frozenInventory':{'revision':inv['revision'],'fingerprint':inv['fingerprint'],'graphDigest':inv['graphDigest'],'reviewedFrontierFingerprint':inv['reviewedFrontierFingerprint'],'identities':inv['identities'],'graph':inv['graph']},'observedFrontierSnapshot':snap}
OUT.write_text(json.dumps(fixture,indent=1,sort_keys=True,ensure_ascii=False)+'\n')
print(OUT.relative_to(ROOT),OUT.stat().st_size,'claims',len(inv['graph']['claims']),'relations',len(inv['graph']['relations']))
