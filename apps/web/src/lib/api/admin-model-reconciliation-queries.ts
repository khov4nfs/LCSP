"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BILLING_ERROR_CODES,
  billingReconciliationCaseDetailResponseSchema,
  reconciliationCaseDecisionResponseSchema,
  compensateBillingDebitResponseSchema,
  type CompensateBillingDebitRequest,
  type ReconciliationCaseDecisionRequest,
  type BillingReconciliationCaseDetailResponse,
} from "@lcsp/contracts/billing";
import { adminModelReconciliationListSchema } from "@/features/admin/schemas/admin-model-reconciliation.schema";
import { apiRequest } from "./api-request";
import { apiQueryKeys } from "./query-keys";

/**
 * Business purpose: Subscribe to the Admin's read-only model invocation reconciliation queue.
 * Business rules:
 * - Only contract-validated case rows may be displayed; each page is cached separately.
 * Execution flow:
 * 1. Query the BFF with a positive page number.
 * 2. Reject error envelopes and parse the complete paginated payload.
 * Failure cases:
 * - Invalid responses or BFF failures surface as errors, never synthetic empty queues.
 * Side effects:
 * - One read-only BFF request per cache miss or refresh.
 */
export function useAdminModelReconciliationCasesQuery(page: number) {
  return useQuery({
    queryKey: apiQueryKeys.admin.modelReconciliationCases({ page }),
    /**
     * Business purpose: Fetch a validated Admin case queue for one page.
     * Business rules:
     * - Never substitute a failed billing response with an empty operational queue.
     * Execution flow:
     * 1. Read the BFF through apiRequest and parse its complete pagination contract.
     * Failure cases:
     * - Error envelopes or malformed case rows throw and surface to the page.
     * Side effects:
     * - One read-only BFF request.
     */
    queryFn: async () => {
      // Why: An unreadable queue is operationally different from an empty queue.
      // How: Parse the response after the shared API envelope helper succeeds.
      // Invariant: No fallback case data is manufactured for live billing state.
      const response = await apiRequest(
        `/api/admin/billing/reconciliation/cases?page=${page}`,
      );
      if (!response.ok) {
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      }
      return adminModelReconciliationListSchema.parse(response.payload);
    },
  });
}

/**
 * Business purpose: Record one Admin reconciliation decision and refresh the affected case evidence.
 * Business rules:
 * - The API enforces the financial action permission and independently validates provider evidence.
 * Execution flow:
 * 1. POST the strict decision. 2. Validate response. 3. Invalidate queue and detail caches.
 * Failure cases:
 * - Problem or invalid success responses reject without changing client-side case status.
 * Side effects:
 * - One billing mutation and cache invalidation after server success.
 */
