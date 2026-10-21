import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {root,runPython,startStack,workerKey} from '/home/khovan/Workplaces/LCSP/tests/support/compliance-rule-set-stack.mjs';
const stack=await startStack({database:'lcsp360_root_fixture_probe',apiPort:3421});
const dir=mkdtempSync(path.join(tmpdir(),'lcsp360-root-fixture-'));
try {
 for (const mode of ['decisions','single','source-answerable','human','not-applicable','bounded-absence','bounded-absence-gapped','fallback-found']) {
  const fixture=await runPython(path.join(root,'deepagents/tests/vertical/root_semantic_fixture.py'),[mode]);
  const seed=path.join(dir,mode+'.json');writeFileSync(seed,JSON.stringify(fixture));
  const source=await stack.seedLegalSource({name:'root-fixture-'+mode,status:'ACTIVE',documentId:fixture.documentId,chunks:fixture.chunks});
  const run=await stack.activateLegalSource(source);
  const result=await runPython(path.join(root,'deepagents/tests/vertical/scripted_preparation.py'),[stack.base,workerKey,run.preparationRunId,seed,'valid']);
  assert.equal(result.state,'SUCCEEDED',JSON.stringify(result));
  assert.equal(result.submission.validation.outcome,'PASSED');
  console.log(JSON.stringify({fixture:mode,state:result.state,ruleSetVersionId:result.submission.ruleSetVersionId,providerCalls:0}));
 }
} finally {await stack.stop();}
