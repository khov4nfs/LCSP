import { describe, expect, it } from "@jest/globals";
import {
  validPacket,
  fixtureChunks,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../domain/compliance-rule-set-integrity.validator.js";
import { storedRuleSetIntegrityValid } from "./stored-rule-set-integrity.js";

const hash = (value: unknown) => sha256Hex(canonicalJson(value));
function fixture(legacy = false) {
  const packet = validPacket();
  // Historical packets predate claims; do not manufacture a retroactive graph for this receipt.
  delete packet.semanticGraph;
  for (const rule of packet.legalRequirements) {
    delete rule.claimBindings;
    delete rule.semanticContext;
  }
  for (const rule of packet.assessmentRules) {
    delete rule.evidenceBindings;
    delete rule.semanticAuthority;
  }
  if (legacy)
    for (const rule of packet.legalRequirements)
      delete rule.operativePropositions;
  const chunks = fixtureChunks().map((c) => ({
    ...c,
    legalSourceVersionId: "source",
  }));
  const chunk = (ref: { locator: string }) =>
    chunks.find((c) => c.locator === ref.locator)!;
  const row = {
    legalSourceVersionId: "source",
    ruleSetDigest: hash(packet),
    rules: packet.legalRequirements.map((r, ordinal) => ({
      ...r,
      id: r.legalRequirementId,
      ordinal,
      coverageState: r.coverage.state,
      nonAssessableReason: r.coverage.nonAssessableReason,
      contentDigest: hash(r),
      provenance: r.sourceRefs.map((ref) => ({
        ...ref,
        chunkId: chunk(ref).id,
        legalSourceVersionId: "source",
      })),
    })),
    assessmentRules: packet.assessmentRules.map((r, ordinal) => {
      const { sourceRefs, ...contract } = r;
      return {
        ...r,
        ordinal,
        contract: {
          ...contract,
          sourceChunkIds: sourceRefs.map((ref) => chunk(ref).id),
        },
        contentDigest: hash(r),
        sourceFingerprint: hash({
          legalSource: "source",
          chunks: sourceRefs
            .map((ref) => `${chunk(ref).id}:${ref.contentSha256}`)
            .sort(),
        }),
        legalRequirementLinks: r.legalRequirementIds.map((id) => ({
          legalRequirementRowId: id,
        })),
      };
    }),
    contextRelations: packet.contextRelations.map((r, ordinal) => ({
      ...r,
      ordinal,
      legalSourceVersionId: "source",
      fromRuleId: r.fromLegalRequirementId,
      toRuleId: r.toLegalRequirementId,
      toChunkId: r.toSourceRef ? chunk(r.toSourceRef).id : null,
      relationDigest: hash(r),
    })),
  } as unknown as Parameters<typeof storedRuleSetIntegrityValid>[0];
  return { row, chunks };
}
describe("Historical stored Rule Set integrity", () => {
  it("reconstructs exact accepted packet and child digests without current semantic reauthoring", () => {
    const { row, chunks } = fixture();
    expect(storedRuleSetIntegrityValid(row, chunks)).toBe(true);
  });
  it("preserves pre-contract historical digests when the additive column is null", () => {
    const { row, chunks } = fixture(true);
    for (const rule of row.rules) rule.operativePropositions = null;
    expect(storedRuleSetIntegrityValid(row, chunks)).toBe(true);
  });
  it.each([
    "requirement",
    "contract",
    "link",
    "relation",
    "hash",
    "source-pin",
    "packet",
  ])("rejects %s corruption", (kind) => {
    const { row, chunks } = fixture();
    const cited = chunks.find(
      (c) => c.id === row.rules[0].provenance[0].chunkId,
    )!;
    if (kind === "requirement") row.rules[0].proposition = "changed";
    if (kind === "contract") row.assessmentRules[0].concept = "changed";
    if (kind === "link") row.assessmentRules[0].legalRequirementLinks = [];
    if (kind === "relation") row.contextRelations[0].toRuleId = row.rules[0].id;
    if (kind === "hash") cited.contentSha256 = "sha256:" + "0".repeat(64);
    if (kind === "source-pin") cited.legalSourceVersionId = "another-source";
    if (kind === "packet") row.ruleSetDigest = "0".repeat(64);
    expect(storedRuleSetIntegrityValid(row, chunks)).toBe(false);
  });
});
