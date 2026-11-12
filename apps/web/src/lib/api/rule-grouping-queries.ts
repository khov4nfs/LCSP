"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ruleGroupingProposalSchema,
  ruleCatalogLedgerSchema,
  type SubmitRuleCatalogGroups,
  pendingRuleGroupingSchema,
} from "@lcsp/contracts/assessment-domain";
import { apiValidated, apiRequest } from "./api-request";
import { COMPLIANCE_RULE_SET_ERROR_CODES } from "@lcsp/contracts/compliance-rule-set";

/**
 * Business purpose: Find versions requiring administrative grouping work.
 * Business rules:
 * - The API returns only Admin-authorized active Development-only candidates; the list grants no approval.
 * Execution flow:
 * 1. Subscribe to the validated pending-version query.
 * Failure cases:
 * - Missing authorization and invalid upstream data remain query errors.
 * Side effects:
 * - Reads operational readiness without changing membership.
 */
export function usePendingRuleGroupings() {
  return useQuery({
    queryKey: ["admin-rule-grouping", "pending"],
    /**
     * Business purpose: Fetch the Admin grouping work queue.
     * Business rules:
     * - Require the shared pending-version response schema.
     * Execution flow:
     * 1. GET the authenticated BFF queue endpoint.
     * Failure cases:
     * - Transport, authorization and schema errors reject without inferred readiness.
     * Side effects:
     * - Performs one scoped Admin read.
     */
    queryFn: () =>
      apiValidated(
        "/api/admin/compliance-rule-sets/groups/pending",
        pendingRuleGroupingSchema,
      ),
  });
}

/**
 * Business purpose: Coordinate the Admin proposal, exact membership submission and independent approval.
 * Business rules:
 * - Version identity partitions caches; backend authorization and two-person review remain authoritative.
 * Execution flow:
 * 1. Load proposal/ledger, register mutations and invalidate this version after acknowledged writes.
 * Failure cases:
 * - Invalid API responses, stale pins and authorization failures remain query or mutation errors.
 * Side effects:
 * - Registers authenticated BFF reads and explicit review mutations.
 */
export function useRuleGrouping(id: string) {
  const client = useQueryClient();
  const root = `/api/admin/compliance-rule-sets/${encodeURIComponent(id)}/groups`;
  const proposal = useQuery({
    queryKey: ["admin-rule-grouping", id, "proposal"],
    /**
     * Business purpose: Read the canonical review-required grouping proposal.
     * Business rules:
     * - Validate the pinned proposal schema; no approval is inferred from proposal presence.
     * Execution flow:
     * 1. GET the authenticated version-specific proposal endpoint.
     * Failure cases:
     * - Inactive versions, authorization failures and invalid responses reject.
     * Side effects:
     * - Performs one BFF read; historical proposal materialization is server-controlled.
     */
    queryFn: () => apiValidated(`${root}/proposal`, ruleGroupingProposalSchema),
  });
  const ledger = useQuery({
    queryKey: ["admin-rule-grouping", id, "ledger"],
    /**
     * Business purpose: Read submitted memberships and their exact approval digest.
     * Business rules:
     * - Validate the public ledger contract and retain server-owned review state.
     * Execution flow:
     * 1. GET the version's authenticated membership ledger.
     * Failure cases:
     * - Authorization and response validation failures remain query errors.
     * Side effects:
     * - Reads memberships without changing their approval state.
     */
    queryFn: () => apiValidated(root, ruleCatalogLedgerSchema),
  });
  const submit = useMutation({
    /**
     * Business purpose: Submit the administrator's complete version-pinned membership snapshot.
     * Business rules:
     * - Send exact rule versions, provenance and rationales; backend completeness and scope gates remain mandatory.
     * Execution flow:
     * 1. POST the reviewed snapshot and validate the resulting ledger.
     * Failure cases:
     * - Stale pins, incomplete membership and forbidden changes remain mutation errors.
     * Side effects:
     * - Requests persistence of draft membership, never automatic approval.
     */
    mutationFn: (body: SubmitRuleCatalogGroups) =>
      apiValidated(root, ruleCatalogLedgerSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    /**
     * Business purpose: Refresh proposal and digest after an acknowledged submission.
     * Business rules:
     * - Invalidate the version's grouping prefix and the administrative pending queue.
     * Execution flow:
     * 1. Await invalidation of active grouping reads.
     * Failure cases:
     * - Refresh failures propagate without inventing persisted state.
     * Side effects:
     * - Refetches the server-owned membership ledger.
     */
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["admin-rule-grouping", id] }),
        client.invalidateQueries({ queryKey: ["admin-rule-grouping", "pending"] }),
      ]),
  });
  const approve = useMutation({
    /**
     * Business purpose: Request independent approval of the displayed exact digest.
     * Business rules:
     * - Backend validates reviewer separation, current versions and complete membership.
     * Execution flow:
     * 1. POST digest confirmation using the shared API client and reject unsuccessful envelopes.
     * Failure cases:
     * - Self-approval, stale digest and authorization failures remain mutation errors.
     * Side effects:
     * - Requests one server-authorized approval transaction.
     */
    mutationFn: async (membershipDigest: string) => {
      const response = await apiRequest(`${root}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          membershipDigest,
          confirmsTaxonomyAndMembershipReview: true,
        }),
      });
      if (!response.ok)
        throw new Error(
          response.problemCode ??
            COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        );
    },
    /**
     * Business purpose: Refresh authoritative approval state after acknowledged review.
     * Business rules:
     * - Approval is rendered from refetched server state rather than optimistic local mutation.
     * Execution flow:
     * 1. Invalidate this version's grouping cache prefix.
     * Failure cases:
     * - Refresh failures cannot fabricate customer readiness.
     * Side effects:
     * - Refetches the ledger and review status.
     */
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["admin-rule-grouping", id] }),
        client.invalidateQueries({ queryKey: ["admin-rule-grouping", "pending"] }),
      ]),
  });
  return { proposal, ledger, submit, approve };
}
