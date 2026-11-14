"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";
import {
  buildAssessmentReportPresentation,
  type AssessmentReportV1Presentation,
  type AssessmentReportV2Presentation,
  type AssessmentReportV3Presentation,
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
  const applicabilityLabel = (value: string) =>
    value === "APPLICABLE" ? labels("applicable") : labels("notApplicable");
  const complianceLabel = (value: string | null) => {
    if (value === "COMPLIANT") return labels("compliantResult");
    if (value === "NON_COMPLIANT") return labels("nonCompliantResult");
    return labels("notApplicable");
  };
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
          value={labels("publishedResult")}
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
                      {item.facts.map((fact) => (
                        <li key={fact.factId}>
                          {fact.statement}{" "}
                          <code className="break-all text-xs">
                            [{fact.factId}]
                          </code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {item.evidence.map((evidence) => (
                        <li key={evidence.evidenceId}>
                          {evidence.type}
                          {evidence.safeLocator
                            ? ` · ${evidence.safeLocator}`
                            : ""}{" "}
                          <code className="break-all text-xs">
                            [{evidence.evidenceId}]
                          </code>
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
                  <td className="p-3">
                    {item.legalRequirements.map((requirement) => (
                      <div key={requirement.id}>
                        <div className="font-medium">{requirement.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {requirement.proposition}
                        </div>
                        <code className="break-all text-xs">
                          {requirement.id}
                        </code>
                      </div>
                    ))}
                  </td>
                  <td className="p-3">
                    <a
                      className="underline"
                      href={`#report-rule-${encodeURIComponent(item.assessmentRuleId)}`}
                    >
                      {item.assessmentRuleId}
                    </a>
                  </td>
                  <td className="p-3">
                    {applicabilityLabel(item.applicability)}
                  </td>
                  <td className="p-3">{complianceLabel(item.compliance)}</td>
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
                <p className="text-sm">
                  {applicabilityLabel(detail.applicability)}
                </p>
                <p className="text-sm">{complianceLabel(detail.compliance)}</p>
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
                {labels("obligation")}
              </h4>
              <p className="text-sm">{detail.concept}</p>
              <p className="text-sm">{detail.legalIntent}</p>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("observedFacts")}
              </h4>
              <p className="break-words text-sm">
                {detail.observedFacts.length
                  ? detail.observedFacts.map((fact) => (
                      <span key={fact.factId} className="block">
                        {fact.statement}{" "}
                        <code className="break-all text-xs">
                          [{fact.factId}]
                        </code>
                      </span>
                    ))
                  : labels("unavailable")}
              </p>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("evidence")}
              </h4>
              {detail.evidence.length
                ? detail.evidence.map((evidence) => (
                    <p
                      key={evidence.evidenceId}
                      className="break-words text-sm"
                    >
                      {evidence.type}
                      {evidence.safeLocator
                        ? ` · ${evidence.safeLocator}`
                        : ""}{" "}
                      · {evidence.contentSha256} [{evidence.evidenceId}]
                    </p>
                  ))
                : labels("unavailable")}
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("criteria")}
              </h4>
              {detail.criterionDecisions.length
                ? detail.criterionDecisions.map((criterion) => (
                    <p key={criterion.criterionId} className="text-sm">
                      {criterion.statement} · {criterion.outcome} ·{" "}
                      {criterion.rationale}
                    </p>
                  ))
                : labels("unavailable")}
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
          <Field
            label={labels("limitations")}
            value={
              model.scopeTraceability.scopeLimitations.join("; ") ||
              labels("unavailable")
            }
          />
        </dl>
        <p className="break-words text-xs text-muted-foreground">
          {labels("rule")}:{" "}
          {model.scopeTraceability.assessmentRuleIds.join(", ")}
        </p>
      </section>
    </>
  );
}

function V3Report({ model }: { model: AssessmentReportV3Presentation }) {
  const labels = (key: string) => copy(`labels.${key}`);
  const applicabilityLabel = (value: string) =>
    value === "APPLICABLE" ? labels("applicable") : labels("notApplicable");
  const complianceLabel = (value: string | null) => {
    if (value === "COMPLIANT") return labels("compliantResult");
    if (value === "NON_COMPLIANT") return labels("nonCompliantResult");
    return labels("notApplicable");
  };
  const isLimited =
    model.header.sourceScope.visibility !== "KNOWN_FULL" ||
    model.header.sourceScope.limitationReasons.length > 0;

  return (
    <>
      {isLimited ? (
        <Alert variant="destructive">
          <AlertDescription>
            {model.header.sourceScope.mode} · {model.header.sourceScope.visibility}
            {model.header.sourcePathPrefix ? ` (${model.header.sourcePathPrefix})` : ""}
            {model.header.sourceScope.limitationReasons.length > 0 ? (
              <span className="mt-1 block text-xs">
                {model.header.sourceScope.limitationReasons.join("; ")}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
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
          label={labels("prefix")}
          value={model.header.sourcePathPrefix ?? labels("unavailable")}
        />
        <Field
          label={labels("legalSource")}
          value={`${model.header.legalSourceVersion} (${model.header.legalSourceVersionId})`}
        />
        <Field
          label={labels("ruleSet")}
          value={`${model.header.ruleSetVersion} (${model.header.ruleSetVersionId})`}
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {labels("totalRules")}
            </div>
            <div className="text-2xl font-semibold">
              {model.summary.totalRules}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {labels("compliant")}
            </div>
            <div className="text-2xl font-semibold text-emerald-600">
              {model.summary.applicableCompliant}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {labels("nonCompliant")}
            </div>
            <div className="text-2xl font-semibold text-rose-600">
              {model.summary.applicableNonCompliant}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {labels("notApplicable")}
            </div>
            <div className="text-2xl font-semibold text-muted-foreground">
              {model.summary.notApplicable}
            </div>
          </div>
        </div>
        <p className="text-sm font-medium">
          {model.summary.statement === "NO_NON_COMPLIANT_FINDINGS"
            ? labels("noNonCompliant")
            : labels("nonCompliantPresent")}
        </p>
        {model.summary.priorityIssues.length ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3">{labels("rule")}</th>
                  <th className="p-3">{labels("obligation")}</th>
                  <th className="p-3">{labels("issue")}</th>
                  <th className="p-3">{labels("action")}</th>
                </tr>
              </thead>
              <tbody>
                {model.summary.priorityIssues.map((item) => (
                  <tr key={item.assessmentRuleId} className="border-t">
                    <td className="p-3 font-medium">{item.assessmentRuleId}</td>
                    <td className="p-3">{item.obligation}</td>
                    <td className="p-3">{item.issue}</td>
                    <td className="p-3">{item.action}</td>
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
                      {item.facts.map((fact) => (
                        <li key={fact.factId}>
                          {fact.statement}{" "}
                          <code className="break-all text-xs">
                            [{fact.factId}]
                          </code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {item.evidence.map((evidence) => (
                        <li key={evidence.evidenceId}>
                          {evidence.type}
                          {evidence.safeLocator
                            ? ` · ${evidence.safeLocator}`
                            : ""}{" "}
                          <code className="break-all text-xs">
                            [{evidence.evidenceId}]
                          </code>
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
                <th className="p-3">{labels("rule")}</th>
                <th className="p-3">{labels("obligations")}</th>
                <th className="p-3">{labels("applicability")}</th>
                <th className="p-3">{labels("compliance")}</th>
              </tr>
            </thead>
            <tbody>
              {model.obligationCatalog.map((item) => (
                <tr key={item.assessmentRuleId} className="border-t">
                  <td className="p-3 font-medium">{item.assessmentRuleId}</td>
                  <td className="p-3">
                    <ul className="list-disc pl-5">
                      {item.legalRequirements.map((requirement) => (
                        <li key={requirement.id}>{requirement.title}</li>
                      ))}
                    </ul>
                    {item.relatedLegalContexts.length ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.relatedLegalContexts
                          .map((ctx) => `${ctx.kind}: ${ctx.toLegalRequirementId}`)
                          .join("; ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    {applicabilityLabel(item.applicability)}
                  </td>
                  <td className="p-3">
                    {complianceLabel(item.compliance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        id="report-obligation-details"
        className="flex scroll-mt-6 flex-col gap-6"
        aria-labelledby="report-section-details"
      >
        <h2 id="report-section-details" className="text-lg font-semibold">
          {copy("sections.obligationDetails")}
        </h2>
        {model.obligationDetails.map((detail) => (
          <article
            key={detail.assessmentRuleId}
            className="flex flex-col gap-4 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
              <h3 className="font-semibold">{detail.assessmentRuleId}</h3>
              <div className="flex gap-2 text-xs">
                <span>{applicabilityLabel(detail.applicability)}</span>
                <span>·</span>
                <span>{complianceLabel(detail.compliance)}</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("obligations")}
              </h4>
              <ul className="list-disc pl-5 text-sm">
                {detail.legalRequirements.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium">{item.title}</span>:{" "}
                    {item.proposition}
                  </li>
                ))}
              </ul>
              {detail.relatedLegalContexts.length ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">{labels("references")}: </span>
                  {detail.relatedLegalContexts
                    .map((ctx) => `${ctx.kind}: ${ctx.toLegalRequirementId}`)
                    .join("; ")}
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={labels("applicabilityGuidance")}
                value={detail.applicabilityGuidance}
              />
              <Field label={labels("rationale")} value={detail.rationale} />
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("observedFacts")}
              </h4>
              <ul className="list-disc pl-5 text-sm">
                {detail.observedFacts.map((fact) => (
                  <li key={fact.factId}>
                    {fact.statement}{" "}
                    <code className="break-all text-xs">
                      [{fact.authority} · {fact.factId}]
                    </code>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs text-muted-foreground">
                {labels("evidence")}
              </h4>
              <ul className="list-disc pl-5 text-sm">
                {detail.evidence.map((evidence) => (
                  <li key={evidence.evidenceId}>
                    {evidence.type}
                    {evidence.safeLocator
                      ? ` · ${evidence.safeLocator}`
                      : ""}{" "}
                    <code className="break-all text-xs">
                      [{evidence.evidenceId}]
                    </code>
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
              <li key={item.actionId} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">
                    {item.priority}
                  </span>
                  <p className="font-medium">{item.obligation}</p>
                </div>
                <p className="mt-1 pl-5 text-sm">{item.action}</p>
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
            label={labels("prefix")}
            value={model.scopeTraceability.sourcePathPrefix ?? labels("unavailable")}
          />
          <Field
            label={labels("legalSource")}
            value={`${model.scopeTraceability.legalSourceVersion} (${model.scopeTraceability.legalSourceVersionId})`}
          />
          <Field
            label={labels("ruleSet")}
            value={`${model.scopeTraceability.ruleSetVersion} (${model.scopeTraceability.ruleSetVersionId})`}
          />
          <Field
            label={labels("limitations")}
            value={
              model.scopeTraceability.scopeLimitations.join("; ") ||
              labels("unavailable")
            }
          />
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
  artifactId,
}: {
  assessmentId: string;
  artifactId?: string;
}) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const artifact = detail.data?.case?.artifacts.find(
    (item) =>
      item.kind === ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT &&
      item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE &&
      (!artifactId || item.artifactId === artifactId),
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
          pdfSupported
        />
      </header>
      <h1 className="text-2xl font-semibold tracking-tight">{copy("title")}</h1>
      {"legacy" in model ? (
        <V1Report model={model} />
      ) : model.version === ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION ? (
        <V2Report model={model} />
      ) : model.version === ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION ? (
        <V3Report model={model} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>{copy("failed")}</AlertDescription>
        </Alert>
      )}
    </article>
  );
}
