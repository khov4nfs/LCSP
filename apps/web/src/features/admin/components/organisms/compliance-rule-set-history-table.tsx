import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleTimestamp } from "@/features/workspace/utils/assessment-runtime-formatter";
import { cn } from "@/lib/utils";
import type { ComplianceRuleSetHistoryTableProps } from "../../types/compliance-rule-sets.types";

const t = (key: string) => resolveAppMessage(key as MessageKey);

const LIFECYCLE_BADGE_CLASSES: Record<string, string> = {
  [ARTIFACT_LIFECYCLE_STATES.ACTIVE]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [ARTIFACT_LIFECYCLE_STATES.SUPERSEDED]:
    "border-border bg-muted text-muted-foreground",
  [ARTIFACT_LIFECYCLE_STATES.BUILDING]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [ARTIFACT_LIFECYCLE_STATES.INVALID]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
};

/**
 * Business purpose: Render every prepared compliance rule set version with lifecycle provenance and direct result inspection links.
 * Business rules:
 * - Preserves ACTIVE and SUPERSEDED rows newest-first along with their source version and requirement/rule counts.
 * - Maps lifecycle states to semantic status tokens without altering server-provided status strings.
 * Execution flow:
 * 1. Render empty message when ruleSets is empty.
 * 2. Otherwise render the structured Table aligned to LCSP Data / Management row / 52 (1684:2619).
 * Failure cases:
 * - Unactivated rule sets display em-dash for activatedAt.
 * Side effects:
 * - Pure presentational component.
 */
export function ComplianceRuleSetHistoryTable({
  ruleSets,
}: ComplianceRuleSetHistoryTableProps) {
  if (ruleSets.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("pages.complianceRuleSets.emptyHistory")}
      </p>
    );
  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card"
      data-component="ComplianceRuleSetHistoryTable"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("pages.complianceRuleSets.version")}</TableHead>
            <TableHead>{t("pages.complianceRuleSets.sourceVersion")}</TableHead>
            <TableHead>{t("pages.complianceRuleSets.state")}</TableHead>
            <TableHead className="text-right">
              {t("pages.complianceRuleSets.requirements")}
            </TableHead>
            <TableHead className="text-right">
              {t("pages.complianceRuleSets.assessmentRules")}
            </TableHead>
            <TableHead>{t("pages.complianceRuleSets.activatedAt")}</TableHead>
            <TableHead>{t("pages.complianceRuleSets.viewResult")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ruleSets.map((ruleSet) => (
            <TableRow
              key={ruleSet.ruleSetVersionId}
              data-rule-set-state={ruleSet.lifecycleState}
            >
              <TableCell className="font-medium">{ruleSet.version}</TableCell>
              <TableCell>{ruleSet.legalSourceVersion}</TableCell>
              <TableCell>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    LIFECYCLE_BADGE_CLASSES[ruleSet.lifecycleState] ??
                      "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {t(`pages.complianceRuleSets.states.${ruleSet.lifecycleState}`)}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {ruleSet.legalRequirementCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {ruleSet.assessmentRuleCount}
              </TableCell>
              <TableCell>
                {ruleSet.activatedAt
                  ? formatLocaleTimestamp(ruleSet.activatedAt)
                  : "—"}
              </TableCell>
              <TableCell>
                <Link
                  className="text-sm font-medium text-primary underline underline-offset-4"
                  href={`/admin/compliance-rule-sets/${ruleSet.ruleSetVersionId}`}
                >
                  {t("pages.complianceRuleSets.viewResult")}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
