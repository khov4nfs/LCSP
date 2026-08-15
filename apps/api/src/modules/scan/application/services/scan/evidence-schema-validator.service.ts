import { HttpStatus, Injectable } from "@nestjs/common";
import {
  SCAN_CALLBACK_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVIDENCE_SCHEMA_VERSIONS,
} from "@lcsp/contracts/scan";

import type { ScanCallbackRequest } from "../../contracts/scan/scan-callback.contract.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "codesnippet",
  "filecontent",
  "rawoutput",
  "rawsource",
  "rawsourcecode",
  "snippet",
  "sourcecode",
  "sourcecontent",
  "prompt",
  "prompttext",
  "fullprompt",
  "astbody",
  "fullast",
  "astdump",
  "secret",
  "token",
  "apikey",
  "apitoken",
  "authorization",
  "credential",
  "password",
]);
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];
const SOURCE_BODY_PATTERN =
  /(?:\bdef\s+\w+\s*\(|\bfunction\s+\w*\s*\(|\bclass\s+\w+|\bimport\s+[\w{*])/;

/**
 * Enforces scanner callback schema/version and fail-closed privacy constraints before technical evidence is persisted.
 */
@Injectable()
export class EvidenceSchemaValidatorService {
  /**
   * Validates callback identity, required records/status, supported schema version, privacy assertions, and unsafe evidence content.
   *
   * @param pathScanJobId - Scan-job identifier from the callback route; must match the payload identifier.
   * @param payload - Scanner callback payload to validate.
   * @param correlationId - Correlation identifier attached to validation problems.
   * @returns Nothing when the callback satisfies all schema and privacy constraints.
   * @throws An unprocessable-entity problem when schema or privacy validation fails.
   */
  validate(
    pathScanJobId: string,
    payload: ScanCallbackRequest,
    correlationId: string,
  ): void {
    if (
      !isRecord(payload) ||
      clean(payload.scan_job_id) !== pathScanJobId ||
      !isStringRecord(payload.tools_version) ||
      !isStringRecord(payload.config_hash) ||
      !isRecord(payload.evidence_payload) ||
      !isRecord(payload.privacy_flags) ||
      !SCAN_EVIDENCE_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof SCAN_EVIDENCE_SCHEMA_VERSIONS)[number],
      ) ||
      !Object.values(SCAN_CALLBACK_STATUSES).includes(payload.status) ||
      (payload.status === SCAN_CALLBACK_STATUSES.failed &&
        !clean(payload.error_code))
    ) {
      this.invalid(SCAN_ERROR_CODES.evidenceSchemaInvalid, correlationId);
    }

    if (
      payload.privacy_flags.containsSourceCode !== false ||
      payload.privacy_flags.secretsRedacted !== true ||
      containsUnsafeEvidence(payload.evidence_payload)
    ) {
      this.invalid(SCAN_ERROR_CODES.privacyFlagsInvalid, correlationId);
    }
  }

  /**
   * Throws the standardized evidence-validation problem for a scan callback.
   *
   * @param errorCode - Stable scan-domain validation error code.
   * @param correlationId - Correlation identifier attached to the problem response.
   * @throws Always throws the unprocessable-entity problem.
   */
  private invalid(errorCode: string, correlationId: string): never {
    throw problemException(errorCode, correlationId, {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
}

/**
 * Checks whether an unknown value is a non-array object record.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is record-like.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a non-empty record whose values are all non-empty strings.
 *
 * @param value - Unknown version/config record to inspect.
 * @returns True when the record contains at least one normalized string value and no non-string/empty values.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((entry) => Boolean(clean(entry)))
  );
}

/**
 * Normalizes a non-empty runtime string without coercing other types.
 *
 * @param value - Unknown value to normalize.
 * @returns Trimmed string value, or null when empty/non-string.
 */
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Recursively detects forbidden raw/source/prompt/secret keys, recognizable secrets, or source-code body strings in evidence JSON.
 *
 * @param value - Arbitrary evidence subtree to inspect.
 * @returns True when unsafe content is present and persistence must be rejected.
 */
function containsUnsafeEvidence(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      SECRET_PATTERNS.some((pattern) => pattern.test(value)) ||
      (value.includes("\n") && SOURCE_BODY_PATTERN.test(value))
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeEvidence);
  }
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    return (
      FORBIDDEN_EVIDENCE_KEYS.has(normalizedKey) ||
      containsUnsafeEvidence(entry)
    );
  });
}
