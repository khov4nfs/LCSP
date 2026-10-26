import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES as Roles,
  updateLegalSourceDocumentCorpusRoleSchema,
} from "../src/legal-source/management.ts";
import { legalDocumentGraphSchema } from "../src/legal-source/document-graph.ts";

describe("document corpus role contracts", () => {
  it("accepts the canonical roles and refuses producer-supplied denominator overrides", () => {
    expect(Object.values(Roles)).toEqual(["OPERATIVE", "REFERENCE_ONLY"]);
    for (const corpusRole of Object.values(Roles))
      expect(
        updateLegalSourceDocumentCorpusRoleSchema.parse({ corpusRole }),
      ).toEqual({ corpusRole });
    expect(
      updateLegalSourceDocumentCorpusRoleSchema.safeParse({
        corpusRole: "reference_only",
      }).success,
    ).toBe(false);
    expect(
      updateLegalSourceDocumentCorpusRoleSchema.safeParse({
        corpusRole: Roles.REFERENCE_ONLY,
        referenceOnlyDocumentIds: ["b"],
      }).success,
    ).toBe(false);
  });
  it("keeps historical operative graphs readable while carrying reference-only metadata", () => {
    const graph = {
      materializationId: "a".repeat(64),
      legalSourceVersionId: "11111111-1111-4111-8111-111111111111",
      parserRevision: "fixture",
      materializationRevision: "fixture",
      sourceDigest: "b".repeat(64),
      graphDigest: "c".repeat(64),
      inputModes: [],
      nodes: [],
      references: [],
      chunkMappings: [],
      retrievalUnits: [],
    };
    expect(
      legalDocumentGraphSchema.parse(graph).referenceOnlyDocumentIds,
    ).toBeUndefined();
    expect(
      legalDocumentGraphSchema.parse({
        ...graph,
        referenceOnlyDocumentIds: ["b"],
      }).referenceOnlyDocumentIds,
    ).toEqual(["b"]);
  });
});
