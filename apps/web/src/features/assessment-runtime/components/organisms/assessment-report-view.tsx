"use client";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_ARTIFACT_KINDS } from "@lcsp/contracts/assessment-domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  useAssessmentDetailQuery,
  useAssessmentReportQuery,
} from "@/lib/api/assessment-domain-queries";
import { copy } from "../../utils/conversation-copy";
import { AssessmentReportActions } from "../molecules/assessment-report-actions";

/** The stored final report, readable in the app: summary, per-rule findings and the pins it rests on. */
export function AssessmentReportView({ assessmentId, artifactId }: { assessmentId: string; artifactId?: string }) {
  const detail = useAssessmentDetailQuery(assessmentId);
  const artifact = detail.data?.case?.artifacts.find((item) =>
    item.kind === ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT &&
    item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE &&
    (!artifactId || item.artifactId === artifactId),
  );
  const report = useAssessmentReportQuery(assessmentId, artifact?.artifactId ?? null);
  const concepts = new Map(
    (detail.data?.case?.coverage ?? []).map((row) => [
      row.assessmentRuleId,
      row.concept,
    ]),
  );
  const back = (
    <Link
      href={`/assessments/${encodeURIComponent(assessmentId)}`}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {copy("report.back")}
    </Link>
  );
  if (detail.isPending || (artifact && report.isPending))
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        {copy("report.loading")}
      </p>
    );
  if (detail.isError || !artifact || report.isError || !report.data)
    return (
      <div className="flex flex-col gap-3 p-6">
        {back}
        <Alert variant="destructive">
          <AlertDescription>{copy("report.failed")}</AlertDescription>
        </Alert>
      </div>
    );
  const data = report.data;
  return (
    <article
      data-slot="assessment-report"
      className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <AssessmentReportActions
          assessmentId={assessmentId}
          artifactId={data.artifactId}
        />
      </header>
      <h1 className="text-2xl font-semibold tracking-tight">
        {copy("report.title")}
      </h1>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{copy("report.summary")}</h2>
        <p className="text-sm whitespace-pre-wrap">{data.summary}</p>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">{copy("report.findings")}</h2>
        <ul className="flex flex-col gap-5">
          {data.findings.map((finding) => (
            <li
              key={finding.decisionId}
              data-finding-rule={finding.assessmentRuleId}
              className="flex flex-col gap-1"
            >
              <h3 className="font-medium">
                {concepts.get(finding.assessmentRuleId) ??
                  copy("decision.ruleFallback", { id: finding.assessmentRuleId })}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {copy(
                    `decision.outcomes.${finding.decision.compliance ?? finding.decision.applicability}`,
                  )}
                </span>
              </h3>
              <p className="text-sm whitespace-pre-wrap">{finding.summary}</p>
              {finding.recommendations.length > 0 ? (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">
                    {copy("report.recommendations")}
                  </p>
                  <ul className="list-disc pl-5">
                    {finding.recommendations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <footer className="text-xs text-muted-foreground">
        {copy("report.basedOn")}{" "}
        <code className="break-all">
          {data.pins.repositoryCommit.slice(0, 7)} · {data.pins.ruleSetVersionId}
        </code>
      </footer>
    </article>
  );
}
