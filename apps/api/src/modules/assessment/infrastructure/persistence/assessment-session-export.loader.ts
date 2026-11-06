import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { AuthUserRole } from "@lcsp/contracts/auth";
import { asRecord } from "@lcsp/contracts/shared/type-guards";
import {
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_SESSION_REPORT_STATES,
  type AssessmentSessionReportState,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { repositorySourcePathPrefixSchema } from "@lcsp/contracts/github-integration";
import {
  sanitizeAgentStreamText,
  sanitizeAgentStreamValue,
} from "../../../../platform/runtime-events/agent-stream-sanitizer.js";
import { AssessmentProvenanceLoader } from "./assessment-provenance.loader.js";
import { AssessmentReportLoader } from "./assessment-report.loader.js";
import { loadPinnedReviewLegalEvidence } from "./assessment-session-legal-evidence.js";
import { summarizeSessionFileEvidence } from "./assessment-session-file-evidence.js";
import {
  summarizeSessionDurations,
  summarizeSessionTokenUsage,
  summarizeSessionTools,
} from "./assessment-session-metrics.js";

export const SESSION_EXPORT_SCHEMA_VERSION = "assessment.session.v1";

export {
  ASSESSMENT_SESSION_REPORT_STATES,
  type AssessmentSessionReportState,
} from "@lcsp/contracts/assessment-domain";

/**
 * Business purpose: Distinguish an unavailable finalized report from authorization
 * or runtime failures, so session metrics may still be exported without misrepresenting
 * invalid report bytes as verified evidence.
 *
 * Business rules:
 * - Only the canonical FINAL_REPORT_INVALID conflict may be converted to an
 *   explicitly incomplete export; all authorization and unrelated errors fail closed.
 * - Error messages or private storage paths must never be exposed to customers.
 *
 * Execution flow:
 * 1. Require the upstream exception to be an HTTP 409.
 * 2. Confirm its structured application problem code identifies final-report validation.
 *
 * Failure cases:
 * - Unknown or unstructured errors return false and remain fatal.
 *
 * Side effects:
 * - None: this is a pure classifier and does not read or change assessment state.
 */
function isUnavailableFinalReport(error: unknown): boolean {
  if (
    !(error instanceof HttpException) ||
    error.getStatus() !== Number(HttpStatus.CONFLICT)
  ) {
    return false;
  }
  const response = asRecord(error.getResponse());
  const problem = asRecord(response?.problem ?? response);
  return problem?.code === ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID;
}

type LoadInput = {
  assessmentId: string;
  sessionUserId: string;
  subjectRole: AuthUserRole;
  correlationId: string;
};

/** Read-only aggregation of existing persisted and redacted assessment evidence. */
@Injectable()
export class AssessmentSessionExportLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provenance: AssessmentProvenanceLoader,
    private readonly reports: AssessmentReportLoader,
  ) {}

  /**
   * Business purpose: Produce one review-ready session JSON with measurable execution
   * telemetry and the existing assessment evidence, without assigning reviewer scores.
   * Business rules: Provenance ownership/integrity verification is mandatory before any
   * additional data read; private checkpoint context and secrets are never exported.
   * The exported repository is the exact provenance-pinned snapshot, including its source prefix; newer snapshots never replace that identity.
   * Selected audit scope and immutable pins remain explicit in the hashed document.
   * Unmeasured metrics remain null, never guessed or converted to a confirmed zero.
   * Execution flow: 1. Authorize against canonical provenance. 2. Read run turns,
   * sanitized event journal, provider usage and repository identity. 3. Attach the
   * integrity-checked final report only when valid; otherwise flag it as unavailable.
   * 4. Aggregate only measured counts.
   * Failure cases: Missing/foreign-owned assessments and invalid provenance fail closed.
   * An invalid final-report artifact remains excluded and explicitly marked unavailable,
   * without blocking export of independently persisted session telemetry.
   * Side effects: Read-only database and artifact access; no assessment changes.
   */
  async load(input: LoadInput) {
    const source = await this.provenance.load(input);

    const [
      assessmentRecord,
      pinnedSnapshot,
      turns,
      journal,
      usages,
      rawEvents,
    ] = await Promise.all([
      this.prisma.assessment.findUnique({
        where: { id: input.assessmentId },
        include: { runtime: true },
      }),
      source.pins?.repositorySnapshotId && source.pins.repositoryCommit
        ? this.prisma.repositorySnapshot.findFirst({
            where: {
              id: source.pins.repositorySnapshotId,
              assessmentId: input.assessmentId,
              commitSha: source.pins.repositoryCommit,
            },
            include: { connection: { select: { provider: true } } },
          })
        : Promise.resolve(null),
      this.prisma.assessmentRuntimeTurn.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.assessmentRuntimeEvent.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: [{ runId: "asc" }, { sequence: "asc" }],
      }),
      this.prisma.llmUsageEvent.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: { occurredAt: "asc" },
      }),
      this.prisma.assessmentEvent.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: { sequence: "asc" },
      }),
    ]);

    if (
      source.pins?.repositorySnapshotId &&
      (!pinnedSnapshot ||
        pinnedSnapshot.id !== source.pins.repositorySnapshotId ||
        pinnedSnapshot.assessmentId !== input.assessmentId ||
        pinnedSnapshot.commitSha !== source.pins.repositoryCommit ||
        (pinnedSnapshot.sourcePathPrefix !== null &&
          !repositorySourcePathPrefixSchema.safeParse(
            pinnedSnapshot.sourcePathPrefix,
          ).success))
    )
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );

    const finalReportArtifact = source.artifacts?.find(
      (a) =>
        a.kind === ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT &&
        a.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    );

    let finalReport: Awaited<
      ReturnType<AssessmentReportLoader["load"]>
    > | null = null;
    let finalReportStatus: AssessmentSessionReportState =
      ASSESSMENT_SESSION_REPORT_STATES.UNAVAILABLE;

    if (finalReportArtifact) {
      try {
        finalReport = await this.reports.load({
          assessmentId: input.assessmentId,
          artifactId: finalReportArtifact.artifactId,
          sessionUserId: input.sessionUserId,
          subjectRole: input.subjectRole,
          correlationId: input.correlationId,
        });
        finalReportStatus = ASSESSMENT_SESSION_REPORT_STATES.AVAILABLE;
      } catch (err) {
        if (isUnavailableFinalReport(err)) {
          finalReportStatus = ASSESSMENT_SESSION_REPORT_STATES.UNAVAILABLE;
          finalReport = null;
        } else {
          throw err;
        }
      }
    }

    const durations = summarizeSessionDurations(
      turns,
      rawEvents,
      assessmentRecord,
    );
    const tokenUsage = summarizeSessionTokenUsage(usages);
    const tools = summarizeSessionTools(journal);
    const fileEvidence = summarizeSessionFileEvidence(source.acceptedEvidence);
    const legalEvidence = await loadPinnedReviewLegalEvidence(
      this.prisma,
      source.pins?.ruleSet,
    );

    const startedAt = durations.startedAt;
    const lastExecutionStartedAt = source.runtime?.startedAt
      ? new Date(source.runtime.startedAt).toISOString()
      : null;
    const lifecycleState =
      source.lifecycle?.state ??
      assessmentRecord?.lifecycleState ??
      ASSESSMENT_LIFECYCLE_STATES.CREATED;
    const completedAt = durations.completedAt;

    const uniqueModels = Array.from(
      new Map(
        usages.map((u) => [
          `${u.provider}:${u.model}`,
          { provider: u.provider, model: u.model },
        ]),
      ).values(),
    );

    const executionMetrics = {
      wallDurationMs: durations.wallDurationMs,
      activeDurationMs: durations.activeDurationMs,
      observedRunningDurationMs: durations.observedRunningDurationMs,
      durationMeasurement: durations.durationMeasurement,
      durationCoverage: durations.durationCoverage,
      modelCalls: tools.modelCalls,
      modelCallCoverage: tools.modelCallCoverage,
      toolCalls: tools.toolCalls,
      toolCallCoverage: tools.toolCallCoverage,
      toolExecutions: tools.toolExecutions,
      observedUniqueFilesExamined: fileEvidence.observedUniqueFilesExamined,
    };

    const humanRequests = source.humanResolutions ?? [];
    const humanInteraction = {
      requests: humanRequests,
      resolvedCount: humanRequests.filter(
        (r) => r.status === HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
      ).length,
      openCount: humanRequests.filter(
        (r) => r.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      ).length,
    };

    const humanAnswerHistory = humanRequests.map((request) => {
      const legacy = asRecord(request);
      return {
        requestId: request.requestId,
        assessmentRuleId: request.assessmentRuleId,
        dependencies: request.dependencies,
        answers:
          request.answers ??
          (legacy?.answer
            ? [{ answer: legacy.answer, answeredAt: legacy.answeredAt }]
            : []),
      };
    });

    const assessmentResults = {
      finalReportStatus,
      finalReport,
      decisions: source.decisions ?? [],
      facts: source.acceptedFacts ?? [],
      evidence: source.acceptedEvidence ?? [],
      sourceEvidenceIndex: fileEvidence.sourceEvidenceIndex,
      legalEvidence,
    };

    const executionHistory = {
      runtimeEvents: journal.map((ev) => sanitizeAgentStreamValue(ev)),
      executionSegments: durations.executionSegments,
      fileAccessObservations: fileEvidence.fileAccessObservations,
      modelUsageEvents: usages.map((usage) => ({
        runId: usage.runId ?? null,
        invocationId: usage.invocationId ?? null,
        provider: usage.provider,
        model: usage.model,
        status: usage.status ?? null,
        occurredAt: usage.occurredAt ?? null,
        inputTokens: usage.inputTokens?.toString() ?? null,
        outputTokens: usage.outputTokens?.toString() ?? null,
        totalTokens: usage.totalTokens?.toString() ?? null,
        cachedInputTokens: usage.cachedInputTokens?.toString() ?? null,
        reasoningTokens: usage.reasoningTokens?.toString() ?? null,
      })),
      errors: journal
        .filter((ev) => ev.errorSummary)
        .map((ev) => ({
          runId: ev.runId,
          sequence: ev.sequence,
          errorSummary: sanitizeAgentStreamText(ev.errorSummary),
        })),
    };

    const session = {
      assessmentId: source.assessmentId,
      name: source.name,
      lifecycleState,
      startedAt,
      lastExecutionStartedAt,
      completedAt,
    };

    const repository = {
      provider: pinnedSnapshot
        ? String(pinnedSnapshot.connection.provider)
        : null,
      snapshotId: source.pins?.repositorySnapshotId ?? null,
      fullName: pinnedSnapshot?.repositoryFullName ?? null,
      commitSha: source.pins?.repositoryCommit ?? null,
      sourcePathPrefix: pinnedSnapshot?.sourcePathPrefix ?? null,
      defaultBranch: pinnedSnapshot?.branch ?? null,
    };

    const agent = {
      rootVersion: "ASSESSMENT_ROOT_V1",
      models: uniqueModels,
    };

    const inputSnapshot = {
      humanAnswerHistory,
    };

    const provenanceSha256 =
      source.checksumSha256 ?? source.contentFingerprintSha256;

    const contentToHash = {
      schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
      auditScope: source.auditScope,
      pins: source.pins,
      session,
      repository,
      agent,
      executionMetrics,
      tokenUsage,
      humanInteraction,
      assessmentResults,
      executionHistory,
      inputSnapshot,
      provenanceSha256,
    };

    const contentSha256 = createHash("sha256")
      .update(JSON.stringify(contentToHash))
      .digest("hex");

    return {
      schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
      auditScope: source.auditScope,
      pins: source.pins,
      session,
      repository,
      agent,
      executionMetrics,
      tokenUsage,
      humanInteraction,
      assessmentResults,
      executionHistory,
      inputSnapshot,
      // Compatibility aliases
      assessment: {
        id: source.assessmentId,
        name: source.name,
        lifecycleState,
        startedAt,
        completedAt,
      },
      decisions: source.decisions ?? [],
      report: asRecord(finalReport)?.report ?? finalReport,
      telemetry: {
        tokenUsage,
        metrics: executionMetrics,
      },
      integrity: {
        provenanceSha256,
        contentSha256,
      },
    };
  }
}
