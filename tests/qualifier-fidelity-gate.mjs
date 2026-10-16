// Provider-free: real Completion Gate -> Worker API -> validator -> migrated PostgreSQL.
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
import {
  validPacket,
  legalSourceFactory,
} from "../apps/api/test/support/compliance-rule-set-fixtures.ts";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  deriveAssessmentApplicabilityGuidance,
} from "@lcsp/contracts/compliance-rule-set";

const stack = await startStack({
  database: "lcsp_qualifier_fidelity_gate",
  apiPort: 3398,
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
  const packet = validPacket();
  const parent = packet.legalRequirements[0];
  parent.proposition = "A must not impose charges intended to prevent transfer";
  parent.operativePropositions[0].action =
    "impose charges intended to prevent transfer";
  parent.operativePropositions[0].modality = "PROHIBITION";
  packet.legalRequirements[0].applicabilityConditions = [
    "Organization A delegates fulfillment to Organization B and A remains responsible",
  ];
  for (const rule of packet.assessmentRules) {
    rule.applicabilityGuidance = deriveAssessmentApplicabilityGuidance(
      packet.legalRequirements.filter((p) =>
        rule.legalRequirementIds.includes(p.legalRequirementId),
      ),
    );
    for (const criterion of rule.criteria)
      criterion.statement = rule.applicabilityGuidance;
  }
  packet.assessmentRules[0].criteria[0].statement =
    "A must not impose any charges for transfer";
  const result = await runPython(
    "-c",
    [
      `
import json,sys
from rule_set_preparation.tools import RuleSetPreparationContext,build_rule_set_tools
from tools.common.capabilities.platform.api_client import WorkerApiClient
base,key,run,packet=sys.argv[1:]
context=RuleSetPreparationContext(run,WorkerApiClient(base,key))
submit=next(t for t in build_rule_set_tools(context) if t.name=='submit_compliance_rule_set')
result=json.loads(submit.invoke({'packet':json.loads(packet)}))
assert result['completionClaim']=='REJECTED'
assert context.submission is None
print(json.dumps(result))
`,
      stack.base,
      workerKey,
      run,
      JSON.stringify(packet),
    ],
    { env: { PYTHON_DOTENV_DISABLED: "1" } },
  );
  assert(
    result.gaps.failures.some(
      (gap) =>
        gap.code ===
        COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_BINDING_MISMATCH,
    ),
  );
  assert.equal(
    await prisma.complianceRuleSetVersion.count({
      where: { preparationRunId: run },
    }),
    0,
  );
  const good = {
    ...packet,
    assessmentRules: packet.assessmentRules.map(
      ({ applicabilityGuidance, ...rule }) => {
        void applicabilityGuidance;
        return {
          ...rule,
          criteria: rule.criteria.map(({ statement, ...criterion }) => {
            void statement;
            return criterion;
          }),
        };
      },
    ),
  };
  const validated = await stack.post("validations", {
    preparationRunId: run,
    packet: good,
  });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.data.outcome, "PASSED");
  console.log(
    JSON.stringify({
      scope: "PROVIDER_FREE_REAL_COMPLETION_GATE",
      negative: "QUALIFIER_WIDENING_REJECTED",
      gap: COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_BINDING_MISMATCH,
      positive: "PASSED",
      ruleSetsPersisted: 0,
      providerCalls: 0,
    }),
  );
} finally {
  await prisma.$disconnect();
  await stack.stop();
}
