import { Prisma, LegalEffectStatus } from "@prisma/client";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  type PreparationRuleInput,
} from "@lcsp/contracts/legal-rule-catalog";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";

export type CatalogClient = Prisma.TransactionClient;

/**
 * Business purpose: Fingerprint pinned rule inputs independently of their display order.
 * Business rules:
 * - Source hashes bind content; the snapshot retains the exact content separately.
 * Execution flow:
 * 1. Canonicalize identity, revisions and citations
 * 2. Hash the serialization.
 * Failure cases:
 * - Invalid inputs must be rejected by their boundary schema first.
 * Side effects:
 * - Pure hashing, with no model or persistence access.
 */
export function preparationInputFingerprint(
  input: PreparationRuleInput,
): string {
  return sha256Hex(
    canonicalJson({
      ...input,
      citations: input.citations.map((ref) => ({
        chunkId: ref.chunkId,
        documentId: ref.documentId,
        locator: ref.locator,
        contentSha256: ref.contentSha256,
      })),
    }),
  );
}

/**
 * Business purpose: Determine whether a document chunk has an eligible legal effect status for catalog rules.
 * Business rules:
 * - Active law chunks (EFFECTIVE) and unreviewed newly ingested chunks (UNKNOWN) are eligible for citation.
 * - Explicitly repealed (REPEALED) and future/un-enacted (FUTURE) chunks are strictly ineligible.
 * Execution flow:
 * 1. Evaluate chunk legalEffectStatus against allowed active and unreviewed statuses.
 * Failure cases:
 * - None; pure predicate function.
 * Side effects:
 * - Pure predicate evaluation without persistence or I/O side effects.
 */
export function isEligibleLegalChunkStatus(status: LegalEffectStatus): boolean {
  return (
    status === LegalEffectStatus.EFFECTIVE ||
    status === LegalEffectStatus.UNKNOWN
  );
}

/**
 * Business purpose: Report a typed catalog rejection through the shared API envelope.
 * Business rules:
 * - Rejections never create catalog or model work.
 * Execution flow:
 * 1. Construct the requested problem and throw it.
 * Failure cases:
 * - Always rejects with the supplied HTTP status and canonical code.
 * Side effects:
 * - Throws a typed problem without accessing persistence or model providers.
 */
export function catalogFailure(
  code: (typeof E)[keyof typeof E],
  correlationId: string,
  status = 409,
): never {
  throw problemException(code, correlationId, { status });
}
