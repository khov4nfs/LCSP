"use client";

import {
  ASSESSMENT_ARTIFACT_STATUSES,
  ASSESSMENT_ARTIFACT_TYPES,
  BUSINESS_CONTEXT_DIMENSIONS,
  BUSINESS_CONTEXT_DIMENSION_STATUSES,
  INVESTIGATION_ASSESSMENT_OUTCOMES,
  INVESTIGATION_EVIDENCE_QUALITIES,
  INVESTIGATION_EXECUTION_STATUSES,
  INVESTIGATION_RULE_OUTCOMES,
  type BusinessContextArtifact,
  type InvestigationNotesArtifact,
  type InvestigationRuleNote,
} from "@lcsp/contracts/evidence";
import type { MessageKey } from "@lcsp/i18n";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { resolveAppMessage } from "@/lib/i18n";

export type AssessmentTextArtifact =
  | BusinessContextArtifact
  | InvestigationNotesArtifact;

export function AssessmentTextArtifactDialog({
  artifact,
  loading,
  open,
  onOpenChange,
}: {
  artifact: AssessmentTextArtifact | null;
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const title = artifact
    ? resolveAppMessage(
        artifact.type === ASSESSMENT_ARTIFACT_TYPES.businessContext
          ? "pages.artifacts.types.businessContext"
          : "pages.artifacts.types.investigationNotes",
      )
    : resolveAppMessage("pages.artifacts.title");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[min(820px,calc(100vh-2rem))] w-[min(900px,calc(100vw-2rem))] max-w-none gap-0 p-0"
      >
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between border-b border-border/70 px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={resolveAppMessage("pages.artifacts.viewer.close")}
          >
            <XIcon />
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-label={resolveAppMessage("pages.artifacts.viewer.loading")} />
              <span>{resolveAppMessage("pages.artifacts.viewer.loading")}</span>
            </div>
          ) : !artifact ||
            artifact.status !== ASSESSMENT_ARTIFACT_STATUSES.ready ||
            !artifact.content ? (
            <p className="text-sm text-muted-foreground">
              {resolveAppMessage("pages.artifacts.viewer.unavailable")}
            </p>
          ) : artifact.type === ASSESSMENT_ARTIFACT_TYPES.businessContext ? (
            <BusinessContextView artifact={artifact} />
          ) : (
            <InvestigationNotesView artifact={artifact} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BusinessContextView({ artifact }: { artifact: BusinessContextArtifact }) {
  if (!artifact.content) return null;
  const unknown = new Set(artifact.content.unknownDimensions);
  return (
    <div className="space-y-6">
      <ArtifactMetadata
        generatedAt={artifact.generatedAt}
        updatedAt={artifact.updatedAt}
        items={[
          [resolveAppMessage("pages.artifacts.viewer.revision"), artifact.identity.contextRevision],
          [resolveAppMessage("pages.artifacts.viewer.sourceVersion"), artifact.identity.sourceVersion],
          [resolveAppMessage("pages.artifacts.viewer.pgeVersion"), artifact.identity.pgeVersion],
        ]}
      />

      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.artifacts.viewer.confirmedContext")}
        </h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {artifact.content.dimensions.map((dimension) => (
            <div
              key={dimension.dimension}
              className="rounded-lg border border-border/60 bg-card p-3"
            >
              <p className="text-xs font-medium">
                {businessDimensionLabel(dimension.dimension)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {dimension.status === BUSINESS_CONTEXT_DIMENSION_STATUSES.confirmed
                  ? resolveAppMessage("pages.artifacts.viewer.confirmed")
                  : resolveAppMessage("pages.artifacts.viewer.unknown")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.artifacts.viewer.confirmedContext")}
        </h3>
        {artifact.content.confirmedStatements.length ? (
          <div className="mt-3 space-y-3">
            {artifact.content.confirmedStatements.map((statement, index) => (
              <article
                key={`${statement.confirmedAt}-${index}`}
                className="rounded-lg border border-border/60 bg-card p-4"
              >
                <p className="text-xs font-semibold text-muted-foreground">
                  {statement.topic}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {statement.statement}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{statement.scope}</p>
                {statement.evidenceRefs.length ? (
                  <PublicReferenceList
                    label={resolveAppMessage("pages.artifacts.viewer.evidenceReferences")}
                    values={statement.evidenceRefs}
                  />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {resolveAppMessage("pages.artifacts.viewer.noStatements")}
          </p>
        )}
      </section>

      {unknown.size ? (
        <section>
          <h3 className="text-sm font-semibold">
            {resolveAppMessage("pages.artifacts.viewer.unknownContext")}
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {[...unknown].map((dimension) => (
              <li
                key={dimension}
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                {businessDimensionLabel(dimension)} · {resolveAppMessage("pages.artifacts.viewer.unknown")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function InvestigationNotesView({ artifact }: { artifact: InvestigationNotesArtifact }) {
  if (!artifact.content) return null;
  const { summary } = artifact.content;
  const summaryItems = [
    ["candidateRules", summary.candidateRules],
    ["selectedRules", summary.selectedRules],
    ["investigatedRules", summary.investigatedRules],
    ["pendingRules", summary.pendingRules],
    ["waitingRules", summary.waitingRules],
    ["domainLimitedRules", summary.domainLimitedRules],
    ["runtimeFailedRules", summary.runtimeFailedRules],
  ] as const;
  return (
    <div className="space-y-6">
      <ArtifactMetadata
        generatedAt={artifact.generatedAt}
        updatedAt={artifact.updatedAt}
        items={[
          [resolveAppMessage("pages.artifacts.viewer.revision"), artifact.identity.contextRevisionUsed],
        ]}
      />

      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.artifacts.viewer.investigationSummary")}
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summaryItems.map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border/60 bg-card p-3">
              <dt className="text-xs text-muted-foreground">
                {resolveAppMessage(`pages.artifacts.viewer.${key}` as MessageKey)}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
          <SummaryStatus
            label={resolveAppMessage("pages.artifacts.viewer.executionStatus")}
            value={executionStatusLabel(artifact.content.executionStatus)}
          />
          <SummaryStatus
            label={resolveAppMessage("pages.artifacts.viewer.assessmentOutcome")}
            value={assessmentOutcomeLabel(artifact.content.assessmentOutcome)}
          />
          <SummaryStatus
            label={resolveAppMessage("pages.artifacts.viewer.evidenceQuality")}
            value={evidenceQualityLabel(artifact.content.evidenceQuality)}
          />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.artifacts.viewer.findings")}
        </h3>
        {artifact.content.rules.length ? (
          <div className="mt-3 space-y-3">
            {artifact.content.rules.map((rule, index) => (
              <RuleNote rule={rule} index={index} key={rule.key} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {resolveAppMessage("pages.artifacts.viewer.noRules")}
          </p>
        )}
      </section>

      {artifact.content.limitations.length ? (
        <PublicReferenceList
          label={resolveAppMessage("pages.artifacts.viewer.limitations")}
          values={artifact.content.limitations}
        />
      ) : null}
    </div>
  );
}

function RuleNote({ rule, index }: { rule: InvestigationRuleNote; index: number }) {
  return (
    <article className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-semibold">{rule.title ?? `#${index + 1}`}</h4>
        <span className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
          {ruleOutcomeLabel(rule.outcome)}
        </span>
      </div>
      {rule.findingSummary ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{rule.findingSummary}</p>
      ) : null}
      {rule.evidenceRefs.length ? (
        <PublicReferenceList
          label={resolveAppMessage("pages.artifacts.viewer.evidenceReferences")}
          values={rule.evidenceRefs}
        />
      ) : null}
      {rule.sourceAnchors.length ? (
        <PublicReferenceList
          label={resolveAppMessage("pages.artifacts.viewer.sourceAnchors")}
          values={rule.sourceAnchors}
        />
      ) : null}
      {rule.limitations.length ? (
        <PublicReferenceList
          label={resolveAppMessage("pages.artifacts.viewer.limitations")}
          values={rule.limitations}
        />
      ) : null}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <SummaryStatus
          label={resolveAppMessage("pages.artifacts.viewer.customerContextRequested")}
          value={yesNo(rule.customerContextRequested)}
        />
        <SummaryStatus
          label={resolveAppMessage("pages.artifacts.viewer.customerContextResolved")}
          value={yesNo(rule.customerContextResolved)}
        />
      </dl>
    </article>
  );
}

function ArtifactMetadata({
  generatedAt,
  updatedAt,
  items,
}: {
  generatedAt: string | null;
  updatedAt: string | null;
  items: Array<[string, string | number | null]>;
}) {
  const visible = items.filter(([, value]) => value !== null && value !== "");
  return (
    <dl className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-2">
      {visible.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words font-medium">{String(value)}</dd>
        </div>
      ))}
      {generatedAt ? (
        <div>
          <dt className="text-muted-foreground">{resolveAppMessage("pages.artifacts.viewer.generated")}</dt>
          <dd className="mt-1 font-medium">{new Date(generatedAt).toLocaleString()}</dd>
        </div>
      ) : null}
      {updatedAt ? (
        <div>
          <dt className="text-muted-foreground">{resolveAppMessage("pages.artifacts.viewer.updated")}</dt>
          <dd className="mt-1 font-medium">{new Date(updatedAt).toLocaleString()}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function SummaryStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function PublicReferenceList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
        {values.map((value, index) => (
          <li key={`${value}-${index}`} className="break-words">
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function businessDimensionLabel(dimension: string): string {
  switch (dimension) {
    case BUSINESS_CONTEXT_DIMENSIONS.aiUsage:
      return resolveAppMessage("pages.artifacts.viewer.dimensionAiUsage");
    case BUSINESS_CONTEXT_DIMENSIONS.operationalProcess:
      return resolveAppMessage("pages.artifacts.viewer.dimensionOperationalProcess");
    case BUSINESS_CONTEXT_DIMENSIONS.decisionInfluence:
      return resolveAppMessage("pages.artifacts.viewer.dimensionDecisionInfluence");
    case BUSINESS_CONTEXT_DIMENSIONS.humanOversight:
      return resolveAppMessage("pages.artifacts.viewer.dimensionHumanOversight");
    case BUSINESS_CONTEXT_DIMENSIONS.affectedSubjects:
      return resolveAppMessage("pages.artifacts.viewer.dimensionAffectedSubjects");
    case BUSINESS_CONTEXT_DIMENSIONS.dataCategories:
      return resolveAppMessage("pages.artifacts.viewer.dimensionDataCategories");
    default:
      return resolveAppMessage("pages.artifacts.viewer.unknown");
  }
}

function executionStatusLabel(status: string): string {
  switch (status) {
    case INVESTIGATION_EXECUTION_STATUSES.completed:
      return resolveAppMessage("pages.artifacts.viewer.completed");
    case INVESTIGATION_EXECUTION_STATUSES.interrupted:
      return resolveAppMessage("pages.artifacts.viewer.interrupted");
    default:
      return resolveAppMessage("pages.artifacts.viewer.inProgress");
  }
}

function assessmentOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case INVESTIGATION_ASSESSMENT_OUTCOMES.compliant:
      return resolveAppMessage("pages.artifacts.viewer.compliant");
    case INVESTIGATION_ASSESSMENT_OUTCOMES.nonCompliant:
      return resolveAppMessage("pages.artifacts.viewer.nonCompliant");
    default:
      return resolveAppMessage("pages.artifacts.viewer.unknownOutcome");
  }
}

function evidenceQualityLabel(quality: string): string {
  return quality === INVESTIGATION_EVIDENCE_QUALITIES.evidenceBacked
    ? resolveAppMessage("pages.artifacts.viewer.evidenceBacked")
    : resolveAppMessage("pages.artifacts.viewer.insufficientEvidence");
}

function ruleOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case INVESTIGATION_RULE_OUTCOMES.requirementMet:
      return resolveAppMessage("pages.artifacts.viewer.requirementMet");
    case INVESTIGATION_RULE_OUTCOMES.requirementNotMet:
      return resolveAppMessage("pages.artifacts.viewer.requirementNotMet");
    case INVESTIGATION_RULE_OUTCOMES.unresolved:
      return resolveAppMessage("pages.artifacts.viewer.unresolved");
    case INVESTIGATION_RULE_OUTCOMES.runtimeError:
      return resolveAppMessage("pages.artifacts.viewer.runtimeError");
    case INVESTIGATION_RULE_OUTCOMES.waitingForContext:
      return resolveAppMessage("pages.artifacts.viewer.waitingForContext");
    case INVESTIGATION_RULE_OUTCOMES.notApplicable:
      return resolveAppMessage("pages.artifacts.viewer.notApplicable");
    default:
      return resolveAppMessage("pages.artifacts.viewer.pending");
  }
}

function yesNo(value: boolean): string {
  return resolveAppMessage(
    value ? "pages.artifacts.viewer.yes" : "pages.artifacts.viewer.no",
  );
}
