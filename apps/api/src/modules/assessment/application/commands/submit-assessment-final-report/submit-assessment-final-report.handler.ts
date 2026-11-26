import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  RULE_AUDIT_STATUSES,
  assessmentFinalReportResultSchema,
  type AssessmentFinalReportResult,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ArtifactLifecycleState,
  AssessmentArtifactKind,
  Prisma,
  type AssessmentArtifact,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  ArtifactStorageService,
  buildChunkedManifest,
  chunkedManifestSchema,
} from "../../../../../platform/storage/artifact-storage.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import {
  classifyFinalReportFailure,
  FinalReportIntegrityError,
  finalReportFailureCode,
  isFinalReportDependencyUnavailable,
  withFinalReportDependencyDeadline,
} from "../../services/final-report-error-classifier.js";
import { ROOT_AUDIT_ACTOR } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import {
  canonicalJson,
  deterministicUuid,
  sha256Hex,
} from "../../../domain/domain-ids.js";
import { decisionFingerprint } from "../../../domain/decision-fingerprint.js";
import { SubmitAssessmentFinalReportCommand } from "./submit-assessment-final-report.command.js";
import {
  assertReportRepositorySetCurrent,
  reportIdentityMatchesPins,
  reportPrimaryPin,
} from "../../../domain/final-report-repository-pins.js";
import {
  buildAssessmentFinalReportV4,
  finalReportNeedsRepositorySet,
} from "./assessment-final-report-v4.builder.js";
import {
  buildAssessmentFinalReportV3,
  FinalReportAssemblyError,
} from "./assessment-final-report-v3.builder.js";
import {
  assessmentFinalReportArtifactVersionedSchema,
  type AssessmentFinalReportV3,
  type AssessmentFinalReportV4,
} from "@lcsp/contracts/assessment-report";
import { ZodError } from "zod";

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;
const unresolvedSentinelTokens =
  /\b(?:UNKNOWN|PARTIAL|NEEDS_CONTEXT|BLOCKED_UNKNOWN_FACT|TBD)\b/;
const unresolvedPhrases =
  /information\s+(?:is\s+)?still\s+required|open\s+questions?|unresolved\s+(?:question|decision|fact|input)|to\s+be\s+determined/i;

/**
 * Business purpose: Enforce final-report completeness by rejecting unresolved placeholder
 *   sentinel tokens or uncertainty expressions across authored summaries, findings,
 *   decision rationales, criteria rationales, and recommendations.
 *
 * Business rules:
 * - Placeholder sentinels (e.g. UNKNOWN, PARTIAL, NEEDS_CONTEXT, BLOCKED_UNKNOWN_FACT, TBD)
 *   are evaluated case-sensitively so that valid natural-language prose (such as "partial elements")
 *   is not erroneously flagged as an incomplete decision verdict.
 * - Conversational indicators of incomplete resolution (such as "information still required",
 *   "open questions", "unresolved fact", "to be determined") are evaluated case-insensitively.
 *
 * Execution flow:
 * 1. Collect all narrative text from the report summary, finding summaries, decision rationales,
 *    criterion rationales, and recommendations.
 * 2. Scan every text string against both unresolved status sentinels and uncertainty phrases.
 * 3. Throw a FINAL_REPORT_INVALID problem exception upon detecting any unresolved language.
 *
 * Failure cases:
 * - Any occurrence of an unresolved status sentinel token or uncertainty phrase triggers an
 *   UNPROCESSABLE_ENTITY (422) error with code FINAL_REPORT_INVALID.
 *
 * Side effects:
 * - Pure validation function; no persistence or state mutations.
 */
