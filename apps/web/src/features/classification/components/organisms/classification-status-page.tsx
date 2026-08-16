"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusCard } from "@/components/organisms/status-card";
import {
  getClassificationActionVisibility,
  type VerifiedProfileReviewViewModel,
} from "@/lib/api/classification-client";
import {
  useApproveVerifiedProfileMutation,
  useClassificationStatusQuery,
  useRerunClassificationMutation,
} from "@/lib/api/assessment-queries";
import { appLocale } from "@/lib/locale";
import type { ClassificationStatusPageProps } from "../../types/component-props.types";

const VERIFIED_PROFILE_REVIEW_KEYS = {
  title: "pages.classification.verifiedProfileReview.title",
  description: "pages.classification.verifiedProfileReview.description",
  verificationSourceLabel:
    "pages.classification.verifiedProfileReview.verificationSourceLabel",
  evidenceChainLabel:
    "pages.classification.verifiedProfileReview.evidenceChainLabel",
  evidenceChainVerified:
    "pages.classification.verifiedProfileReview.evidenceChainVerified",
  evidenceChainNeedsReview:
    "pages.classification.verifiedProfileReview.evidenceChainNeedsReview",
  providerVersionLabel:
    "pages.classification.verifiedProfileReview.providerVersionLabel",
  factsTitle: "pages.classification.verifiedProfileReview.factsTitle",
  noClaims: "pages.classification.verifiedProfileReview.noClaims",
  confidenceLabel: "pages.classification.verifiedProfileReview.confidenceLabel",
  lifecycleStateLabel:
    "pages.classification.verifiedProfileReview.lifecycleStateLabel",
  materialityLabel:
    "pages.classification.verifiedProfileReview.materialityLabel",
  evidenceSummaryLabel:
    "pages.classification.verifiedProfileReview.evidenceSummaryLabel",
  evidenceItemLabel:
    "pages.classification.verifiedProfileReview.evidenceItemLabel",
  evidenceItemsLabel:
    "pages.classification.verifiedProfileReview.evidenceItemsLabel",
  notProvided: "pages.classification.verifiedProfileReview.notProvided",
  yes: "pages.classification.verifiedProfileReview.yes",
  no: "pages.classification.verifiedProfileReview.no",
  conflictSummary:
    "pages.classification.verifiedProfileReview.conflictSummary",
  approvalFailedTitle:
    "pages.classification.verifiedProfileReview.approvalFailedTitle",
  approvalFailedDetail:
    "pages.classification.verifiedProfileReview.approvalFailedDetail",
  approveButton: "pages.classification.verifiedProfileReview.approveButton",
  approvingButton:
    "pages.classification.verifiedProfileReview.approvingButton",
  approvedMessage: "pages.classification.verifiedProfileReview.approvedMessage",
} as const satisfies Record<string, MessageKey>;

const VERIFIED_PROFILE_STATUS_KEYS = {
  PENDING_APPROVAL:
    "pages.classification.verifiedProfileReview.statuses.PENDING_APPROVAL",
  APPROVED: "pages.classification.verifiedProfileReview.statuses.APPROVED",
  REJECTED: "pages.classification.verifiedProfileReview.statuses.REJECTED",
  UNKNOWN: "pages.classification.verifiedProfileReview.statuses.UNKNOWN",
} as const satisfies Record<string, MessageKey>;

const CLAIM_TITLE_KEYS = {
  MODEL_PROVIDER_USAGE:
    "pages.classification.verifiedProfileReview.claimTitles.MODEL_PROVIDER_USAGE",
  MODEL_INVOCATION:
    "pages.classification.verifiedProfileReview.claimTitles.MODEL_INVOCATION",
  PERSONAL_DATA_INPUT:
    "pages.classification.verifiedProfileReview.claimTitles.PERSONAL_DATA_INPUT",
  HUMAN_REVIEW:
    "pages.classification.verifiedProfileReview.claimTitles.HUMAN_REVIEW",
  AFFECTED_SUBJECTS:
    "pages.classification.verifiedProfileReview.claimTitles.AFFECTED_SUBJECTS",
  BUSINESS_PROCESS:
    "pages.classification.verifiedProfileReview.claimTitles.BUSINESS_PROCESS",
  AI_PURPOSE: "pages.classification.verifiedProfileReview.claimTitles.AI_PURPOSE",
  UNKNOWN: "pages.classification.verifiedProfileReview.claimTitles.UNKNOWN",
} as const satisfies Record<string, MessageKey>;

