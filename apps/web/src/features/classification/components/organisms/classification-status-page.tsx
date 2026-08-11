"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { resolveMessage } from "@lcsp/i18n";

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
              render={<Link href={`/assessments/${assessmentId}/documents`} />}
            >
              {resolveMessage(appLocale, "pages.classification.generateFinalReport")}
            </Button>
          ) : null}
          {showGapAnalysis ? (
            <Button
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

  return (
    <section className="rounded-xl border bg-card p-5" aria-label="Verified profile review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Verified profile review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the evidence-backed facts below before legal matching and classification begin.
          </p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
          {formatStatus(profile.status)}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <Metadata label="Verification source" value={profile.verificationSource ?? "Not provided"} />
        <Metadata label="Evidence chain" value={profile.evidenceChainIntegrity === true ? "Verified" : "Needs review"} />
        <Metadata label="Provider version" value={profile.providerVersion} />
      </dl>

      <div className="mt-5">
        <p className="text-sm font-medium">Verified facts</p>
        {profile.verifiedClaims.length ? (
          <div className="mt-2 grid gap-3">
            {profile.verifiedClaims.map((claim, index) => (
              <article
                key={claimKey(claim, index)}
                className="rounded-lg border bg-muted/20 p-3"
              >
                <p className="text-sm font-medium">{claimTitle(claim, index)}</p>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {claimFacts(claim).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-medium text-muted-foreground">{humanizeKey(key)}:</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                {claimEvidenceRefs(claim).length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Evidence: {claimEvidenceRefs(claim).join(", ")}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No verified claims were included.</p>
        )}
      </div>

      {profile.conflictResolutions.length ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {profile.conflictResolutions.length} reconciliation decision(s) are attached to this profile.
        </p>
      ) : null}

      {approvalFailed ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Approval failed</AlertTitle>
          <AlertDescription>
            The profile was not approved. Refresh the assessment and confirm that it is still pending approval.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {pendingApproval ? (
          <Button disabled={isApproving} onClick={onApprove}>
            {isApproving ? "Approving…" : "Approve verified profile"}
          </Button>
        ) : (
          <p className="text-sm font-medium">
            Approved. Legal matching can proceed automatically.
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

function claimKey(claim: Record<string, unknown>, index: number): string {
  return String(claim.claim_id ?? claim.id ?? `claim-${index}`);
}

function claimTitle(claim: Record<string, unknown>, index: number): string {
  const value = claim.claim_category ?? claim.claim_type ?? claim.claim_id ?? claim.id;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : `Verified claim ${index + 1}`;
}

function claimFacts(claim: Record<string, unknown>): Array<[string, string]> {
  const omitted = new Set(["evidence_refs", "evidenceRefs"]);
  return Object.entries(claim).flatMap(([key, value]) => {
    if (omitted.has(key) || !isDisplayValue(value)) {
      return [];
    }
    return [[key, formatValue(value)] as [string, string]];
  });
}

function claimEvidenceRefs(claim: Record<string, unknown>): string[] {
  const value = claim.evidence_refs ?? claim.evidenceRefs;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isDisplayValue(value: unknown): value is string | number | boolean | string[] {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function formatValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function humanizeKey(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatStatus(value: string): string {
  return humanizeKey(value.toLowerCase());
}
