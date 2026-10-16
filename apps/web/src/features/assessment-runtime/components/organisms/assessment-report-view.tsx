"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_ARTIFACT_KINDS } from "@lcsp/contracts/assessment-domain";
import {
  buildAssessmentReportPresentation,
  type AssessmentReportV1Presentation,
  type AssessmentReportV2Presentation,
} from "@lcsp/contracts/assessment-report";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  useAssessmentDetailQuery,
  useAssessmentReportQuery,
} from "@/lib/api/assessment-domain-queries";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "../molecules/assessment-report-actions";

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">
        {value ?? copy("labels.unavailable")}
      </dd>
    </div>
  );
}

function References({
  references,
}: {
  references: Array<{
    reference: { type: string; factId?: string; evidenceId?: string };
  }>;
}) {
  if (references.length === 0) return <span>{copy("labels.unavailable")}</span>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {references.map((item, index) => (
        <li
          key={`${item.reference.type}-${item.reference.factId ?? item.reference.evidenceId ?? index}`}
        >
          <code className="break-all text-xs">
            {item.reference.factId ??
              item.reference.evidenceId ??
              item.reference.type}
          </code>
        </li>
      ))}
    </ul>
  );
}

function V1Report({ model }: { model: AssessmentReportV1Presentation }) {
  return (
    <>
      <p className="rounded-md border bg-muted/30 p-3 text-sm">
        {copy("v1Compatibility")}
      </p>
      <section
        className="flex flex-col gap-2"
        aria-labelledby="report-v1-summary"
      >
        <h2 id="report-v1-summary" className="text-lg font-semibold">
          {copy("summary")}
        </h2>
        <p className="whitespace-pre-wrap text-sm">{model.legacy.summary}</p>
      </section>
      <section
        className="flex flex-col gap-4"
        aria-labelledby="report-v1-findings"
      >
        <h2 id="report-v1-findings" className="text-lg font-semibold">
          {copy("findings")}
        </h2>
        <ul className="flex flex-col gap-5">
          {model.legacy.findings.map((finding) => (
            <li
              key={finding.decisionId}
              className="flex flex-col gap-2 border-b pb-4"
              data-finding-rule={finding.assessmentRuleId}
            >
              <h3 className="font-medium">{finding.assessmentRuleId}</h3>
              <p className="whitespace-pre-wrap text-sm">{finding.summary}</p>
              {finding.recommendations.length > 0 ? (
                <ul className="list-disc pl-5 text-sm">
                  {finding.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function V2Report({ model }: { model: AssessmentReportV2Presentation }) {
  const labels = (key: string) => copy(`labels.${key}`);
  return (
    <>
      <section
        className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2"
        aria-label={copy("title")}
      >
        <Field
          label={labels("assessmentId")}
          value={model.header.assessmentId}
        />
        <Field label={labels("artifactId")} value={model.header.artifactId} />
        <Field
          label={labels("schemaVersion")}
          value={model.header.schemaVersion}
        />
        <Field
          label={labels("repository")}
          value={model.header.repositorySnapshotId}
        />
        <Field label={labels("commit")} value={model.header.repositoryCommit} />
        <Field
          label={labels("legalSource")}
          value={`${model.header.legalSourceVersion} (${model.header.legalSourceVersionId})`}
        />
        <Field
          label={labels("ruleSet")}
          value={`${model.header.ruleSetVersion} (${model.header.ruleSetVersionId})`}
        />
        <Field
          label={copy("labels.published")}
          value={model.header.publicationState}
        />
      </section>
      <section
        id="report-result"
        className="flex scroll-mt-6 flex-col gap-4"
        aria-labelledby="report-section-result"
      >
        <h2 id="report-section-result" className="text-lg font-semibold">
          {copy("sections.result")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-4">
          <Field label={labels("total")} value={model.summary.totalRules} />
          <Field
            label={labels("compliant")}
            value={model.summary.applicableCompliant}
          />
          <Field
            label={labels("nonCompliant")}
            value={model.summary.applicableNonCompliant}
          />
          <Field
            label={labels("notApplicable")}
            value={model.summary.notApplicable}
          />
        </dl>
        <p className="text-sm">
          {model.summary.statement === "NO_NON_COMPLIANT_FINDINGS"
            ? labels("noFindings")
            : `${labels("nonCompliant")}: ${model.summary.applicableNonCompliant}`}
        </p>
        {model.summary.priorityIssues.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3">{labels("obligation")}</th>
                  <th className="p-3">{labels("rationale")}</th>
                  <th className="p-3">{labels("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {model.summary.priorityIssues.map((issue) => (
                  <tr key={issue.assessmentRuleId} className="border-t">
                    <td className="p-3">{issue.obligation}</td>
                    <td className="p-3">{issue.issue}</td>
                    <td className="p-3">
                      {issue.action || labels("unavailable")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <section
        id="report-applicability-facts"
        className="flex scroll-mt-6 flex-col gap-4"
        aria-labelledby="report-section-applicability"
      >
        <h2 id="report-section-applicability" className="text-lg font-semibold">
          {copy("sections.applicabilityFacts")}
        </h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-3">{labels("conditions")}</th>
                <th className="p-3">{labels("facts")}</th>
                <th className="p-3">{labels("evidence")}</th>
              </tr>
            </thead>
            <tbody>
              {model.applicabilityFacts.map((item) => (
                <tr key={item.assessmentRuleId} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">{item.assessmentRuleId}</div>
                    {item.conditions.length ? (
                      <ul className="list-disc pl-5">
                        {item.conditions.map((condition) => (
                          <li key={condition}>{condition}</li>
                        ))}
                      </ul>
                    ) : (
                      labels("unavailable")
                    )}
                  </td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {item.acceptedFactIds.map((id) => (
                        <li key={id}>
                          <code className="break-all text-xs">{id}</code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {item.acceptedEvidenceIds.map((id) => (
                        <li key={id}>
                          <code className="break-all text-xs">{id}</code>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id="report-obligation-catalog"
        className="flex scroll-mt-6 flex-col gap-4"
        aria-labelledby="report-section-catalog"
      >
        <h2 id="report-section-catalog" className="text-lg font-semibold">
          {copy("sections.obligationCatalog")}
        </h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-3">{labels("obligation")}</th>
                <th className="p-3">{labels("rule")}</th>
                <th className="p-3">{labels("applicability")}</th>
                <th className="p-3">{labels("compliance")}</th>
              </tr>
            </thead>
            <tbody>
              {model.obligationCatalog.map((item) => (
                <tr key={item.assessmentRuleId} className="border-t">
                  <td className="p-3">{item.legalRequirementIds.join(", ")}</td>
                  <td className="p-3">
                    <a
                      className="underline"
                      href={`#report-rule-${encodeURIComponent(item.assessmentRuleId)}`}
                    >
                      {item.assessmentRuleId}
                    </a>
                  </td>
                  <td className="p-3">{item.applicability}</td>
                  <td className="p-3">{item.compliance ?? labels("na")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id="report-obligation-details"
        className="flex scroll-mt-6 flex-col gap-5"
        aria-labelledby="report-section-details"
      >
        <h2 id="report-section-details" className="text-lg font-semibold">
          {copy("sections.obligationDetails")}
        </h2>
        {model.obligationDetails.map((detail) => (
          <article
            id={`report-rule-${encodeURIComponent(detail.assessmentRuleId)}`}
            key={detail.assessmentRuleId}
            className="flex scroll-mt-6 flex-col gap-3 rounded-lg border p-4"
          >
            <h3 className="text-base font-semibold">
              {detail.assessmentRuleId}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h4 className="text-xs text-muted-foreground">
                  {labels("obligation")}
                </h4>
                <ul className="list-disc pl-5 text-sm">
                  {detail.legalRequirements.map((item) => (
                    <li key={item.id}>
                      {item.title}: {item.proposition}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs text-muted-foreground">
                  {labels("applicability")}
                </h4>
                <p className="text-sm">{detail.applicability}</p>
                <p className="text-sm">{detail.compliance ?? labels("na")}</p>
              </div>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("conditions")}
              </h4>
              <p className="whitespace-pre-wrap text-sm">
                {[
                  ...detail.conditions,
                  ...detail.qualifiers,
                  ...detail.exceptions,
                  detail.applicabilityGuidance,
                ]
                  .filter(Boolean)
                  .join("\n") || labels("unavailable")}
              </p>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("observedFacts")}
              </h4>
              <p className="break-words text-sm">
                {detail.observedFactIds.join(", ") || labels("unavailable")}
              </p>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("rationale")}
              </h4>
              <p className="whitespace-pre-wrap text-sm">{detail.rationale}</p>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("legalBasis")}
              </h4>
              <ul className="list-disc pl-5 text-sm">
                {detail.legalReferences.map((reference) => (
                  <li key={`${reference.documentId}-${reference.locator}`}>
                    <span className="break-words">
                      {reference.documentId} · {reference.locator} ·{" "}
                      {reference.contentSha256}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("references")}
              </h4>
              <References references={detail.decisionReferences} />
              {detail.criterionDecisions.map((criterion) => (
                <div key={criterion.criterionId} className="mt-2">
                  <p className="text-xs text-muted-foreground">
                    {criterion.criterionId}
                  </p>
                  <References references={criterion.references} />
                </div>
              ))}
            </div>
            {detail.recommendations.length > 0 ? (
              <div>
                <h4 className="text-xs text-muted-foreground">
                  {labels("actions")}
                </h4>
                <ul className="list-disc pl-5 text-sm">
                  {detail.recommendations.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      <section
        id="report-action-plan"
        className="flex scroll-mt-6 flex-col gap-4"
        aria-labelledby="report-section-actions"
      >
        <h2 id="report-section-actions" className="text-lg font-semibold">
          {copy("sections.actionPlan")}
        </h2>
        {model.actionPlan.length ? (
          <ul className="flex flex-col gap-3">
            {model.actionPlan.map((item) => (
              <li key={item.assessmentRuleId} className="rounded-md border p-3">
                <p className="font-medium">{item.obligation}</p>
                <ul className="list-disc pl-5 text-sm">
                  {item.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{labels("empty")}</p>
        )}
      </section>
      <section
        id="report-scope-traceability"
        className="flex scroll-mt-6 flex-col gap-4"
        aria-labelledby="report-section-traceability"
      >
        <h2 id="report-section-traceability" className="text-lg font-semibold">
          {copy("sections.scopeTraceability")}
        </h2>
        <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Field
            label={labels("assessmentId")}
            value={model.scopeTraceability.assessmentId}
          />
          <Field
            label={labels("artifactId")}
            value={model.scopeTraceability.artifactId}
          />
          <Field
            label={labels("schemaVersion")}
            value={model.scopeTraceability.schemaVersion}
          />
          <Field
            label={labels("repository")}
            value={model.scopeTraceability.repositorySnapshotId}
          />
          <Field
            label={labels("commit")}
            value={model.scopeTraceability.repositoryCommit}
          />
          <Field
            label={labels("legalSource")}
            value={`${model.scopeTraceability.legalSourceVersion} (${model.scopeTraceability.legalSourceVersionId})`}
          />
          <Field
            label={labels("ruleSet")}
            value={`${model.scopeTraceability.ruleSetVersion} (${model.scopeTraceability.ruleSetVersionId})`}
          />
          <Field label={labels("limitations")} value={labels("unavailable")} />
        </dl>
        <p className="break-words text-xs text-muted-foreground">
          {labels("rule")}:{" "}
          {model.scopeTraceability.assessmentRuleIds.join(", ")}
        </p>
      </section>
    </>
  );
}

export function AssessmentReportView({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const artifact = detail.data?.case?.artifacts.find(
    (item) =>
      item.kind === ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT &&
      item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  const report = useAssessmentReportQuery(
    assessmentId,
    artifact?.artifactId ?? null,
  );
  const back = (
    <Link
      href={`/assessments/${encodeURIComponent(assessmentId)}`}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {copy("back")}
    </Link>
  );
  if (detail.isPending || (artifact && report.isPending))
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        {copy("loading")}
      </p>
    );
  if (detail.isError || !artifact || report.isError || !report.data)
    return (
      <div className="flex flex-col gap-3 p-6">
        {back}
        <Alert variant="destructive">
          <AlertDescription>{copy("failed")}</AlertDescription>
        </Alert>
      </div>
    );
  const model = buildAssessmentReportPresentation(report.data);
  return (
    <article
      data-slot="assessment-report"
      className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-6 overflow-y-auto px-4 py-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <AssessmentReportActions
          assessmentId={assessmentId}
          artifactId={model.header.artifactId}
          pdfSupported={!("legacy" in model)}
        />
      </header>
      <h1 className="text-2xl font-semibold tracking-tight">{copy("title")}</h1>
      {"legacy" in model ? (
        <V1Report model={model} />
      ) : (
        <V2Report model={model} />
      )}
    </article>
  );
}
