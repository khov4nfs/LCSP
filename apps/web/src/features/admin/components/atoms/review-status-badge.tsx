import {
  AUTHORED_LOCALIZATION_OPERATIONAL_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
} from "@lcsp/contracts/assessment-domain";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const REVIEW_TONES = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
} as const;

type ReviewTone = (typeof REVIEW_TONES)[keyof typeof REVIEW_TONES];

const TONE_CLASSES: Record<ReviewTone, string> = {
  [REVIEW_TONES.success]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [REVIEW_TONES.warning]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [REVIEW_TONES.danger]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
  [REVIEW_TONES.info]:
    "border-status-info-border bg-status-info-bg text-status-info",
};

const TONE_BY_STATE: Record<string, ReviewTone> = {
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY]: REVIEW_TONES.success,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_PENDING]: REVIEW_TONES.info,
  [AUTHORED_LOCALIZATION_READINESS_STATES.PENDING]: REVIEW_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.UNKNOWN_SOURCE]: REVIEW_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.MIXED_SOURCE]: REVIEW_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.SOURCE_REVIEW_REQUIRED]:
    REVIEW_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.OUTPUT_REVIEW_REQUIRED]:
    REVIEW_TONES.warning,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_FAILED]:
    REVIEW_TONES.danger,
  [AUTHORED_LOCALIZATION_OPERATIONAL_STATES.FAILED]: REVIEW_TONES.danger,
};

type ReviewStatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

/**
 * Business purpose: Render a translation review operational or readiness status badge with semantic status tokens.
 * Business rules:
 * - Maps canonical AUTHORED_LOCALIZATION_OPERATIONAL_STATES and AUTHORED_LOCALIZATION_READINESS_STATES to success, info, warning, or danger tokens.
 * - Never presents unreviewed or pending states as approved/ready.
 * Execution flow:
 * 1. Look up the semantic tone in TONE_BY_STATE, defaulting to warning for unknown states.
 * 2. Render Badge with semantic status classes and preserved status text.
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
  const tone = TONE_BY_STATE[status] ?? REVIEW_TONES.warning;
  return (
    <Badge
      variant="outline"
      className={cn("font-medium", TONE_CLASSES[tone], className)}
      data-component="ReviewStatusBadge"
    >
      {label ?? status}
    </Badge>
  );
}
