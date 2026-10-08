import {
  LEGACY_OUTBOX_DISPOSITIONS,
  LEGACY_OUTBOX_EVENT_TYPES,
  RETAINED_OUTBOX_EVENT_TYPES,
  V2_WORKER_BOUND_EVENT_TYPES,
  type LegacyOutboxDisposition,
} from "@lcsp/contracts/legacy-migration";

const LEGACY: ReadonlySet<string> = new Set(
  Object.values(LEGACY_OUTBOX_EVENT_TYPES),
);
const RETAINED: ReadonlySet<string> = new Set([
  ...Object.values(V2_WORKER_BOUND_EVENT_TYPES),
  ...Object.values(RETAINED_OUTBOX_EVENT_TYPES),
]);

/**
 * Fail-closed classification of one undelivered outbox message. Only a type positively identified
 * as a retired V1 command/event is cancelled; a type nobody classified is reported and left alone.
 */
export function classifyOutboxEventType(
  eventType: string,
): LegacyOutboxDisposition {
  if (LEGACY.has(eventType)) return LEGACY_OUTBOX_DISPOSITIONS.CANCEL;
  if (RETAINED.has(eventType)) return LEGACY_OUTBOX_DISPOSITIONS.RETAIN;
  return LEGACY_OUTBOX_DISPOSITIONS.UNCLASSIFIED;
}

export const LEGACY_OUTBOX_EVENT_TYPE_LIST: readonly string[] = [...LEGACY];