function rejectUnresolvedLanguage(
  report: unknown,
  correlationId: string,
): void {
  const value = report as {
    summary?: unknown;
    findings?: Array<{ summary?: unknown; recommendations?: unknown[] }>;
    boundedNarrative?: {
      summary?: unknown;
      actionPlan?: unknown[];
      scopeLimitations?: unknown[];
    };
    ruleDetails?: Array<{
      narrative?: { summary?: unknown; recommendations?: unknown[] };
      criteriaDecisions?: Array<{ rationale?: unknown }>;
      decision?: { rationale?: unknown };
    }>;
  };
  const text = [
    ...(typeof value.summary === "string" ? [value.summary] : []),
    ...(typeof value.boundedNarrative?.summary === "string"
      ? [value.boundedNarrative.summary]
      : []),
    ...(value.findings ?? []).flatMap((finding) => [
      ...(typeof finding.summary === "string" ? [finding.summary] : []),
      ...(finding.recommendations?.filter(
        (item): item is string => typeof item === "string",
      ) ?? []),
    ]),
    ...(value.boundedNarrative?.actionPlan?.filter(
      (item): item is string => typeof item === "string",
    ) ?? []),
    ...(value.ruleDetails ?? []).flatMap((rule) => [
      ...(typeof rule.narrative?.summary === "string"
        ? [rule.narrative.summary]
        : []),
      ...(rule.narrative?.recommendations?.filter(
        (item): item is string => typeof item === "string",
      ) ?? []),
      ...(typeof rule.decision?.rationale === "string"
        ? [rule.decision.rationale]
        : []),
      ...(rule.criteriaDecisions ?? []).flatMap((crit) =>
        typeof crit.rationale === "string" ? [crit.rationale] : [],
      ),
    ]),
  ];
  if (
    text.some(
      (value) =>
        unresolvedSentinelTokens.test(value) || unresolvedPhrases.test(value),
    )
  ) {
    throw problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
}

/**
 * Business purpose: Verify that an immutable report still represents its accepted decision history.
 *
 * Business rules:
 * - Prefer V2 rule details and fall back to V1 findings; fingerprint identities, revisions, and decisions in report order.
 *
 * Execution flow:
 * 1. Read the report's supported decision collection.
 * 2. Delegate canonical hashing to the shared decision fingerprint function.
 *
 * Failure cases:
 * - Empty or malformed collections are fingerprinted as supplied and rejected by artifact validation or immutable replay checks.
 *
 * Side effects:
 * - None: computes an in-memory fingerprint without changing the artifact.
 */
function decisionFingerprintForReport(report: unknown): string {
  const value = report as {
    findings?: Array<{
      decisionId: string;
      decisionRevision: number;
      decision: unknown;
    }>;
    ruleDetails?: Array<{
      decisionId: string;
      decisionRevision: number;
      decision: unknown;
    }>;
  };
  const decisions = value.ruleDetails ?? value.findings ?? [];
  return decisionFingerprint(decisions);
}

const FINAL_REPORT_PREPARATION_MODES = {
  building: "BUILDING",
  replay: "REPLAY",
} as const;

type CompletionSnapshot = NonNullable<
  Awaited<ReturnType<AssessmentCompletionGate["inspectInTx"]>>["snapshot"]
>;

type PreparedBuildingReport = {
  mode: typeof FINAL_REPORT_PREPARATION_MODES.building;
  artifactId: string;
  assessmentId: string;
  caseRevision: number;
  content: string;
  hash: string;
  manifest: ReturnType<typeof buildChunkedManifest>["manifest"];
  report: AssessmentFinalReportV3 | AssessmentFinalReportV4;
  repositoryCommit: string;
  repositorySnapshotId: string;
  requestDigest: string;
  ruleSetVersionId: string;
  schemaVersion:
    | typeof ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION
    | typeof ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION;
  sizeBytes: number;
};

type PreparedReplayReport = {
  mode: typeof FINAL_REPORT_PREPARATION_MODES.replay;
  artifact: AssessmentArtifact;
};

type PreparedFinalReport = PreparedBuildingReport | PreparedReplayReport;

/**
 * Business purpose: Prove that a persisted BUILDING row is exactly the authority prepared from canonical inputs.
 *
 * Business rules:
 * - Identity, tenant aggregate, kind, pins, revision, schema, digest, hash, size, and manifest must all match.
 * - Partial matches never authorize activation because they could leave a COMPLETE Assessment with an unreadable report.
 *
 * Execution flow:
 * 1. Compare stable identity and aggregate fields.
 * 2. Compare pinned rule-set, repository, case, and schema fields.
 * 3. Compare request and content-integrity metadata.
 *
 * Failure cases:
 * - Missing rows or any unequal field return false for conflict/integrity handling by the caller.
 *
 * Side effects:
 * - Pure comparison; no storage or persistence access.
 */
function buildingAuthorityMatches(
  artifact: AssessmentArtifact | null,
  prepared: PreparedBuildingReport,
): boolean {
  return (
    artifact?.artifactId === prepared.artifactId &&
    artifact.assessmentId === prepared.assessmentId &&
    artifact.kind === AssessmentArtifactKind.FINAL_REPORT &&
    artifact.ruleSetVersionId === prepared.ruleSetVersionId &&
    artifact.repositorySnapshotId === prepared.repositorySnapshotId &&
    // Git commit hex is case-insensitive; casing drift across persistence
    // adapters must not invalidate otherwise identical BUILDING authority.
    artifact.repositoryCommit.toLowerCase() ===
      prepared.repositoryCommit.toLowerCase() &&
    artifact.caseRevision === prepared.caseRevision &&
    artifact.schemaVersion === prepared.schemaVersion &&
    artifact.reportRequestDigest === prepared.requestDigest &&
    artifact.contentSha256 === `sha256:${prepared.hash}` &&
    artifact.sizeBytes === prepared.sizeBytes &&
    artifact.storageRef === JSON.stringify(prepared.manifest)
  );
}

/**
 * Business purpose: Detect the one database race that may be safely resolved by reloading authority.
 *
 * Business rules:
 * - Only Prisma P2002 for the final-report assessment/kind uniqueness boundary is retryable.
 * - All other database failures retain their normal operational classification.
 *
 * Execution flow:
 * 1. Inspect the structured Prisma code.
 * 2. Inspect the optional unique target metadata.
 * 3. Accept P2002 only when an array target names both columns or a string target
 *    ends with the exact generated assessment/kind constraint name.
 *
 * Failure cases:
 * - Non-object errors, other Prisma codes, or unrelated unique targets return false.
 *
 * Side effects:
 * - Pure classification; no database retry is performed inside this function.
 */
function isFinalReportUniqueRace(error: unknown): boolean {
  if (finalReportFailureCode(error) !== "P2002") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const meta = record.meta;
  if (typeof meta !== "object" || meta === null) return false;
  const target = (meta as Record<string, unknown>).target;
  if (Array.isArray(target)) {
    return target.includes("assessmentId") && target.includes("kind");
  }
  // Prisma/PostgreSQL may expose `meta.target` as a qualified constraint name
  // instead of a column array. Match only this unique boundary so unrelated
  // P2002 violations never trigger final-report convergence logic.
  return (
    typeof target === "string" &&
    target.endsWith("AssessmentArtifact_assessmentId_kind_key")
  );
}

@CommandHandler(SubmitAssessmentFinalReportCommand)
export class SubmitAssessmentFinalReportHandler implements ICommandHandler<SubmitAssessmentFinalReportCommand> {
  private readonly logger = new Logger(SubmitAssessmentFinalReportHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly completionGate: AssessmentCompletionGate,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly events: AssessmentEventAppender,
    private readonly storage: ArtifactStorageService,
  ) {}

  /**
   * Business purpose: Publish one integrity-checked final report and complete its eligible Assessment.
   *
   * Business rules:
   * - BUILDING metadata is authoritative before storage starts; only the same request digest may resume it.
   * - Storage verification is synchronous and ACTIVE publication is atomic with Assessment completion.
   * - Shared content-addressed chunks are never compensating-deleted after a database failure.
   *
   * Execution flow:
   * 1. Transaction one authorizes, assembles the canonical report, and commits BUILDING metadata.
   * 2. Write and verify immutable storage outside database transactions.
   * 3. Transaction two locks and revalidates BUILDING, then activates the artifact and completes the Assessment.
   * 4. Verify and return an existing ACTIVE artifact for an exact idempotent replay.
   *
   * Failure cases:
   * - A different digest or inconsistent BUILDING metadata returns conflict without touching storage.
   * - Integrity failures return 409, retryable dependency failures return 503, and unexpected failures are masked as 500.
   *
   * Side effects:
   * - Commits two database transactions and one idempotent immutable-storage write; exact ACTIVE replay is read-only.
   */
  async execute(
    command: SubmitAssessmentFinalReportCommand,
  ): Promise<AssessmentFinalReportResult> {
    const requestDigest = sha256Hex(canonicalJson(command.request));
    try {
      let prepared: PreparedFinalReport;
      try {
        prepared = await this.prepareBuildingAuthority(command, requestDigest);
      } catch (error) {
        // A concurrent creator may win the unique assessment/kind row. Reload
        // that row and converge on its digest instead of exposing a raw P2002.
        if (!isFinalReportUniqueRace(error)) throw error;
        prepared = await this.prepareBuildingAuthority(command, requestDigest);
      }

      if (prepared.mode === FINAL_REPORT_PREPARATION_MODES.replay) {
        return await this.verifyActiveReplay(command, prepared.artifact);
      }

      const stored = await withFinalReportDependencyDeadline(
        this.storage.writeImmutableArtifact(
          prepared.artifactId,
          prepared.content,
        ),
      );
      if (
        stored.manifest.hash !== prepared.hash ||
        stored.sizeBytes !== prepared.sizeBytes ||
        JSON.stringify(stored.manifest) !== JSON.stringify(prepared.manifest)
      ) {
        throw new FinalReportIntegrityError(
          "Immutable storage returned metadata inconsistent with BUILDING authority",
        );
      }
      return await this.activateBuildingReport(command, prepared);
    } catch (error) {
      const failureCode = finalReportFailureCode(error);
      // Expected domain problems are already structured outcomes. Operational
      // failures retain correlation and a bounded code without logging secrets.
      if (!(error instanceof HttpException)) {
        this.logger.error(
          `Final report submission failed; correlationId=${command.correlationId}; failure=${error instanceof Error ? error.name : typeof error}; code=${typeof failureCode === "string" ? failureCode : "UNCLASSIFIED"}`,
        );
      }
      throw classifyFinalReportFailure(
        error,
        command.correlationId,
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      );
    }
  }

  /**
   * Business purpose: Commit or resume the authoritative BUILDING record for a final report.
   *
   * Business rules:
   * - A new or resumed report requires FINALIZING, a clear completion gate, and exact decision/narrative coverage.
   * - Same-digest BUILDING resumes the same deterministic artifact; different digests and terminal non-ACTIVE states conflict.
   * - BUILDING stores the expected manifest, hash, and byte size before storage is called.
   *
   * Execution flow:
   * 1. Authorize and inspect the unique final-report row.
   * 2. Return an exact ACTIVE row for read-only replay.
   * 3. Assemble and validate the canonical report from the frozen completion snapshot.
   * 4. Validate a same-digest BUILDING row or create it with complete expected metadata and an event.
   *
   * Failure cases:
   * - Wrong lifecycle, completion blockers, finding drift, digest conflict, or metadata drift abort the transaction.
   *
   * Side effects:
   * - Creates at most one BUILDING row and one BUILDING event in a single transaction; never writes storage.
   */
  private async prepareBuildingAuthority(
    command: SubmitAssessmentFinalReportCommand,
    requestDigest: string,
  ): Promise<PreparedFinalReport> {
    return this.prisma.$transaction(
      async (tx) => {
        const run = await this.authority.authorizeInTx(tx, {
          assessmentId: command.assessmentId,
          leaseToken: command.leaseToken,
          correlationId: command.correlationId,
          requireActive: false,
        });
        const existing = await tx.assessmentArtifact.findUnique({
          where: {
            assessmentId_kind: {
              assessmentId: command.assessmentId,
              kind: AssessmentArtifactKind.FINAL_REPORT,
            },
          },
        });
        if (existing?.lifecycleState === ArtifactLifecycleState.ACTIVE) {
          if (
            existing.reportRequestDigest !== requestDigest ||
            !existing.contentSha256 ||
            existing.sizeBytes === null ||
            !existing.storageRef ||
            run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE
          ) {
            throw problemException(
              ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_ALREADY_CREATED,
              command.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
          return {
            mode: FINAL_REPORT_PREPARATION_MODES.replay,
            artifact: existing,
          };
        }
        if (
          existing &&
          (existing.lifecycleState !== ArtifactLifecycleState.BUILDING ||
            existing.reportRequestDigest !== requestDigest)
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_ALREADY_CREATED,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.FINALIZING) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const snapshot = await this.requireCompletionSnapshot(tx, command);
        const prepared = await this.assembleBuildingReport(
          tx,
          command,
          requestDigest,
          snapshot,
        );
        await this.persistBuildingAuthority(
          tx,
          command,
          run.executionId,
          existing,
          prepared,
        );
        return prepared;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /**
   * Business purpose: Obtain the frozen completion snapshot that is eligible for final-report publication.
   *
   * Business rules:
   * - Completion blockers must be empty and every frozen decision must have exactly one authored narrative.
   *
   * Execution flow:
   * 1. Inspect the completion gate inside transaction one.
   * 2. Reject missing snapshots or reported blockers.
   * 3. Compare sorted decision and narrative rule identities.
   * 4. Return the eligible frozen snapshot.
   *
   * Failure cases:
   * - Gate blockers return completion conflict; identity drift returns final-report validation failure.
   *
   * Side effects:
   * - Read-only transactional inspection.
   */
  private async requireCompletionSnapshot(
    tx: Prisma.TransactionClient,
    command: SubmitAssessmentFinalReportCommand,
  ): Promise<CompletionSnapshot> {
    const inspection = await this.completionGate.inspectInTx(
      tx,
      command.assessmentId,
    );
    if (inspection.blockers.length > 0 || !inspection.snapshot) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.COMPLETION_GATE_BLOCKED,
        command.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            blockers: inspection.blockers
              .map(({ code, reference }) => `${code}:${reference ?? ""}`)
              .join(",")
              .slice(0, 2000),
          },
        },
      );
    }
    const snapshot: CompletionSnapshot = inspection.snapshot;
    const narrativeRuleIds = command.request.findings
      .map(({ assessmentRuleId }) => assessmentRuleId)
      .sort();
    const decisionRuleIds = snapshot.decisions
      .map(({ decision }) => decision.assessmentRuleId)
      .sort();
    if (
      decisionRuleIds.length !== narrativeRuleIds.length ||
      decisionRuleIds.some(
        (ruleId, index) => ruleId !== narrativeRuleIds[index],
      )
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return snapshot;
  }

  /**
   * Business purpose: Assemble deterministic report bytes and the complete metadata expected by BUILDING authority.
   *
   * Business rules:
   * - Artifact identity derives from assessment plus request digest and all canonical narrative must be resolved.
   * - Known assembly/data errors are 422; dependency and unexpected failures retain operational classification.
   *
   * Execution flow:
   * 1. Derive the deterministic artifact identifier and validate request language.
   * 2. Build and validate the V3 report from pinned snapshot data.
   * 3. Canonicalize content and derive its deterministic manifest, hash, and size.
   * 4. Return the complete expected BUILDING authority.
   *
   * Failure cases:
   * - Assembly/schema failures return validation errors; dependency or internal failures propagate safely outward.
   *
   * Side effects:
   * - Performs transactional report-source reads; does not write metadata or storage.
   */
  private async assembleBuildingReport(
    tx: Prisma.TransactionClient,
    command: SubmitAssessmentFinalReportCommand,
    requestDigest: string,
    snapshot: CompletionSnapshot,
  ): Promise<PreparedBuildingReport> {
    const artifactId = deterministicUuid(
      `${command.assessmentId}:${requestDigest}`,
    );
    rejectUnresolvedLanguage(command.request, command.correlationId);
    let report: AssessmentFinalReportV3 | AssessmentFinalReportV4;
    const buildInput = {
      tx,
      assessmentId: command.assessmentId,
      artifactId,
      request: command.request,
      snapshot,
    };
    try {
      // Several pinned repositories need the format that names each repository; one keeps V3.
      report = finalReportNeedsRepositorySet(buildInput)
        ? await buildAssessmentFinalReportV4(buildInput)
        : await buildAssessmentFinalReportV3(buildInput);
    } catch (error) {
      if (isFinalReportDependencyUnavailable(error)) throw error;
      if (
        error instanceof FinalReportAssemblyError ||
        error instanceof ZodError
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
          command.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      throw error;
    }
    rejectUnresolvedLanguage(report, command.correlationId);
    const content = canonicalJson(report);
    const hash = sha256Hex(content);
    const { manifest, sizeBytes } = buildChunkedManifest(artifactId, content);
    return {
      mode: FINAL_REPORT_PREPARATION_MODES.building,
      artifactId,
      assessmentId: command.assessmentId,
      caseRevision: snapshot.caseRevision,
      content,
      hash,
      manifest,
      report,
      repositoryCommit: snapshot.pins.repositoryCommit,
      repositorySnapshotId: snapshot.pins.repositorySnapshotId,
      requestDigest,
      ruleSetVersionId: snapshot.pins.ruleSetVersionId,
      schemaVersion: report.schemaVersion,
      sizeBytes,
    };
  }

  /**
   * Business purpose: Persist new BUILDING authority or verify the exact authority already committed for a retry.
   *
   * Business rules:
   * - Existing BUILDING must match every canonical field; new authority records all expected storage metadata.
   * - Only a new row emits the BUILDING transition event.
   *
   * Execution flow:
   * 1. Validate an existing BUILDING row and return without duplicate events.
   * 2. Otherwise create the complete BUILDING record.
   * 3. Append the corresponding artifact-state event in the same transaction.
   *
   * Failure cases:
   * - Any existing metadata drift throws an integrity conflict and rolls back transaction one.
   *
   * Side effects:
   * - Creates one artifact row and event only for the first publication attempt.
   */
  private async persistBuildingAuthority(
    tx: Prisma.TransactionClient,
    command: SubmitAssessmentFinalReportCommand,
    executionId: string,
    existing: AssessmentArtifact | null,
    prepared: PreparedBuildingReport,
  ): Promise<void> {
    if (existing) {
      if (!buildingAuthorityMatches(existing, prepared)) {
        throw new FinalReportIntegrityError(
          "BUILDING final-report metadata does not match canonical content",
        );
      }
      return;
    }
    const pinnedCase = await tx.assessmentCase.findUnique({
      where: { assessmentId: prepared.assessmentId },
      select: { repositorySetDigest: true },
    });
    await tx.assessmentArtifact.create({
      data: {
        artifactId: prepared.artifactId,
        assessmentId: prepared.assessmentId,
        kind: AssessmentArtifactKind.FINAL_REPORT,
        lifecycleState: ArtifactLifecycleState.BUILDING,
        ruleSetVersionId: prepared.ruleSetVersionId,
        repositorySnapshotId: prepared.repositorySnapshotId,
        repositoryCommit: prepared.repositoryCommit,
        repositorySetDigest: pinnedCase?.repositorySetDigest ?? null,
        caseRevision: prepared.caseRevision,
        schemaVersion: prepared.schemaVersion,
        reportRequestDigest: prepared.requestDigest,
        contentSha256: `sha256:${prepared.hash}`,
        sizeBytes: prepared.sizeBytes,
        storageRef: JSON.stringify(prepared.manifest),
      },
    });
    await this.events.appendInTx(tx, {
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      executionId,
      payload: {
        artifactId: prepared.artifactId,
        fromState: null,
        toState: ArtifactLifecycleState.BUILDING,
      },
      auditActor: ROOT_AUDIT_ACTOR,
    });
  }

  /**
   * Business purpose: Atomically publish a verified BUILDING report and complete its Assessment.
   *
   * Business rules:
   * - The unique artifact row is locked and every authoritative metadata field must still match.
   * - ACTIVE, localization, lifecycle transition, event, and audit completion share one transaction.
   * - A concurrently activated exact artifact converges to replay success.
   *
   * Execution flow:
   * 1. Reauthorize, lock the assessment artifact row, and reload its current state.
   * 2. Return success if an exact concurrent activation already won.
   * 3. Revalidate BUILDING metadata and persist localization plus ACTIVE state.
   * 4. Append the activation event, complete the Assessment, and close an audit request when present.
   *
   * Failure cases:
   * - Missing, changed, conflicting, or non-BUILDING metadata aborts and leaves prior BUILDING authority intact.
   *
   * Side effects:
   * - Atomically updates artifact, localization, events, Assessment lifecycle, and optional audit request.
   */
  private async activateBuildingReport(
    command: SubmitAssessmentFinalReportCommand,
    prepared: PreparedBuildingReport,
  ): Promise<AssessmentFinalReportResult> {
    return this.prisma.$transaction(
      async (tx) => {
        let run = await this.authority.authorizeInTx(tx, {
          assessmentId: command.assessmentId,
          leaseToken: command.leaseToken,
          correlationId: command.correlationId,
          requireActive: false,
        });
        // Row-level serialization prevents two same-digest attempts from
        // activating and transitioning the lifecycle independently.
        await tx.$queryRaw(
          Prisma.sql`SELECT "artifactId" FROM "AssessmentArtifact" WHERE "artifactId" = ${prepared.artifactId} AND "assessmentId" = ${command.assessmentId} FOR UPDATE`,
        );
        const artifact = await tx.assessmentArtifact.findUnique({
          where: { artifactId: prepared.artifactId },
        });
        const metadataMatches = buildingAuthorityMatches(artifact, prepared);
        if (artifact?.lifecycleState === ArtifactLifecycleState.ACTIVE) {
          // Authorization performed before a blocking row lock can observe the
          // previous FINALIZING revision. Refresh after convergence so ACTIVE
          // is reported COMPLETE only from current aggregate authority.
          if (run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE) {
            run = await this.authority.authorizeInTx(tx, {
              assessmentId: command.assessmentId,
              leaseToken: command.leaseToken,
              correlationId: command.correlationId,
              requireActive: false,
            });
          }
          if (
            !metadataMatches ||
            run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.COMPLETE
          ) {
            throw new FinalReportIntegrityError(
              "Concurrent final-report activation authority mismatch",
            );
          }
          return assessmentFinalReportResultSchema.parse({
            artifactId: prepared.artifactId,
            contentSha256: prepared.hash,
            sizeBytes: prepared.sizeBytes,
            lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
            replayed: true,
          });
        }
        if (
          artifact?.lifecycleState !== ArtifactLifecycleState.BUILDING ||
          !metadataMatches ||
          run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.FINALIZING
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_ALREADY_CREATED,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const { enqueueAuthoredDocument } =
          await import("../../../../../platform/localization/authored-localization.service.js");
        const { AUTHORED_LOCALIZATION_ENTITIES } =
          await import("@lcsp/contracts/assessment-domain");
        await enqueueAuthoredDocument(tx, {
          // No reviewed upstream field-language declaration exists at this writer boundary.
          sourceLanguages: {},
          scopeId: command.assessmentId,
          entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
          entityId: prepared.artifactId,
          canonicalRevision: prepared.hash,
          document: prepared.report,
        });
        await tx.assessmentArtifact.update({
          where: { artifactId: prepared.artifactId },
          data: {
            lifecycleState: ArtifactLifecycleState.ACTIVE,
            activatedAt: new Date(),
          },
        });
        await this.events.appendInTx(tx, {
          assessmentId: command.assessmentId,
          correlationId: command.correlationId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          executionId: run.executionId,
          payload: {
            artifactId: prepared.artifactId,
            fromState: ArtifactLifecycleState.BUILDING,
            toState: ArtifactLifecycleState.ACTIVE,
          },
          auditActor: ROOT_AUDIT_ACTOR,
        });
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: command.assessmentId,
            expectedRevision: run.lifecycleRevision,
            toState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
            correlationId: command.correlationId,
            actorId: ORCHESTRATOR.id,
          },
          tx,
          [AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_PERSISTED_AND_VALIDATED],
          ORCHESTRATOR,
        );
        if (run.auditRequestId) {
          await tx.assessmentRuleAuditRequest.update({
            where: { requestId: run.auditRequestId },
            data: {
              status: RULE_AUDIT_STATUSES.COMPLETED,
              completedAt: new Date(),
            },
          });
        }
        return assessmentFinalReportResultSchema.parse({
          artifactId: prepared.artifactId,
          contentSha256: prepared.hash,
          sizeBytes: prepared.sizeBytes,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          replayed: false,
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /**
   * Business purpose: Prove that an exact ACTIVE replay still matches its immutable bytes and pins.
   *
   * Business rules:
   * - Digest equality alone is insufficient; manifest, artifact identity, pins, fingerprint, hash, and size must agree.
   * - The pinned scan job must belong to the same Assessment and repository snapshot as the report.
   * - Replay never rewrites storage or database state.
   *
   * Execution flow:
   * 1. Parse the persisted manifest and reconstruct immutable content.
   * 2. Validate the versioned report and load authoritative rule-set, scan-job, and snapshot records.
   * 3. Compare every persisted identity, ownership, and integrity invariant.
   * 4. Reject unresolved language and return a replay result.
   *
   * Failure cases:
   * - Parser, pin, scan ownership, fingerprint, hash, size, or source-prefix mismatch becomes an integrity conflict.
   *
   * Side effects:
   * - Read-only storage and database verification.
   */
  private async verifyActiveReplay(
    command: SubmitAssessmentFinalReportCommand,
    existing: AssessmentArtifact,
  ): Promise<AssessmentFinalReportResult> {
    const manifest = chunkedManifestSchema.parse(
      JSON.parse(existing.storageRef ?? "") as unknown,
    );
    let stored: string;
    try {
      stored = await withFinalReportDependencyDeadline(
        this.storage.readAndReconstruct(manifest),
      );
    } catch (error) {
      // Storage validates only server-owned manifests on replay, so its
      // BadRequest indicates persisted corruption rather than client input.
      if (error instanceof BadRequestException) {
        throw new FinalReportIntegrityError(
          "Persisted final-report storage integrity mismatch",
        );
      }
      throw error;
    }
    const report = assessmentFinalReportArtifactVersionedSchema.parse(
      JSON.parse(stored) as unknown,
    );
    const primaryPin = reportPrimaryPin(report);
    await this.prisma.$transaction(async (tx) => {
      const pinnedScanJob = await tx.repositoryScanJob.findUnique({
        where: { id: primaryPin.repositoryScanJobId },
        select: { assessmentId: true, snapshotId: true },
      });
      // A scan-job identifier is not sufficient authority by itself. Bind it
      // back to both aggregate and snapshot so a valid foreign job cannot be
      // replayed as provenance for this final report.
      if (
        !pinnedScanJob ||
        pinnedScanJob.assessmentId !== existing.assessmentId ||
        pinnedScanJob.snapshotId !== existing.repositorySnapshotId
      ) {
        throw new FinalReportIntegrityError(
          "Persisted final-report scan-job pin mismatch",
        );
      }
      if ("identity" in report) {
        const pinnedRuleSet = await tx.complianceRuleSetVersion.findUnique({
          where: { id: existing.ruleSetVersionId },
          select: {
            id: true,
            version: true,
            ruleSetDigest: true,
            legalSourceVersion: { select: { id: true, version: true } },
          },
        });
        if (
          !pinnedRuleSet ||
          !reportIdentityMatchesPins(report) ||
          report.pins.ruleSetVersionId !== pinnedRuleSet.id ||
          report.pins.ruleSetVersion !== pinnedRuleSet.version ||
          report.pins.ruleSetDigest !== pinnedRuleSet.ruleSetDigest ||
          report.pins.legalSourceVersionId !==
            pinnedRuleSet.legalSourceVersion.id ||
          report.pins.legalSourceVersion !==
            pinnedRuleSet.legalSourceVersion.version
        ) {
          throw new FinalReportIntegrityError(
            "Persisted final-report pin mismatch",
          );
        }
      }
      if (
        report.schemaVersion === ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION &&
        "sourcePathPrefix" in report.pins
      ) {
        const snapshotRecord = await tx.repositorySnapshot.findUnique({
          where: { id: existing.repositorySnapshotId },
          select: { sourcePathPrefix: true },
        });
        if (
          (snapshotRecord?.sourcePathPrefix ?? null) !==
          (report.pins.sourcePathPrefix ?? null)
        ) {
          throw new FinalReportIntegrityError(
            "Persisted final-report source-prefix mismatch",
          );
        }
      }
      if (report.schemaVersion === ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION) {
        try {
          await assertReportRepositorySetCurrent(
            report,
            [existing.repositorySetDigest],
            (snapshotId) =>
              tx.repositorySnapshot.findUnique({
                where: { id: snapshotId },
                select: { sourcePathPrefix: true },
              }),
          );
        } catch (error) {
          throw new FinalReportIntegrityError(
            error instanceof Error
              ? error.message
              : "Persisted final-report repository set mismatch",
          );
        }
      }
    });
    const expectedFingerprint = decisionFingerprintForReport(report);
    if (
      manifest.artifact_id !== existing.artifactId ||
      report.artifactId !== existing.artifactId ||
      report.assessmentId !== existing.assessmentId ||
      report.kind !== ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT ||
      report.schemaVersion !== existing.schemaVersion ||
      report.pins.ruleSetVersionId !== existing.ruleSetVersionId ||
      primaryPin.repositorySnapshotId !== existing.repositorySnapshotId ||
      primaryPin.repositoryCommit.toLowerCase() !==
        existing.repositoryCommit.toLowerCase() ||
      report.caseRevision !== existing.caseRevision ||
      report.decisionFingerprint !== expectedFingerprint ||
      sha256Hex(stored) !== existing.contentSha256?.replace(/^sha256:/u, "") ||
      Buffer.byteLength(stored, "utf8") !== existing.sizeBytes
    ) {
      throw new FinalReportIntegrityError(
        "Persisted final report failed integrity verification",
      );
    }
    rejectUnresolvedLanguage(report, command.correlationId);
    return assessmentFinalReportResultSchema.parse({
      artifactId: existing.artifactId,
      contentSha256: existing.contentSha256?.replace(/^sha256:/u, ""),
      sizeBytes: existing.sizeBytes,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      replayed: true,
    });
  }
}