export function useAdminModelReconciliationDecisionMutation(
  caseId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit a selected case decision with its stable idempotency key.
     * Business rules:
     * - Only the selected case ID may be used; upstream authority validates the final decision.
     * Execution flow:
     * 1. Send the payload to the BFF. 2. Parse the canonical decision response.
     * Failure cases:
     * - Missing selection, problem envelopes or malformed data reject the mutation.
     * Side effects:
     * - Performs one authenticated browser POST; no optimistic wallet state is written.
     */
    mutationFn: async (payload: ReconciliationCaseDecisionRequest) => {
      if (!caseId) throw new Error(BILLING_ERROR_CODES.validationFailed);
      // Why: A decision must retain the same idempotency payload through retries.
      // How: The caller supplies the form's stable key and the shared API helper sends the canonical envelope.
      // Invariant: Client cache changes only after a server-confirmed decision.
      const response = await apiRequest(
        `/api/admin/billing/reconciliation/cases/${encodeURIComponent(caseId)}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok)
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      return reconciliationCaseDecisionResponseSchema.parse(response.payload);
    },
    /**
     * Business purpose: Refresh case evidence after a confirmed Admin decision.
     * Business rules:
     * - Cache invalidation runs only after a validated success response.
     * Execution flow:
     * 1. Invalidate selected detail. 2. Invalidate queue pages.
     * Failure cases:
     * - Query refetch errors remain visible in their normal query state.
     * Side effects:
     * - Invalidates TanStack Query cache; no further billing mutation occurs.
     */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.admin.modelReconciliationCase(caseId ?? ""),
        }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "billing", "model-reconciliation", "cases"],
        }),
      ]);
    },
  });
}

/**
 * Business purpose: Submit a bounded correction of an original model-usage debit.
 * Business rules:
 * - The server rechecks the original debit and remaining amount under its transaction lock.
 * Execution flow:
 * 1. Send the canonical request to the BFF. 2. Parse the response. 3. Refresh the case detail.
 * Failure cases:
 * - A problem or malformed response rejects without optimistic wallet changes.
 * Side effects:
 * - One protected billing mutation and detail cache invalidation on success.
 */
export function useAdminModelReconciliationCompensationMutation(
  caseId: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request an audited credit adjustment tied to the displayed debit.
     * Business rules:
     * - The browser sends the entered integer amount and stable idempotency key; it does not compute wallet balance.
     * Execution flow:
     * 1. POST via shared API helper. 2. Validate the compensation response contract.
     * Failure cases:
     * - Upstream denial or malformed response rejects the mutation.
     * Side effects:
     * - May initiate one ledger correction through the protected BFF.
     */
    mutationFn: async (payload: CompensateBillingDebitRequest) => {
      // Why: A compensation result must come from the server transaction, never an optimistic estimate.
      // How: The BFF accepts only the shared request contract and returns a validated result envelope.
      // Invariant: The client does not alter cached wallet balances before acknowledgement.
      const response = await apiRequest("/api/admin/billing/compensate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      return compensateBillingDebitResponseSchema.parse(response.payload);
    },
    /**
     * Business purpose: Refresh the case's remaining compensable amount after a confirmed correction.
     * Business rules:
     * - Only a valid server success permits preview refresh.
     * Execution flow:
     * 1. Invalidate the selected case detail and queue caches.
     * Failure cases:
     * - Refetch errors remain visible through the usual query state.
     * Side effects:
     * - Invalidates local cache, without issuing another compensation.
     */
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.admin.modelReconciliationCase(caseId ?? ""),
        }),
        queryClient.invalidateQueries({
          queryKey: ["admin", "billing", "model-reconciliation", "cases"],
        }),
      ]);
    },
  });
}

/**
 * Business purpose: Fetch the authoritative admission and evidence linkage of one selected case.
 * Business rules:
 * - Detail is requested only after an Admin selects a case; queue projections do not substitute for evidence.
 * Execution flow:
 * 1. Enable the detail query for a selected case ID.
 * 2. Read its BFF route and validate against the shared detail schema.
 * Failure cases:
 * - Missing, unauthorized or malformed case responses surface as errors.
 * Side effects:
 * - One read-only BFF request; no case decision or wallet mutation.
 */
export function useAdminModelReconciliationCaseQuery(caseId: string | null) {
  return useQuery<BillingReconciliationCaseDetailResponse>({
    queryKey: apiQueryKeys.admin.modelReconciliationCase(caseId ?? ""),
    enabled: caseId !== null,
    /**
     * Business purpose: Load one case's authoritative evidence linkage.
     * Business rules:
     * - Never infer provider evidence from the smaller queue row.
     * Execution flow:
     * 1. Read the selected BFF detail route and parse its shared billing contract.
     * Failure cases:
     * - Missing, unauthorized or malformed detail throws to the inspection UI.
     * Side effects:
     * - One read-only BFF request.
     */
    queryFn: async () => {
      const response = await apiRequest(
        `/api/admin/billing/reconciliation/cases/${encodeURIComponent(caseId ?? "")}`,
      );
      if (!response.ok) {
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      }
      return billingReconciliationCaseDetailResponseSchema.parse(
        response.payload,
      );
    },
  });
}
