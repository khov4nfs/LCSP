"use client";

import {
  RECONCILIATION_CASE_STATES,
  type BillingReconciliationCaseDetailResponse,
  type ReconciliationCaseDecisionRequest,
  type CompensateBillingDebitRequest,
} from "@lcsp/contracts/billing";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";
import { AdminDetailRow } from "../atoms/admin-detail-row";
import { MODEL_RECONCILIATION_STATE_LABEL_KEYS } from "../../config/admin-model-reconciliation.config";
import { AdminModelReconciliationDecisionForm } from "./admin-model-reconciliation-decision-form";
import { AdminModelReconciliationCompensationForm } from "./admin-model-reconciliation-compensation-form";

type Props = {
  caseId: string | null;
  detail: BillingReconciliationCaseDetailResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
  onDecide: (payload: ReconciliationCaseDecisionRequest) => Promise<void>;
  isDeciding: boolean;
  decisionError: boolean;
  decisionSuccess: boolean;
  onCompensate: (payload: CompensateBillingDebitRequest) => Promise<void>;
  isCompensating: boolean;
  compensationError: boolean;
  compensationSuccess: boolean;
};

/**
 * Business purpose: Let an Admin inspect authoritative case identity, exposure and provider evidence.
 * Business rules:
 * - A selected case is never shown as confirmed no usage without its own detail response.
 * - A decision requires an explicit audited form; compensation is outside this case detail without debit authority.
 * Execution flow:
 * 1. Open a dialog for the selected case and show loading or error state until detail arrives.
 * 2. Render server-provided admission and evidence fields with localized labels.
 * Failure cases:
 * - Detail errors display an explicit failure, never queue metadata as a substitute.
 * Side effects:
 * - Submits an Admin decision through the parent mutation; no direct wallet writes.
 */
export function AdminModelReconciliationDetailDialog({
  caseId,
  detail,
  isLoading,
  isError,
  onClose,
  onDecide,
  isDeciding,
  decisionError,
  decisionSuccess,
  onCompensate,
  isCompensating,
  compensationError,
  compensationSuccess,
}: Props) {
  const none = resolveAppMessage("pages.admin.modelReconciliation.none");
  return (
    <Dialog open={caseId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-dvh max-w-2xl overflow-y-auto"
        closeLabel={resolveAppMessage("pages.admin.modelReconciliation.close")}
      >
        <DialogHeader>
          <DialogTitle>
            {resolveAppMessage("pages.admin.modelReconciliation.detailTitle")}
          </DialogTitle>
          <DialogDescription>
            {resolveAppMessage(
              "pages.admin.modelReconciliation.detailDescription",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <p role="status">
              {resolveAppMessage(
                "pages.admin.modelReconciliation.detailLoading",
              )}
            </p>
          ) : null}
          {isError ? (
            <p role="alert">
              {resolveAppMessage("pages.admin.modelReconciliation.detailError")}
            </p>
          ) : null}
          {detail && !isError ? (
            <div data-testid="model-reconciliation-detail">
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.columns.caseId",
                )}
                value={<span className="font-mono">{detail.caseId}</span>}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.columns.state",
                )}
                value={resolveAppMessage(
                  MODEL_RECONCILIATION_STATE_LABEL_KEYS[detail.state] ??
                    "pages.admin.modelReconciliation.none",
                )}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.correlationId",
                )}
                value={
                  <span className="font-mono">
                    {detail.providerCorrelationId}
                  </span>
                }
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.admissionId",
                )}
                value={<span className="font-mono">{detail.admissionId}</span>}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.walletId",
                )}
                value={detail.admission.walletId ?? none}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.userId",
                )}
                value={detail.admission.userId ?? none}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.model",
                )}
                value={detail.admission.resolvedModel}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.debitMode",
                )}
                value={detail.admission.debitMode}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.columns.exposure",
                )}
                value={
                  <span className="font-mono">
                    {detail.admission.maximumExposureMicrocredits}
                  </span>
                }
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.coverage",
                )}
                value={
                  detail.coverageStart && detail.coverageEnd
                    ? `${detail.coverageStart} – ${detail.coverageEnd}`
                    : none
                }
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.artifactId",
                )}
                value={detail.evidenceArtifact?.artifactId ?? none}
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.artifactVerified",
                )}
                value={
                  detail.evidenceArtifact
                    ? resolveAppMessage(
                        detail.evidenceArtifact.verified
                          ? "pages.admin.modelReconciliation.verified"
                          : "pages.admin.modelReconciliation.unverified",
                      )
                    : none
                }
              />
              <AdminDetailRow
                label={resolveAppMessage(
                  "pages.admin.modelReconciliation.fields.auditRationale",
                )}
                value={detail.auditRationale ?? none}
              />
              {detail.state === RECONCILIATION_CASE_STATES.OPEN ||
              detail.state === RECONCILIATION_CASE_STATES.EVIDENCE_PENDING ||
              detail.state === RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW ? (
                <AdminModelReconciliationDecisionForm
                  detail={detail}
                  onSubmit={onDecide}
                  isSubmitting={isDeciding}
                />
              ) : null}
              {decisionError ? (
                <p role="alert">
                  {resolveAppMessage(
                    "pages.admin.modelReconciliation.decision.error",
                  )}
                </p>
              ) : null}
              {decisionSuccess ? (
                <p role="status">
                  {resolveAppMessage(
                    "pages.admin.modelReconciliation.decision.success",
                  )}
                </p>
              ) : null}
              {detail.compensationPreview &&
              BigInt(
                detail.compensationPreview.remainingUncompensatedMicrocredits,
              ) > BigInt(0) ? (
                <AdminModelReconciliationCompensationForm
                  preview={detail.compensationPreview}
                  onSubmit={onCompensate}
                  isSubmitting={isCompensating}
                />
              ) : null}
              {compensationError ? (
                <p role="alert">
                  {resolveAppMessage(
                    "pages.admin.modelReconciliation.compensation.error",
                  )}
                </p>
              ) : null}
              {compensationSuccess ? (
                <p role="status">
                  {resolveAppMessage(
                    "pages.admin.modelReconciliation.compensation.success",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
