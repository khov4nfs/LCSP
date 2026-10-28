import { readFileSync } from "node:fs";
import {
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as K,
  type SourceReviewPayload,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";

const retained = JSON.parse(
  readFileSync(
    new URL(
      "../../../../deepagents/tests/fixtures/retained-reference-binding.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  graph: LegalDocumentGraph;
  reviews: {
    sourceNodeId: string;
    reason: string;
    claimIds: string[];
    payload: SourceReviewPayload;
  }[];
};

export function retainedBindingCase() {
  const fixture = structuredClone(retained);
  const bad = fixture.reviews.flatMap((r) => r.payload.relations)[0];
  const claims = fixture.reviews.flatMap((r) => r.payload.claims);
  const target = claims.find((c) => c.claimType === C.DEFINITION)!;
  return {
    fixture,
    bad,
    claims,
    good: { ...bad, toClaimId: target.claimId, kind: K.DEFINITION },
  };
}
