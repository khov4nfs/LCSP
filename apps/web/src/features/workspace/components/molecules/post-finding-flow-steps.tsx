"use client";

import {
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_DECISIONS,
  VERIFICATION_RESULT_STATUSES,
  type RemediationDecision,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  Code2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";

import { ArtifactStatusBadge } from "@/features/artifacts/components/artifact-status-badge";
import {
  ARTIFACT_OPEN_KINDS,
  buildArtifactOpenTarget,
} from "@/features/artifacts/utils/artifact-routes";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type {
  NormalizedAssessmentArtifactItem,
  NormalizedAssessmentArtifacts,
  NormalizedAssessmentPostFinding,
} from "../../types/assessment-runtime-adapter.types";
import type { ChatSingleSelectOption } from "../../types/assessment-chat.types";
import { ChatResultContainer } from "./chat-result-container";
import { ChatSingleSelect } from "./chat-single-select";
import { SelectionHistoryRow } from "./selection-history-row";

type PostFindingPresentation = NormalizedAssessmentPostFinding & {
  canSelectDecision: boolean;
  screenProjection: string;
};

type PostFindingFlowStepsProps = {
  postFinding: PostFindingPresentation;
  artifacts: Pick<
    NormalizedAssessmentArtifacts,
    "remediationPatch" | "verificationReport" | "finalReport"
  >;
  disabled?: boolean;
  onDecisionSelect: (decision: RemediationDecision) => void;
};

export function PostFindingFlowSteps({
  postFinding,
  artifacts,
  disabled = false,
  onDecisionSelect,
}: PostFindingFlowStepsProps) {
  const shouldShowDecision =
    postFinding.canSelectDecision || postFinding.selectedDecision !== null;
  const shouldShowExistingPr =
    postFinding.phase === POST_FINDING_RUNTIME_PHASES.existingPr ||
    postFinding.selectedDecision === REMEDIATION_DECISIONS.continueDetectedPr ||
    postFinding.detectedPullRequest !== null;
  const shouldShowCreatePr =
    postFinding.phase === POST_FINDING_RUNTIME_PHASES.createPr ||
    postFinding.selectedDecision ===
      REMEDIATION_DECISIONS.createRemediationPr ||
    postFinding.createdPullRequest !== null;
  const shouldShowVerification =
    postFinding.phase === POST_FINDING_RUNTIME_PHASES.verification ||
    postFinding.phase === POST_FINDING_RUNTIME_PHASES.final ||
    postFinding.verificationActivities.length > 0 ||
    postFinding.verificationStatus !== null;
  const shouldShowFinal =
    postFinding.phase === POST_FINDING_RUNTIME_PHASES.final ||
    postFinding.finalResult !== null;

  return (
    <div
      data-slot="post-finding-flow"
      data-screen-projection={postFinding.screenProjection}
      className="grid max-w-170 min-w-0 gap-3"
    >
      <CodeReviewStep
        activities={postFinding.codeReviewActivities}
        remediationPatch={artifacts.remediationPatch}
      />
      {shouldShowDecision ? (
        <RemediationDecisionGroup
          availableDecisions={postFinding.availableDecisions}
          selectedDecision={postFinding.selectedDecision}
          disabled={disabled || !postFinding.canSelectDecision}
          onDecisionSelect={onDecisionSelect}
        />
      ) : null}
      {shouldShowExistingPr ? (
        <ExistingPRBranch pullRequest={postFinding.detectedPullRequest} />
      ) : null}
      {shouldShowCreatePr ? (
        <CreatePRBranch pullRequest={postFinding.createdPullRequest} />
      ) : null}
      {shouldShowVerification ? (
        <VerificationStep
          activities={postFinding.verificationActivities}
          status={postFinding.verificationStatus}
          verificationReport={artifacts.verificationReport}
        />
      ) : null}
      {shouldShowFinal ? (
        <FinalAssessmentStep
          result={postFinding.finalResult}
          remediationPatch={artifacts.remediationPatch}
          verificationReport={artifacts.verificationReport}
          finalReport={artifacts.finalReport}
        />
      ) : null}
    </div>
  );
}

export function CodeReviewStep({
  activities,
  remediationPatch,
}: {
  activities: NormalizedAssessmentPostFinding["codeReviewActivities"];
  remediationPatch: NormalizedAssessmentArtifactItem | null;
}) {
  return (
    <ChatResultContainer
      className="p-3.5"
      header={
        <StepHeader
          icon={<Code2Icon />}
          label={t("pages.assessmentFlow.postFinding.codeReviewTitle")}
        />
      }
    >
      <ActivityList
        activities={activities}
        emptyLabel={t("pages.assessmentFlow.postFinding.codeReviewPending")}
      />
      {remediationPatch ? (
        <ArtifactLink className="mt-3" item={remediationPatch} />
      ) : null}
    </ChatResultContainer>
  );
}

export function RemediationDecisionGroup({
  availableDecisions,
  selectedDecision,
  disabled,
  onDecisionSelect,
}: {
  availableDecisions: RemediationDecision[];
  selectedDecision: RemediationDecision | null;
  disabled: boolean;
  onDecisionSelect: (decision: RemediationDecision) => void;
}) {
  const options = remediationOptions(availableDecisions);
  const value = selectedDecision ?? undefined;

  if (selectedDecision) {
    return (
      <SelectionHistoryRow
        prompt={t("pages.assessmentFlow.postFinding.decisionPrompt")}
        selectedValue={remediationDecisionLabel(selectedDecision)}
      />
    );
  }

  return (
    <ChatResultContainer
      className="p-3.5"
      header={
        <StepHeader
          icon={<ShieldCheckIcon />}
          label={t("pages.assessmentFlow.postFinding.decisionTitle")}
        />
      }
    >
      <ChatSingleSelect
        ariaLabel={t("pages.assessmentFlow.postFinding.decisionPrompt")}
        disabled={disabled}
        options={options}
        value={value}
        onValueChange={(nextValue) => {
          if (isAvailableDecision(nextValue, availableDecisions)) {
            onDecisionSelect(nextValue);
          }
        }}
      />
    </ChatResultContainer>
  );
}

export function ExistingPRBranch({
  pullRequest,
}: {
  pullRequest: NormalizedAssessmentPostFinding["detectedPullRequest"];
}) {
  return (
    <PullRequestBranch
      icon={<GitPullRequestIcon />}
      label={t("pages.assessmentFlow.postFinding.existingPrTitle")}
      emptyLabel={t("pages.assessmentFlow.postFinding.existingPrPending")}
      pullRequest={pullRequest}
    />
  );
}

export function CreatePRBranch({
  pullRequest,
}: {
  pullRequest: NormalizedAssessmentPostFinding["createdPullRequest"];
}) {
  return (
    <PullRequestBranch
      icon={<GitBranchIcon />}
      label={t("pages.assessmentFlow.postFinding.createPrTitle")}
      emptyLabel={t("pages.assessmentFlow.postFinding.createPrPending")}
      pullRequest={pullRequest}
    />
  );
}

export function VerificationStep({
  activities,
  status,
  verificationReport,
}: {
  activities: NormalizedAssessmentPostFinding["verificationActivities"];
  status: NormalizedAssessmentPostFinding["verificationStatus"];
  verificationReport: NormalizedAssessmentArtifactItem | null;
}) {
  return (
    <ChatResultContainer
      className="p-3.5"
      header={
        <StepHeader
          icon={<CheckCircle2Icon />}
          label={t("pages.assessmentFlow.postFinding.verificationTitle")}
          meta={status ? verificationStatusLabel(status) : undefined}
        />
      }
    >
      <ActivityList
        activities={activities}
        emptyLabel={t("pages.assessmentFlow.postFinding.verificationPending")}
      />
      {verificationReport ? (
        <ArtifactLink className="mt-3" item={verificationReport} />
      ) : null}
    </ChatResultContainer>
  );
}

export function FinalAssessmentStep({
  result,
  remediationPatch,
  verificationReport,
  finalReport,
}: {
  result: NormalizedAssessmentPostFinding["finalResult"];
  remediationPatch: NormalizedAssessmentArtifactItem | null;
  verificationReport: NormalizedAssessmentArtifactItem | null;
  finalReport: NormalizedAssessmentArtifactItem | null;
}) {
  const artifacts = [remediationPatch, verificationReport, finalReport].filter(
    (item): item is NormalizedAssessmentArtifactItem => item !== null,
  );

  return (
    <ChatResultContainer
      className="p-3.5"
      header={
        <StepHeader
          icon={<ShieldCheckIcon />}
          label={t("pages.assessmentFlow.postFinding.finalTitle")}
          meta={
            result
              ? t(`pages.assessmentFlow.postFinding.finalResults.${result}`)
              : undefined
          }
        />
      }
    >
      <p className="text-xs leading-5 text-muted-foreground">
        {t("pages.assessmentFlow.postFinding.finalSummary")}
      </p>
      {artifacts.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {artifacts.map((artifact) => (
            <ArtifactLink
              key={`${artifact.type}:${artifact.id}`}
              item={artifact}
            />
          ))}
        </div>
      ) : null}
    </ChatResultContainer>
  );
}

