"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  DownloadIcon,
  ShieldCheckIcon,
  GitCommitIcon,
  ScrollTextIcon,
  CpuIcon,
  FileCheckIcon,
  HelpCircleIcon,
  BoxesIcon,
  HistoryIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAssessmentProvenanceQuery } from "@/lib/api/assessment-domain-queries";
import { copy } from "../../utils/conversation-copy";

export function AssessmentProvenanceView({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const provenance = useAssessmentProvenanceQuery(assessmentId);

  const backLink = (
    <Link
      href={`/assessments/${encodeURIComponent(assessmentId)}`}
      className={buttonVariants({ variant: "ghost", size: "sm" })}
    >
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      {copy("provenance.back")}
    </Link>
  );

  if (provenance.isPending) {
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-6" role="status">
        <p className="text-sm text-muted-foreground">{copy("provenance.loading")}</p>
      </div>
    );
  }

  if (provenance.isError || !provenance.data) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-4 p-6">
        <div>{backLink}</div>
        <Alert variant="destructive">
          <AlertDescription>{copy("provenance.failed")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = provenance.data;
  const downloadUrl = `/api/assessments/${encodeURIComponent(assessmentId)}/provenance/download`;

  return (
    <article
      data-slot="assessment-provenance"
      className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-6 overflow-y-auto px-4 py-6 md:px-6"
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          {backLink}
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
            <p className="text-xs text-muted-foreground">{copy("provenance.title")}</p>
          </div>
        </div>
        <a
          href={downloadUrl}
          data-slot="export-provenance-button"
          download={`assessment-${assessmentId}-provenance.json`}
          className={buttonVariants({ size: "sm" })}
        >
          <DownloadIcon className="size-4" aria-hidden="true" />
          {copy("provenance.downloadProvenance")}
        </a>
      </header>

      {/* Cryptographic Integrity Verification Banner */}
      <Card className="border-emerald-500/30 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-950/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <ShieldCheckIcon className="size-5" aria-hidden="true" />
            <CardTitle className="text-sm font-medium">
              {copy("provenance.integrityVerified")}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium text-muted-foreground">{copy("provenance.contentFingerprint")}:</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-foreground break-all">
              {data.contentFingerprintSha256 ?? data.checksumSha256}
            </code>
          </div>
          <div className="grid grid-cols-1 gap-2 pt-1 text-muted-foreground sm:grid-cols-3">
            <div>
              <span className="font-medium text-foreground">Generated:</span>{" "}
              {new Date(data.generatedAt).toLocaleString()}
            </div>
            <div>
              <span className="font-medium text-foreground">Schema:</span> {data.schemaVersion}
            </div>
            <div>
              <span className="font-medium text-foreground">Correlation:</span>{" "}
              <span className="font-mono">{data.correlationId}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pinned Foundations */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <GitCommitIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.pins")}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{copy("provenance.repository")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Commit:</span>{" "}
                <code className="font-mono text-foreground">
                  {data.pins?.repositoryCommit ?? "N/A"}
                </code>
              </div>
              <div>
                <span className="font-medium text-foreground">Snapshot ID:</span>{" "}
                <span className="font-mono">{data.pins?.repositorySnapshotId ?? "N/A"}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">Scan Job:</span>{" "}
                <span className="font-mono">{data.pins?.repositoryScanJobId ?? "N/A"}</span>
              </div>
              {data.pins?.pinnedAt ? (
                <div>
                  <span className="font-medium text-foreground">Pinned At:</span>{" "}
                  {new Date(data.pins.pinnedAt).toLocaleString()}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{copy("provenance.ruleSet")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Version:</span>{" "}
                <Badge variant="outline">{data.pins?.ruleSet?.version ?? "N/A"}</Badge>
              </div>
              <div>
                <span className="font-medium text-foreground">Legal Source Version:</span>{" "}
                {data.pins?.ruleSet?.legalSourceVersion ?? "N/A"}
              </div>
              <div>
                <span className="font-medium text-foreground">Rules Covered:</span>{" "}
                {data.pins?.ruleSet?.assessmentRuleCount ?? 0}
              </div>
              <div>
                <span className="font-medium text-foreground">Legal Requirements:</span>{" "}
                {data.pins?.ruleSet?.legalRequirementCount ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Runtime Execution Lineage */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CpuIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.lineage")}
        </h2>
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 pt-4 text-xs sm:grid-cols-2 md:grid-cols-4">
            <div>
              <span className="block font-medium text-muted-foreground">Thread ID</span>
              <code className="font-mono text-foreground break-all">
                {data.runtime?.threadId ?? "N/A"}
              </code>
            </div>
            <div>
              <span className="block font-medium text-muted-foreground">Execution ID</span>
              <code className="font-mono text-foreground break-all">
                {data.runtime?.currentExecutionId ?? "None"}
              </code>
            </div>
            <div>
              <span className="block font-medium text-muted-foreground">Execution State</span>
              <Badge variant="secondary" className="mt-0.5">
                {data.runtime?.executionState ?? "N/A"}
              </Badge>
            </div>
            <div>
              <span className="block font-medium text-muted-foreground">Event Sequence</span>
              <span className="font-mono text-foreground">
                {data.runtime?.eventSequence ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Human Resolution History */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <HelpCircleIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.humanResolutions")} ({data.humanResolutions.length})
        </h2>
        {data.humanResolutions.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
            No human resolution questions were required for this assessment.
          </p>
        ) : (
          <div className="space-y-3">
            {data.humanResolutions.map((hr) => (
              <Card key={hr.requestId}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium">{hr.question}</CardTitle>
                    <Badge variant={hr.status === "RESOLVED" ? "default" : "outline"}>
                      {hr.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Unresolved Fact:</span>{" "}
                    {hr.unresolvedFact}
                  </p>
                  {hr.answers.length > 0 ? (
                    <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">
                      <span className="font-medium text-foreground">Human-Authored Answers:</span>
                      {hr.answers.map((ans, idx) => (
                        <div key={idx} className="border-t border-border/50 pt-1.5 first:border-0 first:pt-0">
                          <p className="font-sans text-foreground">
                            {ans.doesNotKnow ? "Marked as unknown" : ans.answer}
                          </p>
                          <span className="text-muted-foreground">
                            Answered at {new Date(ans.answeredAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Accepted Facts & Evidence */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileCheckIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.facts")} ({data.acceptedFacts.length}) & {copy("provenance.evidence")} ({data.acceptedEvidence.length})
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Facts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{copy("provenance.facts")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              {data.acceptedFacts.length === 0 ? (
                <p className="text-muted-foreground">No facts accepted.</p>
              ) : (
                data.acceptedFacts.map((fact) => (
                  <div key={fact.factId} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between gap-1 pb-1">
                      <Badge variant="outline">{fact.authority}</Badge>
                      <span className="text-muted-foreground">Rev {fact.caseRevision}</span>
                    </div>
                    <p className="text-foreground">{fact.statement}</p>
                    {fact.evidenceIds.length > 0 ? (
                      <p className="pt-1 text-muted-foreground">
                        Cited Evidence: {fact.evidenceIds.length} reference(s)
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Evidence */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{copy("provenance.evidence")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              {data.acceptedEvidence.length === 0 ? (
                <p className="text-muted-foreground">No evidence accepted.</p>
              ) : (
                data.acceptedEvidence.map((ev) => (
                  <div key={ev.evidenceId} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between gap-1 pb-1">
                      <Badge variant="secondary">{ev.type}</Badge>
                      <span className="font-mono text-muted-foreground">
                        {ev.repositoryCommit.slice(0, 7)}
                      </span>
                    </div>
                    <div className="font-mono text-muted-foreground break-all">
                      SHA: {ev.contentSha256}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Decisions & Coverage */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ScrollTextIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.decisions")} ({data.decisions.length})
        </h2>
        <Card>
          <CardContent className="space-y-3 pt-4 text-xs">
            {data.decisions.length === 0 ? (
              <p className="text-muted-foreground">No rule decisions recorded yet.</p>
            ) : (
              data.decisions.map((dec) => (
                <div key={dec.decisionId} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{dec.assessmentRuleId}</span>
                    <Badge variant={dec.decision.applicability === "APPLICABLE" ? "default" : "secondary"}>
                      {dec.decision.applicability}
                      {dec.decision.compliance ? ` • ${dec.decision.compliance}` : ""}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{dec.decision.rationale}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* Canonical Event Timeline */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <HistoryIcon className="size-4 text-primary" aria-hidden="true" />
          {copy("provenance.events")} ({data.events.length})
        </h2>
        <Card>
          <CardContent className="space-y-2 pt-4 text-xs">
            {data.events.length === 0 ? (
              <p className="text-muted-foreground">No events recorded.</p>
            ) : (
              <div className="divide-y">
                {data.events.map((evt) => (
                  <div key={evt.eventId} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="w-8 font-mono text-muted-foreground">#{evt.sequence}</span>
                      <Badge variant="outline">{evt.eventType}</Badge>
                      <span className="text-muted-foreground">{evt.actorType}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Generated Artifacts */}
      {data.artifacts.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BoxesIcon className="size-4 text-primary" aria-hidden="true" />
            {copy("provenance.artifacts")} ({data.artifacts.length})
          </h2>
          <Card>
            <CardContent className="space-y-2 pt-4 text-xs">
              {data.artifacts.map((art) => (
                <div key={art.artifactId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="default">{art.kind}</Badge>
                    <span className="font-mono text-muted-foreground">{art.artifactId}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{art.lifecycleState}</span>
                    {art.contentSha256 ? (
                      <code className="font-mono">SHA: {art.contentSha256.slice(0, 12)}…</code>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </article>
  );
}
