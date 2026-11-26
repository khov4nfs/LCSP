import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { EvidenceCard } from "./evidence-inspector";

export const RULE_RESULT_VARIANTS = {
  prior: "prior",
  current: "current",
} as const;

export type RuleResultVariant =
  (typeof RULE_RESULT_VARIANTS)[keyof typeof RULE_RESULT_VARIANTS];

/**
 * Business purpose: Render a unified rule result card used for both prior and current results during selected-rule re-evaluation comparison.
 * Business rules:
 * - Uses the exact same card layout for both `prior` and `current` variants so comparisons remain consistent and unbiased.
 * - Preserves distinct missing-evidence styling via `EvidenceCard`.
 * Execution flow:
 * 1. Render `Previous result` or `Current result` header label and status badge.
 * 2. Render rule title, rationale, and `EvidenceCard` count.
 * Failure cases:
 * - Missing rationale omits the rationale paragraph cleanly.
 * Side effects:
 * - Pure presentational component.
 */
export function RuleResultCard({
  variant,
  title,
  statusLabel,
  outcomeTone = "info",
  rationale,
  evidenceCount,
  hasEvidenceGap = false,
  className,
}: {
  variant: RuleResultVariant;
  title: string;
  statusLabel: string;
  outcomeTone?: "success" | "danger" | "warning" | "info";
  rationale?: string | null;
  evidenceCount: number;
  hasEvidenceGap?: boolean;
  className?: string;
}) {
  const variantLabel = resolveAppMessage(
    variant === RULE_RESULT_VARIANTS.prior
      ? "pages.assessmentWorkspace.selectedAudit.priorResult"
      : "pages.assessmentWorkspace.selectedAudit.currentResult",
  );

  const badgeClass =
    outcomeTone === "success"
      ? "border-status-success-border bg-status-success-bg text-status-success"
      : outcomeTone === "danger"
        ? "border-status-danger-border bg-status-danger-bg text-status-danger"
        : outcomeTone === "warning"
          ? "border-status-warning-border bg-status-warning-bg text-status-warning"
          : "border-status-info-border bg-status-info-bg text-status-info";

  return (
    <article
      className={cn(
        "flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-xs",
        variant === RULE_RESULT_VARIANTS.current
          ? "border-brand/40 bg-card"
          : "border-border bg-muted/30",
        className,
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {variantLabel}
          </span>
          <Badge variant="outline" className={badgeClass}>
            {statusLabel}
          </Badge>
        </div>

        <h4 className="text-sm font-semibold text-foreground">{title}</h4>

        {rationale ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {rationale}
          </p>
        ) : null}
      </div>

      <EvidenceCard
        evidenceCount={evidenceCount}
        hasEvidenceGap={hasEvidenceGap}
      />
    </article>
  );
}
