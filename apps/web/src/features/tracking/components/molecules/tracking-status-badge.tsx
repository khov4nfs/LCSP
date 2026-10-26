import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
  TRACKING_TRUST_STATUSES,
  type TrackingFreshnessStatus,
  type TrackingRuleOutcome,
  type TrackingTrustStatus,
} from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Badge } from "@/components/ui/badge";
import { appLocale } from "@/lib/locale";

export function TrackingOutcomeBadge({ outcome }: { outcome: TrackingRuleOutcome }) {
  const variant = outcome === TRACKING_RULE_OUTCOMES.NON_COMPLIANT
    ? "destructive"
    : outcome === TRACKING_RULE_OUTCOMES.COMPLIANT
      ? "secondary"
      : "outline";
  return <Badge variant={variant}>{t(`outcome.${outcome}`)}</Badge>;
}

export function TrackingNotEvaluatedBadge() {
  return <Badge variant="outline">{t("notEvaluated")}</Badge>;
}

export function TrackingFreshnessBadge({ status }: { status: TrackingFreshnessStatus }) {
  const variant = status === TRACKING_FRESHNESS_STATUSES.STALE ? "destructive" : "outline";
  return <Badge variant={variant}>{t(`freshnessState.${status}`)}</Badge>;
}

export function TrackingTrustBadge({ status }: { status: TrackingTrustStatus }) {
  const variant = status === TRACKING_TRUST_STATUSES.TRUSTED
    ? "secondary"
    : status === TRACKING_TRUST_STATUSES.STALE || status === TRACKING_TRUST_STATUSES.BLOCKED
      ? "destructive"
      : "outline";
  return <Badge variant={variant}>{t(`trustState.${status}`)}</Badge>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}
