/** Provider-free parity probe: the same authoritative rule used by COMPLETE and final integrity. */
import { readFileSync } from "node:fs";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import type { LegalSemanticGraph } from "@lcsp/contracts/compliance-rule-set";
import { semanticReferenceBindings } from "../../src/modules/compliance-rule-set/domain/semantic-reference-binding.js";

const input = JSON.parse(readFileSync(0, "utf8")) as {
  graph: LegalDocumentGraph;
  semantic: LegalSemanticGraph;
};
const binding = semanticReferenceBindings(
  input.graph,
  input.semantic.legalSourceVersionId,
  input.semantic.materializationId,
);
const claims = new Map(input.semantic.claims.map((c) => [c.claimId, c]));
console.log(
  JSON.stringify(
    input.semantic.relations.map((r) => binding.failure(r, claims)),
  ),
);
