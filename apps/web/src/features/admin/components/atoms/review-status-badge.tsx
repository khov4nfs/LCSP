import {
  AUTHORED_LOCALIZATION_OPERATIONAL_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
} from "@lcsp/contracts/assessment-domain";

import {
  STATUS_BADGE_TONES,
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/atoms/status-badge";

const TONE_BY_STATE: Record<string, StatusBadgeTone> = {
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY]: STATUS_BADGE_TONES.success,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_PENDING]:
    STATUS_BADGE_TONES.info,
  [AUTHORED_LOCALIZATION_READINESS_STATES.PENDING]: STATUS_BADGE_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.UNKNOWN_SOURCE]:
    STATUS_BADGE_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.MIXED_SOURCE]:
    STATUS_BADGE_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.SOURCE_REVIEW_REQUIRED]:
    STATUS_BADGE_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.OUTPUT_REVIEW_REQUIRED]:
    STATUS_BADGE_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_FAILED]:
    STATUS_BADGE_TONES.danger,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.FAILED]: STATUS_BADGE_TONES.danger,
};

type ReviewStatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

/**
 * Business purpose: Render a translation review operational or readiness status badge via the canonical StatusBadge atom.
 * Business rules:
 * - Maps canonical AUTHORED_LOCALIZATION_OPERATIONAL_STATES and AUTHORED_LOCALIZATION_READINESS_STATES to semantic tones.
 * - Never presents unreviewed or pending states as approved/ready.
 * Execution flow:
 * 1. Look up the semantic tone in TONE_BY_STATE, defaulting to warning for unknown states.
 * 2. Delegate rendering to shared StatusBadge.
 * Failure cases:
 * - Unknown status strings safely render with warning tokens.
 * Side effects:
 * - Pure presentational component.
 */
export function ReviewStatusBadge({
  status,
  label,
  className,
}: ReviewStatusBadgeProps) {
  return (
    <StatusBadge
      tone={TONE_BY_STATE[status] ?? STATUS_BADGE_TONES.warning}
      label={label ?? status}
      className={className}
    />
  );
}
