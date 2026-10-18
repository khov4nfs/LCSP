import { describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { fixtureLegalSource, validPacket } from "../../../../test/support/compliance-rule-set-fixtures.js";
import { semanticAuditInput } from "./semantic-audit.js";
import { signSemanticAuditFixture, semanticAuditAttestationFailures } from "./semantic-audit-attestation.js";
import { structuralReceipt } from "../../../../test/support/structural-semantic-fixture.js";

function fixture() {
  const source = fixtureLegalSource();
  const packet = validPacket();
  const review = packet.semanticGraph!.sourceAccounting[0];
  const receipt = structuralReceipt(semanticAuditInput(source.documentGraph!, packet.semanticGraph!, review.sourceNodeId, 1));
  return { receipt, run: randomUUID() };
}

describe("LCSP-360 run-scoped independent verifier issuance attestation", () => {
  it("accepts the exact sealed receipt and rejects missing/forged/replayed/stale/wrong-run evidence", () => {
    const { receipt, run } = fixture();
    expect(semanticAuditAttestationFailures(receipt, run)).toContain("VERIFIER_ATTESTATION_MISSING");
    const signed = signSemanticAuditFixture(receipt, run);
    expect(semanticAuditAttestationFailures(signed, run)).toEqual([]);
    expect(semanticAuditAttestationFailures(signed, randomUUID())).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, verifierOperationId: randomUUID() }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, sourceRevision: "0".repeat(64) }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, inventoryRevision: 2 }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, verdict: "CONTRADICTED" }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, gaps: [...signed.gaps, { code: "WRONG_ACTOR", detail: "malicious insertion" }] }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
    expect(semanticAuditAttestationFailures({ ...signed, attestation: "hmac-sha256:" + "0".repeat(64) }, run)).toContain("VERIFIER_ATTESTATION_INVALID");
  });

  it("fails closed if the required private key is missing or incorrectly configured", () => {
    const { receipt, run } = fixture();
    const signed = signSemanticAuditFixture(receipt, run);
    const old = process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY;
    try {
      delete process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY;
      expect(semanticAuditAttestationFailures(signed, run)).toEqual(["VERIFIER_ATTESTATION_KEY_NOT_CONFIGURED"]);
      process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY = "weak-secret";
      expect(semanticAuditAttestationFailures(signed, run)).toEqual(["VERIFIER_ATTESTATION_KEY_NOT_CONFIGURED"]);
    } finally {
      if (old) process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY = old;
      else delete process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY;
    }
  });
});
