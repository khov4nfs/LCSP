"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useAdminModelReconciliationCaseQuery,
  useAdminModelReconciliationCasesQuery,
  useAdminModelReconciliationDecisionMutation,
  useAdminModelReconciliationCompensationMutation,
} from "@/lib/api/admin-model-reconciliation-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { AdminPagination } from "../molecules/admin-pagination";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { AdminModelReconciliationDetailDialog } from "../molecules/admin-model-reconciliation-detail-dialog";
import { AdminModelReconciliationTable } from "./admin-model-reconciliation-table";

/**
 * Business purpose: Provide an Admin investigation and audited decision workspace for model billing cases.
 * Business rules:
 * - Queue and detail data must arrive through their separate validated BFF reads.
 * - Errors remain visible; no empty fixture is synthesized from an unavailable billing service.
 * Execution flow:
 * 1. Load one page of cases and render its loading, error, empty or table state.
 * 2. Fetch case detail only after selection and show its authoritative evidence in a dialog.
 * 3. Submit an explicit decision through the protected BFF, then refresh queue and detail.
 * Failure cases:
 * - Queue or detail failures display explicit errors and do not imply a resolved case.
 * Side effects:
 * - Reads cases and may submit a server-audited decision; no direct wallet mutation.
 */
export function AdminModelReconciliationPage() {
  const [page, setPage] = useState(1);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const queue = useAdminModelReconciliationCasesQuery(page);
  const detail = useAdminModelReconciliationCaseQuery(selectedCaseId);
  const decision = useAdminModelReconciliationDecisionMutation(selectedCaseId);
  const compensation =
    useAdminModelReconciliationCompensationMutation(selectedCaseId);
  const totalPages = queue.data
    ? Math.max(1, Math.ceil(queue.data.total / queue.data.pageSize))
    : 1;

  /**
   * Business purpose: Open a case with decision feedback scoped to that case.
   * Business rules:
   * - A prior case's success or failure must not appear in the newly selected case.
   * Execution flow:
   * 1. Clear the previous mutation state. 2. Select the requested case.
   * Failure cases:
   * - An unavailable case is reported by the detail query without reusing prior feedback.
   * Side effects:
   * - Resets local mutation state and starts a case detail query.
   */
  function selectCase(caseId: string | null) {
    // Why: A stale success message could imply another case was resolved.
    // How: Reset TanStack mutation feedback whenever the selected case changes.
    // Invariant: Decision authority and result remain scoped to the currently visible case.
    decision.reset();
    compensation.reset();
    setSelectedCaseId(caseId);
  }

  return (
    <div className="space-y-6" data-testid="admin-model-reconciliation-page">
      <AdminPageHeader
        title={resolveAppMessage("pages.admin.modelReconciliation.title")}
        description={resolveAppMessage(
          "pages.admin.modelReconciliation.description",
        )}
        actionSlot={
          <Button
            type="button"
            variant="outline"
            onClick={() => void queue.refetch()}
          >
            {resolveAppMessage("pages.admin.modelReconciliation.refresh")}
          </Button>
        }
      />
      <Badge variant="secondary">
        {resolveAppMessage("pages.admin.modelReconciliation.readOnly")}
      </Badge>
      {queue.isLoading ? (
        <p role="status" data-testid="model-reconciliation-loading">
          {resolveAppMessage("pages.admin.modelReconciliation.loading")}
        </p>
      ) : null}
      {queue.isError ? (
        <Alert variant="destructive" data-testid="model-reconciliation-error">
          <AlertTitle>
            {resolveAppMessage("pages.admin.modelReconciliation.errorTitle")}
          </AlertTitle>
          <AlertDescription>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.errorDescription",
            )}
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            onClick={() => void queue.refetch()}
          >
            {resolveAppMessage("pages.admin.modelReconciliation.retry")}
          </Button>
        </Alert>
      ) : null}
      {queue.data && !queue.isError ? (
        <>
          <AdminModelReconciliationTable
            cases={queue.data.items}
            onInspect={selectCase}
          />
          <AdminPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            disabled={queue.isFetching}
          />
        </>
      ) : null}
      <AdminModelReconciliationDetailDialog
        caseId={selectedCaseId}
        detail={detail.data}
        isLoading={detail.isLoading}
        isError={detail.isError}
        onClose={() => selectCase(null)}
        onDecide={async (payload) => {
          await decision.mutateAsync(payload);
        }}
        isDeciding={decision.isPending}
        decisionError={decision.isError}
        decisionSuccess={decision.isSuccess}
        onCompensate={async (payload) => {
          await compensation.mutateAsync(payload);
        }}
        isCompensating={compensation.isPending}
        compensationError={compensation.isError}
        compensationSuccess={compensation.isSuccess}
      />
    </div>
  );
}
