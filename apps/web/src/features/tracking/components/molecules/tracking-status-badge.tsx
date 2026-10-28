import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
  TRACKING_TRUST_STATUSES,
} from "@lcsp/contracts/assessment-domain";
import { Badge } from "@/components/ui/badge";
import type {
  TrackingFreshnessBadgeProps,
  TrackingOutcomeBadgeProps,
  TrackingTrustBadgeProps,
} from "../../types/tracking-ui.types";
import { trackingMessage } from "../../utils/tracking-display";

export function TrackingOutcomeBadge({ outcome }: TrackingOutcomeBadgeProps) {
  const variant =
    outcome === TRACKING_RULE_OUTCOMES.NON_COMPLIANT
      ? "destructive"
      : outcome === TRACKING_RULE_OUTCOMES.COMPLIANT
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant}>{trackingMessage(`outcome.${outcome}`)}</Badge>
  );
}

export function TrackingNotEvaluatedBadge() {
  return <Badge variant="outline">{trackingMessage("notEvaluated")}</Badge>;
}

export function TrackingFreshnessBadge({
  status,
}: TrackingFreshnessBadgeProps) {
  const variant =
    status === TRACKING_FRESHNESS_STATUSES.STALE ? "destructive" : "outline";
  return (
    <Badge variant={variant}>
      {trackingMessage(`freshnessState.${status}`)}
    </Badge>
  );
}

export function TrackingTrustBadge({ status }: TrackingTrustBadgeProps) {
  const variant =
    status === TRACKING_TRUST_STATUSES.TRUSTED
      ? "secondary"
      : status === TRACKING_TRUST_STATUSES.STALE ||
          status === TRACKING_TRUST_STATUSES.BLOCKED
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant}>{trackingMessage(`trustState.${status}`)}</Badge>
  );
}
