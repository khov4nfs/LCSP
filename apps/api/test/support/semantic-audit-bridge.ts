import { semanticConceptInput, semanticDefinitionTarget } from "../../src/modules/compliance-rule-set/domain/source-concepts.js";
/** Provider-free access to the same semantic provenance/audit/closure gates the API executes. */
import { readFileSync } from "node:fs";
import { legalSemanticGraphSchema, semanticSourceCatalogSchema } from "@lcsp/contracts/compliance-rule-set";
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
import { semanticSourceMaterialInput, semanticSourceCatalogCurrent } from "../../src/modules/compliance-rule-set/domain/source-completeness.js";
const input = JSON.parse(readFileSync(0, "utf8"));
const graph = legalSemanticGraphSchema.parse(input.graph);
let result: unknown;
if (input.action === "CATALOG_CURRENT") {
  const catalog = semanticSourceCatalogSchema.safeParse(input.catalog);
  result = catalog.success && semanticSourceCatalogCurrent(semanticAuditInput(input.source, graph, input.nodeId, input.revision), catalog.data);
} else if (input.action === "CONCEPT_TARGET") {
  result = semanticDefinitionTarget(input.relation, input.conceptSource, input.concepts);
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
    ...(input.relatedSourceCatalogs ? { conceptSource: semanticConceptInput(value, input.relatedSourceCatalogs) } : {}),
    relationInputs: semanticRelationBatches(value).map((b) =>
      semanticRelationInput(value, b, input.relatedSourceCatalogs, input.sourceConceptAudit),
    ),
  };
} else if (input.action === "RECEIPT_GATE")
  result = semanticAuditReceiptFailures(semanticAuditInput(input.source, graph, input.nodeId, input.revision), graph.semanticAudits?.[0]);
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
