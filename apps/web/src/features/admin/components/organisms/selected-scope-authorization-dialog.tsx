"use client";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApproveScopeAuthorization,
  useLegalRuleCommand,
  usePreparationRuleHistory,
  useRevokeScopeAuthorization,
  useRuleScopeAuthorizations,
  useScopeAuthorization,
  useSubmitScopeAuthorization,
} from "@/lib/api/legal-rule-catalog-queries";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
  PREPARATION_SCOPE_STAGES,
} from "@lcsp/contracts/compliance-rule-set";
import {
  preparationRuleBatchSchema,
  legalRuleRegenerateSchema,
  SELECTED_SCOPE_AUTHORIZATION_STATES,
} from "@lcsp/contracts/legal-rule-catalog";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
  initialScopeKey = "",
  onRegenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogId: string;
  catalogRevision: number;
  ruleId: string;
  initialScopeKey?: string;
  onRegenerated?: (batchId: string) => void;
}) {
  const [activeKey, setActiveKey] = useState(
    /^[a-f0-9]{64}$/.test(initialScopeKey) ? initialScopeKey : "",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const form = useForm<ScopeAuthorizationFormValues>({
    resolver: zodResolver(scopeAuthorizationFormSchema),
    defaultValues: {
      scopeKey: initialScopeKey,
      confirmsLegalReview: false,
      revokeReason: "",
      confirmsRevocation: false,
    },
  });
  const list = useRuleScopeAuthorizations(catalogId, ruleId);
  const history = usePreparationRuleHistory(ruleId);
  const effectiveKey =
    activeKey || list.data?.authorizations[0]?.scopeKey || "";

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

  const detail = useScopeAuthorization(catalogId, effectiveKey);
  const submitCandidate = useSubmitScopeAuthorization(catalogId);
  const approve = useApproveScopeAuthorization(catalogId);
  const revoke = useRevokeScopeAuthorization(catalogId);
  const regenerate = useLegalRuleCommand(
    `/rules/${ruleId}/regenerate`,
    preparationRuleBatchSchema,
  );
  const latestDraft = history.data?.results?.[0];

  /**
   * Business purpose: Submit the latest Preparation draft as a Legal Review candidate when no authorization exists yet.
   * Business rules:
   * - Each requirement uses only its own pinned source references; unresolved decisions remain unapproved.
   * Execution flow: 1. Build submit payload from latestDraft. 2. Submit candidate and select its scopeKey.
   * Failure cases: Missing draft or citations is guarded before dispatch; API errors surface in alert.
   * Side effects: Persists a DRAFT SelectedRuleScopeAuthorization record.
   */
  async function handleSubmitCandidate() {
    if (!latestDraft?.output || !latestDraft.input.citations.length) return;
    setStatusMessage(null);
    // Each requirement can cite a different provision or multiple chunks; never
    // reuse the first citation as evidence for unrelated obligations.
    const citations = latestDraft.input.citations;
    const submitted = await submitCandidate.mutateAsync({
      ruleId,
      expectedCatalogRevision: catalogRevision,
      expectedReviewRevision: 0,
      output: latestDraft.output,
      decisions: latestDraft.output.legalRequirements.map((req) => ({
        legalRequirementId: req.legalRequirementId,
        stage:
          req.coverage.nonAssessableReason?.startsWith(
            PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
          )
            ? PREPARATION_SCOPE_STAGES[2]
            : req.coverage.state === LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES
              ? PREPARATION_SCOPE_STAGES[0]
              : PREPARATION_SCOPE_STAGES[1],
        rationale:
          req.coverage.nonAssessableReason ??
          req.proposition ??
          "Legal review candidate",
        technicalDeliverable:
          req.coverage.state === LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES
            ? req.title
            : null,
        sourceSupport: req.sourceRefs.flatMap((ref) => {
          const citation = citations.find(
            (candidate) =>
              candidate.documentId === ref.documentId &&
              candidate.locator === ref.locator &&
              candidate.contentSha256 === ref.contentSha256,
          );
          // Missing references must fail server validation, not acquire invented spans.
          return citation && citation.content.length
            ? [{
                chunkId: citation.chunkId,
                startOffset: 0,
                endOffset: citation.content.length,
                contentSha256: citation.contentSha256.replace(/^sha256:/u, ""),
              }]
            : [];
        }),
      })),
    });
    setActiveKey(submitted.scopeKey);
    setStatusMessage(t("scopeAuthSuccess"));
  }

  /**
   * Business purpose: Trigger single-rule regeneration after Legal Review approval.
   * Business rules: Regeneration pins the latest result identity and its original inputs; only an approved review may initiate it.
   * Execution flow: 1. POST /rules/:ruleId/regenerate. 2. Forward batch ID and close.
   * Failure cases: API errors surface in the dialog alert.
   * Side effects: Queues a selected-rule regeneration batch.
   */
  async function handleRegenerate() {
    if (
      !history.data?.latestResultId ||
      detail.data?.state !== SELECTED_SCOPE_AUTHORIZATION_STATES.APPROVED
    ) return;
    setStatusMessage(null);
    // Why: The endpoint rejects stale result identities and unexpected fields.
    // Keep original inputs pinned; a review must never silently switch sources.
    const batch = await regenerate.mutateAsync(
      legalRuleRegenerateSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        expectedResultId: history.data.latestResultId,
        useLatestInputs: false,
      }),
    );
    onOpenChange(false);
    onRegenerated?.(batch.id);
  }

  /**
   * Business purpose: Independently approve a loaded DRAFT semantic authorization candidate.
   * Business rules: Requires confirmsLegalReview and loaded DRAFT data.
   * Execution flow: 1. Call approve mutation with catalog/review revisions and decisionDigest.
   * Failure cases: Self-approval or stale revision sets mutation error state.
   * Side effects: Persists APPROVED state and refreshes detail.
   */
  async function handleApprove() {
    if (!detail.data || !confirmsLegalReview || unresolvedReview) return;
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

  // A retained unresolved candidate is not yet eligible for approval.
  const unresolvedReview = Boolean(
    detail.data?.decisions.some(
      (decision) => decision.stage === PREPARATION_SCOPE_STAGES[2],
    ) ||
      detail.data?.output.legalRequirements.some((req) =>
        req.coverage.nonAssessableReason?.startsWith(
          PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
        ),
      ),
  );
  const busy =
    approve.isPending ||
    revoke.isPending ||
    submitCandidate.isPending ||
    regenerate.isPending ||
    detail.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("scopeAuthTitle")}</DialogTitle>
          <DialogDescription>{t("scopeAuthDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {list.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("loading")}
            </p>
          ) : list.data?.authorizations.length ? (
            list.data.authorizations.length > 1 ? (
              <div className="space-y-1">
                <Label>{t("scopeAuthRevisionLabel")}</Label>
                <Select
                  value={effectiveKey}
                  onValueChange={(value) => setActiveKey(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {list.data.authorizations.map((item) => (
                      <SelectItem key={item.scopeKey} value={item.scopeKey}>
                        {`${item.state} · ${t("revision")} ${item.revision}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("noResult")}</p>
              {latestDraft?.output ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSubmitCandidate()}
                >
                  {t("scopeAuthSubmitCandidateAction")}
                </Button>
              ) : null}
            </div>
          )}

          {detail.data ? (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-medium">
                    {t("scopeAuthStateLabel")}:
                  </span>{" "}
                  {detail.data.state}
                </div>
                <div>
                  <span className="font-medium">
                    {t("scopeAuthRevisionLabel")}:
                  </span>{" "}
                  {detail.data.revision}
                </div>
                <div>
                  <span className="font-medium">
                    {t("scopeAuthAuthorLabel")}:
                  </span>{" "}
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
                <div className="col-span-2">
                  <span className="font-medium">
                    {t("scopeAuthDigestLabel")}:
                  </span>{" "}
                  <code className="break-all text-xs">
                    {detail.data.decisionDigest}
                  </code>
                </div>
              </div>

              {/* Source-linked citations: show verbatim legal text and locator before approval. */}
              <div className="space-y-2 border-t pt-3">
                <h4 className="font-semibold">
                  {t("scopeAuthCitationsTitle")}
                </h4>
                {detail.data.citations.map((citation) => (
                  <div
                    key={citation.chunkId}
                    className="space-y-1 rounded border bg-muted/40 p-2 text-xs"
                  >
                    <div className="font-medium">
                      {citation.documentId} · {citation.locator}
                    </div>
                    <p className="whitespace-pre-wrap">{citation.content}</p>
                  </div>
                ))}
              </div>

              {/* Legal Requirements: actor, modality, action, conditions, exceptions, and coverage. */}
              <div className="space-y-2 border-t pt-3">
                <h4 className="font-semibold">
                  {t("scopeAuthRequirementsTitle")}
                </h4>
                {detail.data.output.legalRequirements.map((req) => (
                  <div
                    key={req.legalRequirementId}
                    className="space-y-1 rounded border p-2 text-xs"
                  >
                    <div className="font-medium">{req.title}</div>
                    <p>{req.proposition}</p>
                    {req.operativePropositions?.map((op, idx) => (
                      <div key={idx} className="text-muted-foreground">
                        {t("scopeAuthActorLabel")}: {op.actor} ·{" "}
                        {t("scopeAuthModalityLabel")}: {op.modality} ·{" "}
                        {t("scopeAuthActionLabel")}: {op.action}
                      </div>
                    ))}
                    {req.applicabilityConditions.length > 0 ? (
                      <div>
                        <span className="font-medium">{t("conditions")}:</span>{" "}
                        {req.applicabilityConditions.join("; ")}
                      </div>
                    ) : null}
                    {req.exceptions.length > 0 ? (
                      <div>
                        <span className="font-medium">{t("exceptions")}:</span>{" "}
                        {req.exceptions.join("; ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Development Scope classification decisions and rationale. */}
              <div className="space-y-2 border-t pt-3">
                <h4 className="font-semibold">
                  {t("scopeAuthDecisionsTitle")}
                </h4>
                {detail.data.decisions.map((decision) => (
                  <div
                    key={decision.legalRequirementId}
                    className="space-y-1 rounded border p-2 text-xs"
                  >
                    <div>
                      <span className="font-medium">
                        {t("scopeAuthStageLabel")}:
                      </span>{" "}
                      {decision.stage}
                    </div>
                    {decision.technicalDeliverable ? (
                      <div>
                        <span className="font-medium">
                          {t("scopeAuthDeliverableLabel")}:
                        </span>{" "}
                        {decision.technicalDeliverable}
                      </div>
                    ) : null}
                    <div>
                      <span className="font-medium">
                        {t("scopeAuthRationaleLabel")}:
                      </span>{" "}
                      {decision.rationale}
                    </div>
                  </div>
                ))}
              </div>

              {/* Assessment Rules, compliance criteria, and required evidence. */}
              {detail.data.output.assessmentRules.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <h4 className="font-semibold">{t("scopeAuthRulesTitle")}</h4>
                  {detail.data.output.assessmentRules.map((rule) => (
                    <div
                      key={rule.assessmentRuleId}
                      className="space-y-1 rounded border p-2 text-xs"
                    >
                      <div className="font-medium">{rule.concept}</div>
                      <div>
                        <span className="font-medium">{t("criteria")}:</span>{" "}
                        {rule.criteria
                          .map((c) => c.statement || c.criterionId)
                          .join("; ")}
                      </div>
                      {rule.requiredEvidence.length > 0 ? (
                        <div>
                          <span className="font-medium">
                            {t("requiredEvidence")}:
                          </span>{" "}
                          {rule.requiredEvidence.join("; ")}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {detail.data.state ===
              SELECTED_SCOPE_AUTHORIZATION_STATES.DRAFT ? (
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
                    disabled={busy || !confirmsLegalReview || unresolvedReview}
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
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !history.data?.latestResultId}
                    onClick={() => void handleRegenerate()}
                  >
                    {t("scopeAuthRegenerateAction")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {detail.isError ||
          approve.isError ||
          revoke.isError ||
          submitCandidate.isError ||
          regenerate.isError ? (
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
