// Provider-free contract matrix through the real Completion Gate and worker HTTP API.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  startStack,
  runPython,
  workerKey,
  apiDir,
} from "./support/compliance-rule-set-stack.mjs";
import { legalSourceFactory } from "../apps/api/test/support/compliance-rule-set-fixtures.ts";
import { semanticFidelityRegressionCases } from "../apps/api/test/support/semantic-fidelity-fixtures.ts";

const stack = await startStack({
  database: "lcsp_semantic_fidelity_gate",
  apiPort: 3397,
});
const require = createRequire(path.join(apiDir, "package.json"));
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const prisma = new PrismaClient({ adapter: new PrismaPg(stack.databaseUrl) });
try {
  const source = await legalSourceFactory(prisma, randomUUID())();
  const activation = await stack.activateLegalSource(source.id);
  assert.equal(activation.runs.length, 1);
  const run = activation.preparationRunId;
  assert.equal(
    (await stack.post("claims", { preparationRunId: run })).status,
    200,
  );
  const cases = semanticFidelityRegressionCases();
  const results = [];
  for (const testCase of cases.bad) {
    const rejected = await runPython(
      "-c",
      [
        String.raw`
import json,sys
from rule_set_preparation.tools import RuleSetPreparationContext,build_rule_set_tools
from tools.common.capabilities.platform.api_client import WorkerApiClient
base,key,run,encoded=sys.argv[1:]
results=[]
for case in json.loads(encoded):
 context=RuleSetPreparationContext(run,WorkerApiClient(base,key))
 submit=next(t for t in build_rule_set_tools(context) if t.name=='submit_compliance_rule_set')
 result=json.loads(submit.invoke({'packet':case['packet']}))
 assert result['completionClaim']=='REJECTED',case['name']
 assert context.submission is None
 assert result['gaps']['failures'],case['name']
 results.append({'case':case['name'],'gate':'REJECTED','gaps':sorted({f['code'] for f in result['gaps']['failures']})})
print(json.dumps({'results':results}))
`,
        stack.base,
        workerKey,
        run,
        JSON.stringify([testCase]),
      ],
      { env: { PYTHON_DOTENV_DISABLED: "1" } },
    );
    results.push(...rejected.results);
  }
  for (const packet of [cases.good, cases.narrower]) {
    const result = await stack.post("validations", {
      preparationRunId: run,
      packet,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.outcome, "PASSED");
  }
  assert.equal(await prisma.complianceRuleSetVersion.count(), 0);
  console.log(
    JSON.stringify({
      scope: "PROVIDER_FREE_REAL_COMPLETION_GATE_MATRIX",
      negatives: results,
      direct: "PASSED",
      legitimateNarrowing: "PASSED",
      ruleSetsPersisted: 0,
      providerCalls: 0,
    }),
  );
} finally {
  await prisma.$disconnect();
  await stack.stop();
}