function PullRequestBranch({
  icon,
  label,
  emptyLabel,
  pullRequest,
}: {
  icon: React.ReactNode;
  label: string;
  emptyLabel: string;
  pullRequest:
    | NormalizedAssessmentPostFinding["detectedPullRequest"]
    | NormalizedAssessmentPostFinding["createdPullRequest"];
}) {
  return (
    <ChatResultContainer
      className="p-3.5"
      header={<StepHeader icon={icon} label={label} />}
    >
      {pullRequest ? (
        <div className="grid gap-1.5 text-xs leading-5">
          <p className="font-medium text-foreground">
            {t("pages.assessmentFlow.postFinding.pullRequestNumber").replace(
              "{number}",
              String(pullRequest.number),
            )}
          </p>
          <p className="text-muted-foreground">
            {t("pages.assessmentFlow.postFinding.pullRequestBranch").replace(
              "{branch}",
              pullRequest.branch,
            )}
          </p>
          {pullRequest.url ? (
            <Link
              href={pullRequest.url}
              className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {t("pages.assessmentFlow.postFinding.openPullRequest")}
              <ArrowRightIcon className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">{emptyLabel}</p>
      )}
    </ChatResultContainer>
  );
}

function ActivityList({
  activities,
  emptyLabel,
}: {
  activities: NormalizedAssessmentPostFinding["codeReviewActivities"];
  emptyLabel: string;
}) {
  if (activities.length === 0) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">{emptyLabel}</p>
    );
  }

  return (
    <ol className="grid gap-2">
      {activities.map((activity) => (
        <li key={activity.id} className="grid gap-0.5 text-xs leading-5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="size-1.5 shrink-0 rounded-full bg-primary"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {activity.label}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {activity.status}
            </span>
          </div>
          {activity.detail ? (
            <p className="pl-3.5 text-muted-foreground">{activity.detail}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ArtifactLink({
  item,
  className,
}: {
  item: NormalizedAssessmentArtifactItem;
  className?: string;
}) {
  const target = buildArtifactOpenTarget(item.ref);
  const label = t(`pages.${item.labelKey}`);
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {label}
      </span>
      <ArtifactStatusBadge status={item.status} />
      {target.kind !== ARTIFACT_OPEN_KINDS.unsupported ? (
        <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : null}
    </>
  );

  if (
    target.kind === ARTIFACT_OPEN_KINDS.internal ||
    target.kind === ARTIFACT_OPEN_KINDS.download
  ) {
    return (
      <Link
        href={target.href}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-primary hover:bg-muted/50",
          className,
        )}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-muted-foreground opacity-70",
        className,
      )}
    >
      {content}
    </div>
  );
}

function StepHeader({
  icon,
  label,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 text-foreground [&_svg]:size-3.5">
          {icon}
        </span>
        <h3 className="truncate text-[13px] font-semibold text-foreground">
          {label}
        </h3>
      </div>
      {meta ? (
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </header>
  );
}

function remediationOptions(
  availableDecisions: RemediationDecision[],
): ChatSingleSelectOption[] {
  return [
    REMEDIATION_DECISIONS.updateGithubPat,
    REMEDIATION_DECISIONS.continueDetectedPr,
    REMEDIATION_DECISIONS.createRemediationPr,
  ].map((decision) => ({
    id: decision,
    label: remediationDecisionLabel(decision),
    disabled: !availableDecisions.includes(decision),
  }));
}

function remediationDecisionLabel(decision: RemediationDecision) {
  return t(`pages.assessmentFlow.postFinding.decisions.${decision}`);
}

function verificationStatusLabel(
  status: NonNullable<NormalizedAssessmentPostFinding["verificationStatus"]>,
) {
  if (status === VERIFICATION_RESULT_STATUSES.passed) {
    return t("pages.assessmentFlow.postFinding.verificationPassed");
  }
  return t(`pages.assessmentFlow.postFinding.verificationStatuses.${status}`);
}

function isAvailableDecision(
  value: string,
  availableDecisions: RemediationDecision[],
): value is RemediationDecision {
  return (availableDecisions as string[]).includes(value);
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
