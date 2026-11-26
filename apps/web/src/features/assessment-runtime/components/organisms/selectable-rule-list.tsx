import { RULE_AUDIT_PROGRESS_STATES } from "@lcsp/contracts/assessment-domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { copy } from "../../utils/conversation-copy";
import { EvidenceCard } from "../molecules/evidence-inspector";

export interface SelectableRuleItem {
  assessmentRuleId: string;
  concept: string;
  legalReference: string;
  progress: string;
  evidenceCount: number;
  decisionId?: string | null;
}

/**
 * Business purpose: Render the `Rule selection table` using Figma `LCSP Data / Selectable rule row` (`1692:4819`) for independent rule selection and prior-result visibility.
 * Business rules:
 * - Already-ready rules display their current status and allow direct `View result` inspection.
 * - Selection never auto-selects rules; only explicit checkbox toggles mutate `selectedIds`.
 * Execution flow:
 * 1. Render table headers (`Select · Legal obligation`, `Legal reference`, `Previous result`, `Evidence`).
 * 2. Render each rule row with checkbox, title, legal reference, status badge, and `EvidenceCard` count.
 * Failure cases:
 * - Empty `rules` renders a clean empty row message.
 * Side effects:
 * - Invokes `onToggleRule(assessmentRuleId)` or `onViewResult(decisionId)`.
 */
export function SelectableRuleList({
  rules,
  selectedIds,
  onToggleRule,
  onViewResult,
}: {
  rules: readonly SelectableRuleItem[];
  selectedIds: readonly string[];
  onToggleRule: (assessmentRuleId: string) => void;
  onViewResult?: (decisionId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-accent/60 text-xs font-semibold text-muted-foreground">
              <th className="px-4 py-2.5">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.colRule",
                )}
              </th>
              <th className="px-4 py-2.5">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.colReference",
                )}
              </th>
              <th className="px-4 py-2.5">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.colPreviousResult",
                )}
              </th>
              <th className="px-4 py-2.5">
                {resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.colEvidence",
                )}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rules.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center text-sm text-muted-foreground"
                >
                  {resolveAppMessage(
                    "pages.assessmentWorkspace.findings.emptyBody",
                  )}
                </td>
              </tr>
            ) : (
              rules.map((rule) => {
                const selected = selectedIds.includes(rule.assessmentRuleId);
                const isReady =
                  rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY;
                const isFailed =
                  rule.progress === RULE_AUDIT_PROGRESS_STATES.FAILED ||
                  rule.progress === RULE_AUDIT_PROGRESS_STATES.INTERRUPTED;
                const isWaiting =
                  rule.progress ===
                  RULE_AUDIT_PROGRESS_STATES.WAITING_FOR_CUSTOMER;

                return (
                  <tr
                    key={rule.assessmentRuleId}
                    data-selected={selected ? "true" : "false"}
                    className={cn(
                      "transition-colors hover:bg-muted/35",
                      selected && "bg-brand-mint/35",
                    )}
                  >
                    <td className="px-4 py-3">
                      <label className="flex cursor-pointer items-center gap-3 font-medium text-foreground">
                        <Checkbox
                          aria-label={`${rule.concept} (${rule.assessmentRuleId})`}
                          checked={selected}
                          disabled={isReady}
                          onCheckedChange={() =>
                            onToggleRule(rule.assessmentRuleId)
                          }
                        />
                        <span className="truncate">{rule.concept}</span>
                      </label>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="truncate">{rule.legalReference}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            isReady
                              ? "border-status-success-border bg-status-success-bg text-status-success"
                              : isFailed
                                ? "border-status-danger-border bg-status-danger-bg text-status-danger"
                                : isWaiting
                                  ? "border-status-warning-border bg-status-warning-bg text-status-warning"
                                  : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {copy(`ruleAudit.progress.${rule.progress}`)}
                        </Badge>
                        {isReady && rule.decisionId && onViewResult ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewResult(rule.decisionId!)}
                            className="h-auto px-2 py-0.5 text-xs text-brand-deep"
                          >
                            {copy("ruleAudit.viewResult")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <EvidenceCard
                        evidenceCount={rule.evidenceCount}
                        hasEvidenceGap={rule.evidenceCount === 0}
                        className="w-fit py-1"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
