import { createHash } from "node:crypto";
import type { AuditExportArtifact } from "../../contracts/audit/audit-export.contract.js";

/**
 * Business purpose: Produce a stable digest for the exported audit evidence.
 * Business rules:
 * - Hash every artifact field except the digest itself, regardless of JSONB key order.
 * Execution flow:
 * 1. Recursively sort object keys. 2. Serialize the canonical value. 3. Hash its UTF-8 bytes.
 * Failure cases:
 * - Invalid JSON values are rejected by serialization before persistence.
 * Side effects:
 * - Pure calculation; no persistence or external calls.
 */
export function auditExportChecksum(
  artifact: Omit<AuditExportArtifact, "checksum_sha256">,
): string {
  // JSONB can reorder nested payload keys, so insertion order is not digest authority.
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(artifact)))
    .digest("hex");
}

/**
 * Business purpose: Keep previously issued audit exports readable when their original digest still verifies.
 * Business rules:
 * - Reconstruct the former field order exactly; do not use this format for new exports.
 * Execution flow:
 * 1. Serialize the original artifact fields in their historical order. 2. Hash the bytes.
 * Failure cases:
 * - Historical JSONB key reordering may prevent verification and must fail closed.
 * Side effects:
 * - Pure calculation; no persistence or external calls.
 */
export function auditExportLegacyChecksum(
  artifact: Omit<AuditExportArtifact, "checksum_sha256">,
): string {
  // Rebuild the historic insertion order after JSONB has reordered persisted keys.
  if (
    Object.keys(artifact).sort().join("|") !==
      "events|export_request_id|filter_criteria|generated_at|total_events|version" ||
    !artifact.filter_criteria ||
    Object.keys(artifact.filter_criteria).sort().join("|") !==
      "from_date|to_date" ||
    !Array.isArray(artifact.events) ||
    artifact.events.some(
      (event) =>
        !event ||
        Object.keys(event).sort().join("|") !==
          "actor_id|decision|event_id|event_type|occurred_at|payload",
    )
  ) {
    return "";
  }
  const ordered = {
    export_request_id: artifact.export_request_id,
    version: artifact.version,
    generated_at: artifact.generated_at,
    filter_criteria: {
      from_date: artifact.filter_criteria.from_date,
      to_date: artifact.filter_criteria.to_date,
    },
    total_events: artifact.total_events,
    events: artifact.events.map((event) => ({
      event_id: event.event_id,
      event_type: event.event_type,
      actor_id: event.actor_id,
      decision: event.decision,
      payload: event.payload,
      occurred_at: event.occurred_at,
    })),
  };
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

/**
 * Business purpose: Normalize JSON key order before audit integrity checks.
 * Business rules:
 * - Preserve array order and scalar values; sort only object keys.
 * Execution flow:
 * 1. Recurse through arrays. 2. Sort object entries. 3. Return scalars unchanged.
 * Failure cases:
 * - Caller must provide JSON-compatible content.
 * Side effects:
 * - Pure calculation; input remains unchanged.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
