/** Cryptographic worker-origin attestation, separate from model semantic truth. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SemanticAuditReceipt } from "@lcsp/contracts/compliance-rule-set";
import { inventoryHash } from "./claim-inventory.js";

const keyName = "LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY";
const prefix = "LCSP-SEMANTIC-AUDIT-HMAC-V1";
function keyBytes(): Buffer | null {
  const value = process.env[keyName];
  return value && /^[a-f\d]{64}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : null;
}
function message(receipt: SemanticAuditReceipt, runId: string): string {
  const { attestation: _ignored, ...unsigned } = receipt;
  void _ignored;
  return `${prefix}\n${runId}\n${inventoryHash(unsigned)}`;
}
/** This signer is used only by synthetic test fixtures; the live signer runs in Python Agent. */
export function signSemanticAuditFixture(
  receipt: SemanticAuditReceipt,
  runId: string,
): SemanticAuditReceipt {
  if (process.env.NODE_ENV !== "test")
    throw new Error(
      "Structural audit fixture signing is available only under NODE_ENV=test",
    );
  const key = keyBytes();
  if (!key) throw new Error("Test audit attestation key missing");
  return {
    ...receipt,
    attestation: `hmac-sha256:${createHmac("sha256", key).update(message(receipt, runId)).digest("hex")}`,
  };
}
/** No configured key means reject, never trust a bare UUID or client-supplied verdict. */
export function semanticAuditAttestationFailures(
  receipt: SemanticAuditReceipt | undefined,
  runId: string,
): string[] {
  const key = keyBytes();
  if (!key) return ["VERIFIER_ATTESTATION_KEY_NOT_CONFIGURED"];
  if (
    !receipt?.attestation ||
    !/^hmac-sha256:[a-f\d]{64}$/u.test(receipt.attestation)
  )
    return ["VERIFIER_ATTESTATION_MISSING"];
  const expected = createHmac("sha256", key)
    .update(message(receipt, runId))
    .digest();
  const supplied = Buffer.from(
    receipt.attestation.slice("hmac-sha256:".length),
    "hex",
  );
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
    ? []
    : ["VERIFIER_ATTESTATION_INVALID"];
}
