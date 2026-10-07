import { createHash } from "node:crypto";

import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  assessmentFinalReportArtifactSchema,
  assessmentFinalReportResultSchema,
  type AssessmentFinalReportArtifact,
  type AssessmentFinalReportResult,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState, AssessmentArtifactKind } from "@prisma/client";
import { z } from "zod";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentCompletionGate } from "../../services/assessment-completion-gate.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { ROOT_AUDIT_ACTOR } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { SubmitAssessmentFinalReportCommand } from "./submit-assessment-final-report.command.js";

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;
const unresolvedReportText =
  /\b(?:UNKNOWN|PARTIAL|NEEDS_CONTEXT|BLOCKED_UNKNOWN_FACT|TBD)\b|information\s+(?:is\s+)?still\s+required|open\s+questions?|unresolved\s+(?:question|decision|fact|input)|to\s+be\s+determined/i;
const chunkedManifestSchema = z.strictObject({
  artifact_id: z.string().uuid(),
  total_size: z.number().int().nonnegative(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  chunks: z.array(z.string().min(1)).min(1),
});

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rejectUnresolvedLanguage(
  report: AssessmentFinalReportArtifact,
  correlationId: string,
): void {
  const text = [
    report.summary,
    ...report.findings.flatMap((finding) => [
      finding.summary,
      finding.decision.rationale,
      ...finding.decision.criteria.map((criterion) => criterion.rationale),
      ...finding.recommendations,
    ]),
  ];
  if (text.some((value) => unresolvedReportText.test(value))) {
    throw problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
}

@CommandHandler(SubmitAssessmentFinalReportCommand)
export class SubmitAssessmentFinalReportHandler implements ICommandHandler<SubmitAssessmentFinalReportCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly completionGate: AssessmentCompletionGate,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly events: AssessmentEventAppender,
    private readonly storage: ArtifactStorageService,
  ) {}

  async execute(
    command: SubmitAssessmentFinalReportCommand,
  ): Promise<AssessmentFinalReportResult> {
    const requestDigest = sha256Hex(canonicalJson(command.request));
    return this.prisma.$transaction(async (tx) => {
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
      if (existing) {
        if (
          existing.reportRequestDigest !== requestDigest ||
          existing.lifecycleState !== ArtifactLifecycleState.ACTIVE ||
          !existing.contentSha256 ||
          existing.sizeBytes === null ||
          !existing.storageRef
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_ALREADY_CREATED,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        const manifest = chunkedManifestSchema.parse(
          JSON.parse(existing.storageRef) as unknown,
        );
        const stored = await this.storage.readAndReconstruct(manifest);
        const report = assessmentFinalReportArtifactSchema.parse(
          JSON.parse(stored) as unknown,
        );
        const expectedFingerprint = `sha256:${sha256Hex(
          canonicalJson(
            report.findings.map(
              ({ decisionId, decisionRevision, decision }) => ({
                decisionId,
                decisionRevision,
                decision,
              }),
            ),
          ),
        )}`;
        if (
          manifest.artifact_id !== existing.artifactId ||
          report.artifactId !== existing.artifactId ||
          report.assessmentId !== existing.assessmentId ||
          report.kind !== ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT ||
          report.schemaVersion !== existing.schemaVersion ||
          report.pins.legalPortfolioVersionId !==
            existing.legalPortfolioVersionId ||
          report.pins.repositorySnapshotId !== existing.repositorySnapshotId ||
          report.pins.repositoryCommit.toLowerCase() !==
            existing.repositoryCommit.toLowerCase() ||
          report.caseRevision !== existing.caseRevision ||
          report.decisionFingerprint !== expectedFingerprint ||
          sha256Hex(stored) !==
            existing.contentSha256.replace(/^sha256:/u, "") ||
          Buffer.byteLength(stored, "utf8") !== existing.sizeBytes
        ) {
          throw new Error(
            "Persisted final report failed integrity verification",
          );
        }
        rejectUnresolvedLanguage(report, command.correlationId);
        return assessmentFinalReportResultSchema.parse({
          artifactId: existing.artifactId,
          contentSha256: existing.contentSha256.replace(/^sha256:/u, ""),
          sizeBytes: existing.sizeBytes,
          lifecycleState: run.lifecycleState,
          replayed: true,
        });
      }

      if (run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.FINALIZING) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
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

      const snapshot = inspection.snapshot;
      const narratives = new Map(
        command.request.findings.map((finding) => [
          finding.engineeringRuleId,
          finding,
        ]),
      );
      const decisionRuleIds = snapshot.decisions
        .map(({ decision }) => decision.engineeringRuleId)
        .sort();
      const narrativeRuleIds = [...narratives.keys()].sort();
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

      const artifactId = deterministicUuid(
        `${command.assessmentId}:${requestDigest}`,
      );
      const decisionFingerprint = `sha256:${sha256Hex(
        canonicalJson(snapshot.decisions),
      )}`;
      const report = assessmentFinalReportArtifactSchema.parse({
        schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
        artifactId,
        assessmentId: command.assessmentId,
        kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        pins: snapshot.pins,
        caseRevision: snapshot.caseRevision,
        decisionFingerprint,
        summary: command.request.summary,
        findings: snapshot.decisions.map((item) => {
          const narrative = narratives.get(item.decision.engineeringRuleId);
          if (!narrative) {
            throw new Error(
              "Completion snapshot and report narratives diverged",
            );
          }
          return {
            engineeringRuleId: item.decision.engineeringRuleId,
            ...item,
            summary: narrative.summary,
            recommendations: narrative.recommendations,
          };
        }),
        provenance: {
          evidenceIds: snapshot.evidence.map((item) => item.evidenceId),
          factIds: snapshot.facts.map((item) => item.factId),
          searchCoverageEvidenceIds: snapshot.evidence
            .filter(
              (item) => item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
            )
            .map((item) => item.evidenceId),
        },
      });
      rejectUnresolvedLanguage(report, command.correlationId);

      const content = canonicalJson(report);
      const hash = sha256Hex(content);
      const { manifest, sizeBytes } = await this.storage.writeImmutableArtifact(
        artifactId,
        content,
      );
      if (manifest.hash !== hash) {
        throw new Error("Final report hash changed during persistence");
      }

      await tx.assessmentArtifact.create({
        data: {
          artifactId,
          assessmentId: command.assessmentId,
          kind: AssessmentArtifactKind.FINAL_REPORT,
          lifecycleState: ArtifactLifecycleState.BUILDING,
          legalPortfolioVersionId: snapshot.pins.legalPortfolioVersionId,
          repositorySnapshotId: snapshot.pins.repositorySnapshotId,
          repositoryCommit: snapshot.pins.repositoryCommit,
          caseRevision: snapshot.caseRevision,
          schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
          reportRequestDigest: requestDigest,
        },
      });
      await this.events.appendInTx(tx, {
        assessmentId: command.assessmentId,
        correlationId: command.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        executionId: run.executionId,
        payload: {
          artifactId,
          fromState: null,
          toState: ArtifactLifecycleState.BUILDING,
        },
        auditActor: ROOT_AUDIT_ACTOR,
      });
      await tx.assessmentArtifact.update({
        where: { artifactId },
        data: {
          lifecycleState: ArtifactLifecycleState.ACTIVE,
          contentSha256: `sha256:${hash}`,
          sizeBytes,
          storageRef: JSON.stringify(manifest),
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
          artifactId,
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

      return assessmentFinalReportResultSchema.parse({
        artifactId,
        contentSha256: hash,
        sizeBytes,
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
        replayed: false,
      });
    });
  }
}
