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
import type { ComplianceRuleSetHistoryTableProps } from "../../types/compliance-rule-sets.types";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/** Every prepared version, newest first; ACTIVE and SUPERSEDED rows keep their provenance. */
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
              {t(`pages.complianceRuleSets.states.${ruleSet.lifecycleState}`)}
            </TableCell>
            <TableCell className="text-right">
              {ruleSet.legalRequirementCount}
            </TableCell>
            <TableCell className="text-right">
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
  );
}
