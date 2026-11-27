import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import {
  STATUS_BADGE_TONES,
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/atoms/status-badge";
import { resolveAppMessage } from "@/lib/i18n";

import { LEGAL_SOURCE_STATUS_MESSAGE_KEYS } from "../../config/legal-source-display.config";

const TONE_BY_STATUS: Record<string, StatusBadgeTone> = {
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.draft]: STATUS_BADGE_TONES.warning,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.active]: STATUS_BADGE_TONES.success,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded]: STATUS_BADGE_TONES.neutral,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid]: STATUS_BADGE_TONES.danger,
};

/**
 * Business purpose: Render a legal source version's lifecycle status badge using the canonical StatusBadge atom.
 * Business rules:
 * - Maps canonical LEGAL_SOURCE_LIFECYCLE_STATUSES values to semantic warning, success, neutral, or danger tones.
 * - Unknown status strings fall back to INVALID.
 * Execution flow:
 * 1. Resolve status against LEGAL_SOURCE_LIFECYCLE_STATUSES.
 * 2. Delegate pill rendering to shared StatusBadge.
 * Failure cases:
 * - Unrecognized status safely renders the invalid badge without throwing.
 * Side effects:
 * - Pure presentational component.
 */
export function LegalSourceLifecycleBadge({ status }: { status: string }) {
  const knownStatus =
    Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES).find(
      (value) => value === status,
    ) ?? LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid;

  return (
    <StatusBadge
      pill
      tone={TONE_BY_STATUS[knownStatus]}
      label={resolveAppMessage(
        LEGAL_SOURCE_STATUS_MESSAGE_KEYS[knownStatus] as MessageKey,
      )}
      className="py-1"
    />
  );
}
