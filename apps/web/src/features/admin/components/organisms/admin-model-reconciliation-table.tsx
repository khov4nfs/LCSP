"use client";

import type { BillingReconciliationCaseItem } from "@lcsp/contracts/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { resolveAppMessage } from "@/lib/i18n";
import { MODEL_RECONCILIATION_STATE_LABEL_KEYS } from "../../config/admin-model-reconciliation.config";

type Props = {
  cases: readonly BillingReconciliationCaseItem[];
  onInspect: (caseId: string) => void;
};

/**
 * Business purpose: Display the Admin queue of model invocation cases without altering their state.
 * Business rules:
 * - Each row presents the server's retained exposure and provider identity; unknown states get a neutral label.
 * Execution flow:
 * 1. Render a localized empty state or a semantic table of cases.
 * 2. Let the Admin select a case for a separate authoritative detail request.
 * Failure cases:
 * - Empty or unknown-state data never implies a resolved financial exposure.
 * Side effects:
 * - Read-only rendering and selection callback; no billing mutation.
 */
export function AdminModelReconciliationTable({ cases, onInspect }: Props) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardContent className="pt-6">
        {cases.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="model-reconciliation-empty">
            {resolveAppMessage("pages.admin.modelReconciliation.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table data-testid="model-reconciliation-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.caseId")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.state")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.provider")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.invocationId")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.exposure")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.createdAt")}</TableHead>
                  <TableHead>{resolveAppMessage("pages.admin.modelReconciliation.columns.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((item) => (
                  <TableRow key={item.caseId}>
                    <TableCell className="font-mono text-xs">{item.caseId}</TableCell>
                    <TableCell>{resolveAppMessage(MODEL_RECONCILIATION_STATE_LABEL_KEYS[item.state] ?? "pages.admin.modelReconciliation.none")}</TableCell>
                    <TableCell>{item.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{item.invocationId}</TableCell>
                    <TableCell className="font-mono tabular-nums">{item.admission.maximumExposureMicrocredits}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{item.createdAt}</TableCell>
                    <TableCell>
                      <Button type="button" variant="outline" size="sm" onClick={() => onInspect(item.caseId)} aria-label={`${resolveAppMessage("pages.admin.modelReconciliation.inspect")}: ${item.caseId}`}>
                        {resolveAppMessage("pages.admin.modelReconciliation.inspect")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
