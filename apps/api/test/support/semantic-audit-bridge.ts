import {
  semanticConceptInput,
  semanticDefinitionTarget,
} from "../../src/modules/compliance-rule-set/domain/source-concepts.js";
/** Provider-free access to the same semantic provenance/audit/closure gates the API executes. */
import { readFileSync } from "node:fs";
import {
  legalSemanticGraphSchema,
  semanticSourceCatalogSchema,
} from "@lcsp/contracts/compliance-rule-set";
import {
  semanticAuditInput,
  semanticAuditIdentity,
  semanticAuditReceiptFailures,
  semanticFreezeFailures,
  semanticClosure,
  requirementClosureFailures,
  semanticRelationBatches,
  semanticRelationInput,
  semanticCompletenessInput,
} from "../../src/modules/compliance-rule-set/domain/semantic-audit.js";
import {
  semanticSourceMaterialInput,
  semanticSourceCatalogCurrent,
} from "../../src/modules/compliance-rule-set/domain/source-completeness.js";
/** One request from the Python parity harness; each action reads only the fields it needs. */
type BridgeRequest = {
  action?: string;
  graph: unknown;
  catalog?: unknown;
  source: Parameters<typeof semanticAuditInput>[0];
  nodeId: string;
  revision: number;
  relation: Parameters<typeof semanticDefinitionTarget>[0];
  conceptSource: Parameters<typeof semanticDefinitionTarget>[1];
  concepts: Parameters<typeof semanticDefinitionTarget>[2];
  relatedSourceCatalogs?: Parameters<typeof semanticConceptInput>[1];
  sourceConceptAudit?: Parameters<typeof semanticRelationInput>[3];
  anchorId: Parameters<typeof semanticClosure>[1];
  bindings: Parameters<typeof requirementClosureFailures>[1];
  nonRepositoryDuty: Parameters<typeof requirementClosureFailures>[2];
  nonAssessable: Parameters<typeof requirementClosureFailures>[3];
};
const input = JSON.parse(readFileSync(0, "utf8")) as BridgeRequest;
const graph = legalSemanticGraphSchema.parse(input.graph);
let result: unknown;
if (input.action === "CATALOG_CURRENT") {
  const catalog = semanticSourceCatalogSchema.safeParse(input.catalog);
  result =
    catalog.success &&
    semanticSourceCatalogCurrent(
      semanticAuditInput(input.source, graph, input.nodeId, input.revision),
      catalog.data,
    );
} else if (input.action === "CONCEPT_TARGET") {
  result = semanticDefinitionTarget(
    input.relation,
    input.conceptSource,
    input.concepts,
  );
} else if (input.action === "AUDIT_INPUT") {
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
    sourceMaterial: semanticSourceMaterialInput(value),
    ...(input.relatedSourceCatalogs
      ? {
          conceptSource: semanticConceptInput(
            value,
            input.relatedSourceCatalogs,
          ),
        }
      : {}),
    relationInputs: semanticRelationBatches(value).map((b) =>
      semanticRelationInput(
        value,
        b,
        input.relatedSourceCatalogs,
        input.sourceConceptAudit,
      ),
    ),
  };
} else if (input.action === "RECEIPT_GATE")
  result = semanticAuditReceiptFailures(
    semanticAuditInput(input.source, graph, input.nodeId, input.revision),
    graph.semanticAudits?.[0],
  );
else if (input.action === "CLOSURE")
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
