import { Injectable } from "@nestjs/common";

import { AuditSanitizer } from "../../../../../platform/audit/audit-sanitizer.js";

/**
 * Applies the platform audit sanitizer to stored event payloads before they are returned or exported.
 */
@Injectable()
export class AuditRedactorService {
  /**
   * Redacts a record-like audit payload using the centralized sanitizer policy.
   *
   * @param payload - Persisted audit payload to sanitize.
   * @returns Sanitized payload record, or null when the input is not a record or no payload remains.
   */
  redact(payload: unknown): Record<string, unknown> | null {
    if (!isRecord(payload)) {
      return null;
    }

    return AuditSanitizer.sanitize(payload).payload ?? null;
  }
}

/**
 * Checks whether an unknown payload is a non-array object record suitable for sanitization.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a record-like object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
