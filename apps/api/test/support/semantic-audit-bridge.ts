/** Provider-free access to the same semantic provenance/audit/closure gates the API executes. */
import { readFileSync } from "node:fs";
import { legalSemanticGraphSchema } from "@lcsp/contracts/compliance-rule-set";
import {
  semanticAuditInput,
  semanticAuditIdentity,
  semanticFreezeFailures,
  semanticClosure,
  requirementClosureFailures,
  semanticRelationBatches,
  semanticRelationInput,
  semanticCompletenessInput,
} from "../../src/modules/compliance-rule-set/domain/semantic-audit.js";
const input = JSON.parse(readFileSync(0, "utf8"));
const graph = legalSemanticGraphSchema.parse(input.graph);
let result: unknown;
if (input.action === "AUDIT_INPUT") {
  const value = semanticAuditInput(
    input.source,
    graph,
    input.nodeId,
    input.revision,
  );
  result = {
    input: value,
    identity: semanticAuditIdentity(value),
    completeness: semanticCompletenessInput(value),
    relationInputs: semanticRelationBatches(value).map((b) =>
      semanticRelationInput(value, b),
    ),
  };
} else if (input.action === "CLOSURE")
  result = semanticClosure(graph, input.anchorId);
else if (input.action === "REQUIREMENT_GATE")
  result = requirementClosureFailures(
    graph,
    input.bindings,
    input.nonRepositoryDuty,
    input.nonAssessable,
  );
else result = semanticFreezeFailures(graph, input.source, input.revision);
console.log(JSON.stringify(result));