const CLAIM_DESCRIPTION_KEYS = {
  model_provider_usage:
    "pages.classification.verifiedProfileReview.claimDescriptions.model_provider_usage",
  model_invocation:
    "pages.classification.verifiedProfileReview.claimDescriptions.model_invocation",
  personal_data_input:
    "pages.classification.verifiedProfileReview.claimDescriptions.personal_data_input",
  human_review:
    "pages.classification.verifiedProfileReview.claimDescriptions.human_review",
  affected_subjects:
    "pages.classification.verifiedProfileReview.claimDescriptions.affected_subjects",
  business_process:
    "pages.classification.verifiedProfileReview.claimDescriptions.business_process",
  ai_purpose:
    "pages.classification.verifiedProfileReview.claimDescriptions.ai_purpose",
} as const satisfies Record<string, MessageKey>;

const CONFIDENCE_KEYS = {
  low: "pages.classification.verifiedProfileReview.confidenceLevels.low",
  medium: "pages.classification.verifiedProfileReview.confidenceLevels.medium",
  high: "pages.classification.verifiedProfileReview.confidenceLevels.high",
  unknown: "pages.classification.verifiedProfileReview.confidenceLevels.unknown",
} as const satisfies Record<string, MessageKey>;

const LIFECYCLE_STATE_KEYS = {
  DETECTED: "pages.classification.verifiedProfileReview.lifecycleStates.DETECTED",
  ABSTAINED:
    "pages.classification.verifiedProfileReview.lifecycleStates.ABSTAINED",
  INFERRED: "pages.classification.verifiedProfileReview.lifecycleStates.INFERRED",
  CONFIRMED:
    "pages.classification.verifiedProfileReview.lifecycleStates.CONFIRMED",
  UNKNOWN: "pages.classification.verifiedProfileReview.lifecycleStates.UNKNOWN",
} as const satisfies Record<string, MessageKey>;

const VERIFICATION_SOURCE_KEYS = {
  TECHNICAL_PLUS_WIZARD:
    "pages.classification.verifiedProfileReview.verificationSources.TECHNICAL_PLUS_WIZARD",
  UNKNOWN:
    "pages.classification.verifiedProfileReview.verificationSources.UNKNOWN",
} as const satisfies Record<string, MessageKey>;

