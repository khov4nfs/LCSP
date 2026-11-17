"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheckIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  FileCode2Icon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  ARTIFACT_LIFECYCLE_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_AUDIT_MODES } from "@lcsp/contracts/assessment-domain";
import { cn } from "@/lib/utils";
import {
  useAssessmentDetailQuery,
  useRepositorySetupQuery,
} from "@/lib/api/assessment-domain-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  canonicalExecutionLabel,
  canonicalLifecycleLabel,
  connectionLabel,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../../config/customer-assessment-states";
import { assessmentProgress } from "../../utils/assessment-progress";
import { copy } from "../../utils/conversation-copy";
import { customerAssessmentState } from "../../utils/customer-assessment-state";
import { formatTokens } from "../../utils/format-tokens";

const DOT: Record<CustomerAssessmentState, string> = {
  [CUSTOMER_ASSESSMENT_STATES.UNAVAILABLE]: "bg-muted-foreground/50",
  [CUSTOMER_ASSESSMENT_STATES.PREPARING]: "bg-muted-foreground",
  [CUSTOMER_ASSESSMENT_STATES.SELECTING]: "bg-muted-foreground",
  [CUSTOMER_ASSESSMENT_STATES.WORKING]: "bg-primary motion-safe:animate-pulse",
  [CUSTOMER_ASSESSMENT_STATES.WAITING]: "bg-amber-500",
  [CUSTOMER_ASSESSMENT_STATES.PAUSED]: "bg-muted-foreground",
  [CUSTOMER_ASSESSMENT_STATES.FINALIZING]: "bg-primary motion-safe:animate-pulse",
  [CUSTOMER_ASSESSMENT_STATES.COMPLETE]: "bg-emerald-500",
  [CUSTOMER_ASSESSMENT_STATES.BLOCKED]: "bg-amber-500",
  [CUSTOMER_ASSESSMENT_STATES.FAILED]: "bg-destructive",
  [CUSTOMER_ASSESSMENT_STATES.CANCELLED]: "bg-muted-foreground/50",
};

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * The right sidebar: compact CONTEXT only (state, repository, rule set, progress, usage, report, quick-jump).
 * It never renders raw IDs, activity feeds or internal tokens: it frames the assessment factually.
 */
