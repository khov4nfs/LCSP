"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SELECTED_SCOPE_AUTHORIZATION_STATES } from "@lcsp/contracts/legal-rule-catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useApproveScopeAuthorization,
  useRevokeScopeAuthorization,
  useScopeAuthorization,
} from "@/lib/api/legal-rule-catalog-queries";
import {
  scopeAuthorizationFormSchema,
  type ScopeAuthorizationFormValues,
} from "../../schemas/scope-authorization-form.schema";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

/**
 * Business purpose: Provide Admin reviewers a UI dialog to inspect, independently approve, or revoke a source-backed semantic scope authorization.
 * Business rules:
 * - Only DRAFT candidates can be approved (with explicit confirmation); only APPROVED candidates can be revoked (with reason and confirmation).
 * - All copy is resolved from @lcsp/i18n.
 * Execution flow:
 * 1. Accept a 64-hex scopeKey to load the persisted candidate and source citations.
 * 2. Dispatch independent approval or revocation via the BFF-backed TanStack Query mutations.
 * Failure cases:
 * - Self-approval, stale revisions, or network errors display the canonical error alert.
 * Side effects:
 * - Mutates SelectedRuleScopeAuthorization state on the API when confirmed.
 */
export function SelectedScopeAuthorizationDialog({
  open,
  onOpenChange,
  catalogId,
  catalogRevision,
  ruleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogId: string;
  catalogRevision: number;
  ruleId: string;
}) {
  const [activeKey, setActiveKey] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const form = useForm<ScopeAuthorizationFormValues>({
    resolver: zodResolver(scopeAuthorizationFormSchema),
    defaultValues: {
      scopeKey: "",
      confirmsLegalReview: false,
      revokeReason: "",
      confirmsRevocation: false,
    },
  });
  const scopeKeyInput = useWatch({ control: form.control, name: "scopeKey" });
  const confirmsLegalReview = useWatch({
    control: form.control,
    name: "confirmsLegalReview",
  });
  const revokeReason = useWatch({
    control: form.control,
    name: "revokeReason",
  });
  const confirmsRevocation = useWatch({
    control: form.control,
    name: "confirmsRevocation",
  });

  const detail = useScopeAuthorization(catalogId, activeKey);
  const approve = useApproveScopeAuthorization(catalogId);
  const revoke = useRevokeScopeAuthorization(catalogId);

  /**
   * Business purpose: Load the candidate matching the entered 64-hex scope key.
   * Business rules: Only valid 64-hex keys trigger a query.
   * Execution flow: 1. Validate the key format. 2. Set activeKey to trigger useScopeAuthorization.
   * Failure cases: Invalid keys are ignored.
   * Side effects: Updates local dialog state.
   */
  function handleLoadCandidate() {
    setStatusMessage(null);
    const trimmed = (scopeKeyInput ?? "").trim();
    if (/^[a-f0-9]{64}$/.test(trimmed)) {
      setActiveKey(trimmed);
    }
  }

  /**
   * Business purpose: Independently approve a loaded DRAFT semantic authorization candidate.
   * Business rules: Requires confirmsLegalReview and loaded DRAFT data.
   * Execution flow: 1. Call approve mutation with catalog/review revisions and decisionDigest.
   * Failure cases: Self-approval or stale revision sets mutation error state.
   * Side effects: Persists APPROVED state and refreshes detail.
   */
  async function handleApprove() {
    if (!detail.data || !confirmsLegalReview) return;
    setStatusMessage(null);
    await approve.mutateAsync({
      ruleId: detail.data.ruleId || ruleId,
      expectedCatalogRevision: catalogRevision,
      scopeKey: detail.data.scopeKey,
      expectedReviewRevision: detail.data.revision,
      decisionDigest: detail.data.decisionDigest,
      confirmsLegalReview: true,
    });
    setStatusMessage(t("scopeAuthSuccess"));
    void detail.refetch();
  }

  /**
   * Business purpose: Revoke a loaded APPROVED semantic authorization so it cannot authorize new publications.
   * Business rules: Requires non-blank revokeReason and confirmsRevocation.
   * Execution flow: 1. Call revoke mutation with catalog/review revisions and reason.
   * Failure cases: Stale revision or non-APPROVED state sets mutation error state.
   * Side effects: Persists REJECTED state and refreshes detail.
   */
  async function handleRevoke() {
    if (!detail.data || !confirmsRevocation || !revokeReason?.trim()) return;
    setStatusMessage(null);
    await revoke.mutateAsync({
      expectedCatalogRevision: catalogRevision,
      scopeKey: detail.data.scopeKey,
      expectedReviewRevision: detail.data.revision,
      reason: revokeReason.trim(),
      confirmsRevocation: true,
    });
    setStatusMessage(t("scopeAuthSuccess"));
    void detail.refetch();
  }

  const busy = approve.isPending || revoke.isPending || detail.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("scopeAuthTitle")}</DialogTitle>
          <DialogDescription>{t("scopeAuthDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="scope-auth-key">{t("scopeAuthKeyLabel")}</Label>
              <Input
                id="scope-auth-key"
                {...form.register("scopeKey")}
                disabled={busy}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !/^[a-f0-9]{64}$/.test((scopeKeyInput ?? "").trim())}
              onClick={handleLoadCandidate}
            >
              {t("scopeAuthLoad")}
            </Button>
          </div>

          {detail.data ? (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-medium">{t("scopeAuthStateLabel")}:</span>{" "}
                  {detail.data.state}
                </div>
                <div>
                  <span className="font-medium">{t("scopeAuthRevisionLabel")}:</span>{" "}
                  {detail.data.revision}
                </div>
                <div>
                  <span className="font-medium">{t("scopeAuthAuthorLabel")}:</span>{" "}
                  {detail.data.submittedBy}
                </div>
                {detail.data.approvedBy ? (
                  <div>
                    <span className="font-medium">
                      {t("scopeAuthReviewerLabel")}:
                    </span>{" "}
                    {detail.data.approvedBy}
                  </div>
                ) : null}
              </div>

              {detail.data.state === SELECTED_SCOPE_AUTHORIZATION_STATES.DRAFT ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="scope-auth-approve-confirm"
                      checked={confirmsLegalReview}
                      onCheckedChange={(checked) =>
                        form.setValue("confirmsLegalReview", checked === true)
                      }
                      disabled={busy}
                    />
                    <Label htmlFor="scope-auth-approve-confirm">
                      {t("scopeAuthApproveConfirm")}
                    </Label>
                  </div>
                  <Button
                    type="button"
                    disabled={busy || !confirmsLegalReview}
                    onClick={() => void handleApprove()}
                  >
                    {t("scopeAuthApproveAction")}
                  </Button>
                </div>
              ) : null}

              {detail.data.state ===
              SELECTED_SCOPE_AUTHORIZATION_STATES.APPROVED ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-1">
                    <Label htmlFor="scope-auth-revoke-reason">
                      {t("scopeAuthRevokeReasonLabel")}
                    </Label>
                    <Input
                      id="scope-auth-revoke-reason"
                      {...form.register("revokeReason")}
                      disabled={busy}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="scope-auth-revoke-confirm"
                      checked={confirmsRevocation}
                      onCheckedChange={(checked) =>
                        form.setValue("confirmsRevocation", checked === true)
                      }
                      disabled={busy}
                    />
                    <Label htmlFor="scope-auth-revoke-confirm">
                      {t("scopeAuthRevokeConfirm")}
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={
                      busy || !confirmsRevocation || !revokeReason?.trim()
                    }
                    onClick={() => void handleRevoke()}
                  >
                    {t("scopeAuthRevokeAction")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {detail.isError || approve.isError || revoke.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t("scopeAuthError")}</AlertDescription>
            </Alert>
          ) : null}
          {statusMessage ? (
            <Alert>
              <AlertDescription>{statusMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