export function ClassificationStatusPage({
  assessmentId,
}: ClassificationStatusPageProps) {
  const router = useRouter();
  const statusQuery = useClassificationStatusQuery(assessmentId);
  const rerunMutation = useRerunClassificationMutation(assessmentId);
  const approveProfileMutation = useApproveVerifiedProfileMutation(assessmentId);

  useEffect(() => {
    if (statusQuery.data?.kind === "redirect") {
      router.replace(statusQuery.data.location);
    }
  }, [router, statusQuery.data]);

  const headingDescription = useMemo(
    () => resolveMessage(appLocale, "pages.classification.pageDescription"),
    [],
  );

  if (statusQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {resolveMessage(appLocale, "pages.classification.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{headingDescription}</p>
        </header>
        <StatusCard
          title={resolveMessage(appLocale, "pages.classification.pageTitle")}
          description={resolveMessage(appLocale, "pages.classification.loading")}
          badgeLabel={resolveMessage(appLocale, "pages.classification.states.processingBadge")}
          badgeVariant="secondary"
        >
          <div className="py-2 text-sm text-muted-foreground">
            {resolveMessage(appLocale, "pages.classification.loading")}
          </div>
        </StatusCard>
      </div>
    );
  }

  const viewModel =
    statusQuery.data?.kind === "loaded" ? statusQuery.data.data : null;
  const error =
    statusQuery.data?.kind === "error"
      ? resolveMessage(appLocale, statusQuery.data.titleKey)
      : null;

  if (error || !viewModel) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {resolveMessage(appLocale, "pages.classification.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{headingDescription}</p>
        </header>
        <Alert variant="destructive">
          <AlertTitle>
            {resolveMessage(appLocale, "pages.classification.errorTitle")}
          </AlertTitle>
          <AlertDescription>{error ?? resolveMessage(appLocale, "pages.classification.errorDetail")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const state = viewModel.state;
  const actionVisibility = getClassificationActionVisibility(viewModel);
  const showFinalReport = actionVisibility.showFinalReport;
  const showGapAnalysis = actionVisibility.showGapAnalysis;
  const showRerunClassification = actionVisibility.showRerunClassification;
  const summary = viewModel.summaryText ??
    (viewModel.summaryKey
      ? resolveMessage(appLocale, viewModel.summaryKey)
      : null);
  const profileReview = !viewModel.hasClassification
    ? viewModel.verifiedProfileReview
    : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {resolveMessage(appLocale, "pages.classification.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{headingDescription}</p>
      </header>

      {profileReview ? (
        <VerifiedProfileReviewCard
          profile={profileReview}
          isApproving={approveProfileMutation.isPending}
          approvalFailed={approveProfileMutation.isError}
          onApprove={() =>
            approveProfileMutation.mutate(profileReview.verifiedProfileId)
          }
        />
      ) : null}

      <StatusCard
        title={resolveMessage(appLocale, viewModel.titleKey)}
        description={resolveMessage(appLocale, viewModel.descriptionKey)}
        badgeLabel={resolveMessage(appLocale, viewModel.badgeKey)}
        badgeVariant={state === "blocked" ? "destructive" : "secondary"}
      >
        {summary ? (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-medium">{resolveMessage(appLocale, "pages.classification.summaryLabel")}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {summary}
            </p>
          </div>
        ) : null}

        {viewModel.references?.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {resolveMessage(appLocale, "pages.classification.referencesLabel")}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {viewModel.references.map((reference) => (
                <li key={reference}>{reference}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {state === "locked" ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {resolveMessage(appLocale, "pages.classification.states.lockedNextSteps")}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {showRerunClassification ? (
            <Button
              disabled={rerunMutation.isPending}
              onClick={() => rerunMutation.mutate()}
              variant="outline"
            >
              {resolveMessage(
                appLocale,
                rerunMutation.isPending
                  ? "pages.classification.rerunSubmitting"
                  : "pages.classification.rerunClassification",
              )}
            </Button>
          ) : null}
          {showFinalReport ? (
            <Button
              nativeButton={false}
              render={<Link href={`/assessments/${assessmentId}/documents`} />}
            >
              {resolveMessage(appLocale, "pages.classification.generateFinalReport")}
            </Button>
          ) : null}
          {showGapAnalysis ? (
            <Button
              nativeButton={false}
              render={<Link href={`/assessments/${assessmentId}/documents`} />}
              variant="outline"
            >
              {resolveMessage(appLocale, "pages.classification.generateGapAnalysis")}
            </Button>
          ) : null}
        </div>
      </StatusCard>
    </div>
  );
}

function VerifiedProfileReviewCard({
  profile,
  isApproving,
  approvalFailed,
  onApprove,
}: {
  profile: VerifiedProfileReviewViewModel;
  isApproving: boolean;
  approvalFailed: boolean;
  onApprove: () => void;
}) {
  const pendingApproval = profile.status === "PENDING_APPROVAL";
  const t = (key: MessageKey) => resolveMessage(appLocale, key);

  return (
    <section
      className="rounded-lg border bg-card p-5"
      aria-label={t(VERIFIED_PROFILE_REVIEW_KEYS.title)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t(VERIFIED_PROFILE_REVIEW_KEYS.title)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(VERIFIED_PROFILE_REVIEW_KEYS.description)}
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
          {formatProfileStatus(profile.status)}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Metadata
          label={t(VERIFIED_PROFILE_REVIEW_KEYS.verificationSourceLabel)}
          value={formatVerificationSource(profile.verificationSource)}
        />
        <Metadata
          label={t(VERIFIED_PROFILE_REVIEW_KEYS.evidenceChainLabel)}
          value={
            profile.evidenceChainIntegrity === true
              ? t(VERIFIED_PROFILE_REVIEW_KEYS.evidenceChainVerified)
              : t(VERIFIED_PROFILE_REVIEW_KEYS.evidenceChainNeedsReview)
          }
        />
        <Metadata
          label={t(VERIFIED_PROFILE_REVIEW_KEYS.providerVersionLabel)}
          value={profile.providerVersion}
        />
      </dl>

      <div className="mt-5">
        <p className="text-sm font-medium">
          {t(VERIFIED_PROFILE_REVIEW_KEYS.factsTitle)}
        </p>
        {profile.verifiedClaims.length ? (
          <div className="mt-2 grid gap-3">
            {profile.verifiedClaims.map((claim, index) => (
              <article
                key={claimKey(claim, index)}
                className="rounded-lg border bg-muted/20 p-3"
              >
                <p className="text-sm font-medium">{claimTitle(claim)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {claimDescription(claim)}
                </p>
                <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  <MetadataRow
                    label={t(VERIFIED_PROFILE_REVIEW_KEYS.confidenceLabel)}
                    value={formatConfidence(claim)}
                  />
                  <MetadataRow
                    label={t(VERIFIED_PROFILE_REVIEW_KEYS.lifecycleStateLabel)}
                    value={formatLifecycleState(claim)}
                  />
                  <MetadataRow
                    label={t(VERIFIED_PROFILE_REVIEW_KEYS.materialityLabel)}
                    value={formatBoolean(claim.is_material)}
                  />
                  <MetadataRow
                    label={t(VERIFIED_PROFILE_REVIEW_KEYS.evidenceSummaryLabel)}
                    value={formatEvidenceSummary(claim)}
                  />
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {t(VERIFIED_PROFILE_REVIEW_KEYS.noClaims)}
          </p>
        )}
      </div>

      {profile.conflictResolutions.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {profile.conflictResolutions.length}{" "}
          {t(VERIFIED_PROFILE_REVIEW_KEYS.conflictSummary)}
        </p>
      ) : null}

      {approvalFailed ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>
            {t(VERIFIED_PROFILE_REVIEW_KEYS.approvalFailedTitle)}
          </AlertTitle>
          <AlertDescription>
            {t(VERIFIED_PROFILE_REVIEW_KEYS.approvalFailedDetail)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {pendingApproval ? (
          <Button disabled={isApproving} onClick={onApprove}>
            {isApproving
              ? t(VERIFIED_PROFILE_REVIEW_KEYS.approvingButton)
              : t(VERIFIED_PROFILE_REVIEW_KEYS.approveButton)}
          </Button>
        ) : (
          <p className="text-sm font-medium">
            {t(VERIFIED_PROFILE_REVIEW_KEYS.approvedMessage)}
          </p>
        )}
      </div>
    </section>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function claimKey(claim: Record<string, unknown>, index: number): string {
  return String(claim.claim_id ?? claim.id ?? `claim-${index}`);
}

function claimTitle(claim: Record<string, unknown>): string {
  const key = readClaimType(claim);
  return resolveMessage(appLocale, CLAIM_TITLE_KEYS[key]);
}

function claimDescription(claim: Record<string, unknown>): string {
  const field = readString(claim.claim_field);
  const key =
    field && hasMessageKey(CLAIM_DESCRIPTION_KEYS, field)
      ? CLAIM_DESCRIPTION_KEYS[field]
      : undefined;
  return key
    ? resolveMessage(appLocale, key)
    : resolveMessage(appLocale, CLAIM_TITLE_KEYS.UNKNOWN);
}

function claimEvidenceRefs(claim: Record<string, unknown>): string[] {
  const value = claim.evidence_refs ?? claim.evidenceRefs;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function formatEvidenceSummary(claim: Record<string, unknown>): string {
  const count = claimEvidenceRefs(claim).length;
  const labelKey =
    count === 1
      ? VERIFIED_PROFILE_REVIEW_KEYS.evidenceItemLabel
      : VERIFIED_PROFILE_REVIEW_KEYS.evidenceItemsLabel;
  return `${count} ${resolveMessage(appLocale, labelKey)}`;
}

function formatProfileStatus(value: string): string {
  const key = hasMessageKey(VERIFIED_PROFILE_STATUS_KEYS, value)
    ? VERIFIED_PROFILE_STATUS_KEYS[value]
    : VERIFIED_PROFILE_STATUS_KEYS.UNKNOWN;
  return resolveMessage(appLocale, key);
}

function formatVerificationSource(value: string | null): string {
  const key =
    value && hasMessageKey(VERIFICATION_SOURCE_KEYS, value)
      ? VERIFICATION_SOURCE_KEYS[value]
      : VERIFICATION_SOURCE_KEYS.UNKNOWN;
  return resolveMessage(appLocale, key);
}

function formatConfidence(claim: Record<string, unknown>): string {
  const value = readString(claim.confidence);
  const normalized = value?.toLowerCase();
  const key =
    normalized && hasMessageKey(CONFIDENCE_KEYS, normalized)
      ? CONFIDENCE_KEYS[normalized]
      : undefined;
  return resolveMessage(appLocale, key ?? CONFIDENCE_KEYS.unknown);
}

function formatLifecycleState(claim: Record<string, unknown>): string {
  const value = readString(claim.lifecycle_state);
  const normalized = value?.toUpperCase();
  const key =
    normalized && hasMessageKey(LIFECYCLE_STATE_KEYS, normalized)
      ? LIFECYCLE_STATE_KEYS[normalized]
      : undefined;
  return resolveMessage(appLocale, key ?? LIFECYCLE_STATE_KEYS.UNKNOWN);
}

function formatBoolean(value: unknown): string {
  return resolveMessage(
    appLocale,
    value === true
      ? VERIFIED_PROFILE_REVIEW_KEYS.yes
      : VERIFIED_PROFILE_REVIEW_KEYS.no,
  );
}

function readClaimType(claim: Record<string, unknown>): keyof typeof CLAIM_TITLE_KEYS {
  const rawValue = readString(claim.claim_type ?? claim.claim_category);
  const normalized = rawValue?.toUpperCase();
  return normalized && normalized in CLAIM_TITLE_KEYS
    ? (normalized as keyof typeof CLAIM_TITLE_KEYS)
    : "UNKNOWN";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasMessageKey<TMap extends Record<string, MessageKey>>(
  map: TMap,
  key: string,
): key is keyof TMap & string {
  return Object.prototype.hasOwnProperty.call(map, key);
}