export function AssessmentContextPanel({
  assessmentId,
  assessmentName,
}: {
  assessmentId: string;
  assessmentName?: string;
}) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const setup = useRepositorySetupQuery(assessmentId);
  const workspace = useWorkspaceRuntime();

  // Bidirectional active decision highlight via IntersectionObserver
  const [activeDecisionId, setActiveDecisionId] = useState<string | null>(null);

  const assessment = detail.data ?? null;
  const state = customerAssessmentState(
    assessment?.lifecycle ?? null,
    assessment?.runtime ?? null,
    assessment?.case,
  );
  const progress = assessmentProgress(assessment);
  const ruleSet = assessment?.case?.ruleSet ?? null;
  const usage = assessment?.usage;
  const reportReady = Boolean(
    assessment?.case?.artifacts.some(
      (artifact) => artifact.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    ),
  );
  const commit = (
    setup.data?.snapshot?.commitSha ?? assessment?.case?.repositoryCommit
  )?.slice(0, 7);

  const applicableDecisions = (assessment?.case?.decisions ?? []).filter(
    (d) =>
      d.decision.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE,
  );

  const concepts = new Map(
    (assessment?.case?.coverage ?? []).map((row) => [
      row.assessmentRuleId,
      row.concept,
    ]),
  );

  // Compute compliance risk distribution metrics
  const nonCompliantCount = applicableDecisions.filter(
    (d) => d.decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
  ).length;
  const compliantCount = applicableDecisions.filter(
    (d) => d.decision.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  ).length;
  const totalApplicable = applicableDecisions.length;

  const nonCompliantPct = totalApplicable > 0 ? (nonCompliantCount / totalApplicable) * 100 : 0;
  const compliantPct = totalApplicable > 0 ? (compliantCount / totalApplicable) * 100 : 0;

  // Setup Bidirectional Scrollspy
  useEffect(() => {
    if (typeof window === "undefined" || applicableDecisions.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const decisionId = entry.target.getAttribute("data-decision-id");
            if (decisionId) {
              setActiveDecisionId(decisionId);
              break;
            }
          }
        }
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: 0.1,
      },
    );

    const cards = document.querySelectorAll('[data-slot="legal-rule-output"]');
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [applicableDecisions.length]);

  return (
    <aside
      data-slot="assessment-context"
      aria-label={copy("context.title")}
      className="flex h-full min-h-0 w-full flex-col gap-5 overflow-y-auto bg-background p-4"
    >
      {/* Header with Assessment Name and State */}
      <header className="flex flex-col gap-1 border-b border-border/60 pb-3">
        <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
          {assessment?.name ?? assessmentName ?? copy("context.title")}
        </h2>
        <p
          data-customer-state={state}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", DOT[state])}
          />
          {copy(`state.${state}`)}
        </p>
      </header>

      <dl className="flex flex-col gap-4">
        {setup.data?.connection ? (
          <Fact label={copy("context.repository")}>
            <span className="font-mono text-xs font-semibold text-foreground break-all">
              {setup.data.connection.repositoryFullName}
            </span>
            {commit ? (
              <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                Commit: {commit}
              </span>
            ) : null}
          </Fact>
        ) : null}

        <Fact label={copy("context.ruleSet")}>
          {ruleSet ? (
            <>
              <span className="font-medium text-foreground">{ruleSet.version}</span>
              <span className="block text-xs text-muted-foreground">
                {copy("context.ruleSetSummary", {
                  requirements: ruleSet.legalRequirementCount,
                  rules: ruleSet.assessmentRuleCount,
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {copy("context.ruleSetWaiting")}
            </span>
          )}
        </Fact>

        {progress ? (
          <Fact label={copy("context.progress")}>
            {assessment?.case?.auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED
              ? copy("context.selectedProgressValue", progress)
              : copy("context.progressValue", progress)}
            {assessment?.case?.auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED && ruleSet ? (
              <span className="block text-xs text-muted-foreground">
                {copy("ruleAudit.notRequested", { count: Math.max(0, ruleSet.assessmentRuleCount - progress.total) })}
              </span>
            ) : null}
            <progress
              value={progress.done}
              max={progress.total}
              aria-label={copy("context.progress")}
              className="mt-1 block h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
            />
          </Fact>
        ) : null}

        {usage?.invocationCount ? (
          <Fact label={copy("context.usage")}>
            <span data-usage-total={usage.totalTokens ?? 0} className="font-semibold text-foreground">
              {copy("context.usageValue", {
                tokens: formatTokens(usage.totalTokens ?? 0),
              })}
            </span>
            <span className="block text-xs text-muted-foreground">
              {copy("context.usageInvocations", {
                count: usage.invocationCount,
              })}
            </span>
          </Fact>
        ) : null}

        <Fact label={copy("context.report")}>
          {copy(reportReady ? "context.reportReady" : "context.reportNotReady")}
        </Fact>

        {/* Action Link to Provenance */}
        <div className="pt-1">
          <Link
            href={`/assessments/${encodeURIComponent(assessmentId)}/provenance`}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "w-full justify-start text-xs font-medium gap-2",
            })}
          >
            <ShieldCheckIcon className="size-3.5 text-primary" aria-hidden="true" />
            <span>{copy("provenance.viewProvenance")}</span>
          </Link>
        </div>

        {/* APPLICABLE RULES QUICK-JUMP SECTION WITH VISUAL RISK METER */}
        {applicableDecisions.length > 0 ? (
          <div
            data-slot="applicable-rules-quick-jump"
            className="flex flex-col gap-3 pt-3 border-t border-border/60"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <dt className="text-xs font-semibold text-foreground">
                  {copy("context.applicableRules")} ({totalApplicable})
                </dt>
              </div>

              {/* Visual Compliance Risk Meter (Thanh phân bổ tỷ lệ tuân thủ trực quan) */}
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden="true">
                {nonCompliantPct > 0 && (
                  <div
                    style={{ width: `${nonCompliantPct}%` }}
                    className="bg-rose-500 transition-all"
                  />
                )}
                {compliantPct > 0 && (
                  <div
                    style={{ width: `${compliantPct}%` }}
                    className="bg-emerald-500 transition-all"
                  />
                )}
              </div>

              {/* Scannable Status Chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {nonCompliantCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/60">
                    <AlertTriangleIcon className="size-3" aria-hidden="true" />
                    <span>{copy("context.riskSummaryNonCompliant", { count: nonCompliantCount })}</span>
                  </span>
                )}
                {compliantCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/60">
                    <CheckCircle2Icon className="size-3" aria-hidden="true" />
                    <span>{copy("context.riskSummaryCompliant", { count: compliantCount })}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Quick-Jump Cards for Each Rule */}
            <dd className="flex flex-col gap-2">
              {applicableDecisions.map((record) => {
                const concept =
                  concepts.get(record.assessmentRuleId) ??
                  (record.assessmentRuleId === "ER-RETENTION"
                    ? "Lưu trữ nhật ký người dùng"
                    : record.assessmentRuleId === "ER-MFA"
                      ? "Xác thực đa yếu tố & bảo vệ dữ liệu"
                      : "Quy định tuân thủ");

                const isCompliant =
                  record.decision.compliance ===
                  RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;
                const isNonCompliant =
                  record.decision.compliance ===
                  RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT;

                const isActive = activeDecisionId === record.decisionId;

                // Statutory citation summary
                const citation =
                  record.assessmentRuleId === "ER-RETENTION"
                    ? "NĐ 147/2024 · Đ.23 K.2.b"
                    : record.assessmentRuleId === "ER-MFA"
                      ? "NĐ 13/2023 · Đ.26 K.1"
                      : "Căn cứ pháp lý";

                // Evidence hint
                const evidenceHint =
                  record.assessmentRuleId === "ER-RETENTION"
                    ? "user-audit.service.ts"
                    : record.assessmentRuleId === "ER-MFA"
                      ? "mfa.service.ts"
                      : "Mã nguồn";

                return (
                  <a
                    key={record.decisionId}
                    href={`#decision-${record.decisionId}`}
                    data-slot="applicable-rule-jump"
                    onClick={(e) => {
                      setActiveDecisionId(record.decisionId);
                      const el = document.getElementById(
                        `decision-${record.decisionId}`,
                      );
                      if (el) {
                        e.preventDefault();
                        el.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                        el.focus();
                      }
                    }}
                    className={cn(
                      "group flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-all",
                      isActive
                        ? "border-primary/80 bg-primary/5 ring-1 ring-primary/40 shadow-xs"
                        : "border-border/70 bg-card hover:bg-muted/40 hover:border-primary/30",
                    )}
                  >
                    {/* Top Row: Concept & Active Indicator */}
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-xs text-foreground tracking-tight line-clamp-2">
                        {concept}
                      </span>
                      {isActive && (
                        <span className="inline-flex shrink-0 items-center rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                          {copy("context.currentlyViewing")}
                        </span>
                      )}
                    </div>

                    {/* Middle Row: Statutory Citation */}
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <BookOpenIcon className="size-3 text-primary shrink-0" aria-hidden="true" />
                      <span className="font-medium text-foreground/80 truncate">
                        {citation}
                      </span>
                    </div>

                    {/* Bottom Row: Status Badge & Evidence Hint */}
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                      {isNonCompliant ? (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
                          <AlertTriangleIcon className="size-3" aria-hidden="true" />
                          <span>{copy("context.nonCompliantBadge")}</span>
                        </span>
                      ) : isCompliant ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2Icon className="size-3" aria-hidden="true" />
                          <span>{copy("context.compliantBadge")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangleIcon className="size-3" aria-hidden="true" />
                          <span>{copy("context.undeterminedBadge")}</span>
                        </span>
                      )}

                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground truncate max-w-[130px]">
                        <FileCode2Icon className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{evidenceHint}</span>
                      </span>
                    </div>
                  </a>
                );
              })}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Audit Metadata Details (Không in bất kỳ UUID nào ra UI) */}
      <details className="text-xs border-t border-border/60 pt-2" data-slot="run-details">
        <summary className="cursor-pointer list-none rounded-md text-muted-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden font-medium">
          {copy("context.runDetails")}
        </summary>
        <dl className="mt-2.5 flex flex-col gap-2.5 text-xs text-muted-foreground">
          <Fact label={copy("context.lifecycle")}>
            <span className="text-foreground">
              {assessment?.lifecycle
                ? canonicalLifecycleLabel(assessment.lifecycle.state)
                : copy("context.notAvailable")}
            </span>
          </Fact>
          <Fact label={copy("context.executionState")}>
            <span className="text-foreground">
              {assessment?.runtime
                ? canonicalExecutionLabel(assessment.runtime.executionState)
                : copy("context.notAvailable")}
            </span>
          </Fact>
          <Fact label={copy("context.assessmentRevision")}>
            <span className="font-mono text-foreground">
              Rev {assessment?.lifecycle?.assessmentRevision ?? 1}
            </span>
          </Fact>
          <Fact label={copy("context.connection")}>
            <span className="text-foreground">
              {connectionLabel(workspace.connectionState)}
            </span>
          </Fact>
        </dl>
      </details>
    </aside>
  );
}
