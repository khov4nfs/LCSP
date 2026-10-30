import { createHash } from "node:crypto";

import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferences,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  RULE_AUDIT_STATUSES,
  assessmentFinalReportArtifactSchema,
  assessmentFinalReportResultSchema,
  type AssessmentFinalReportArtifact,
  type AssessmentFinalReportResult,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState, AssessmentArtifactKind } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../../../../../platform/storage/artifact-storage.service.js";
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
const unresolvedSentinelTokens =
  /\b(?:UNKNOWN|PARTIAL|NEEDS_CONTEXT|BLOCKED_UNKNOWN_FACT|TBD)\b/;
const unresolvedPhrases =
  /information\s+(?:is\s+)?still\s+required|open\s+questions?|unresolved\s+(?:question|decision|fact|input)|to\s+be\s+determined/i;

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

type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * Business purpose: Project stored textual applicability conditions, qualifiers and
 *   exceptions into report legal-basis entries.
 *
 * Business rules:
 * - Only string members of an array are retained, verbatim and in their stored order; this is
 *   shape normalization rather than legal interpretation.
 *
 * Execution flow:
 * 1. Filter an array to its string entries, otherwise return an empty list.
 *
 * Failure cases:
 * - Absent or non-array JSON produces an empty list; non-string members are omitted rather
 *   than rendered as legal text.
 *
 * Side effects:
 * - None: returns a new list without changing persisted legal requirements.
 */
const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

/**
 * Business purpose: Attach the pinned source-derived legal basis to each requested report
 *   finding.
 *
 * Business rules:
 * - Read only requested AssessmentRules within the supplied Rule Set; retain linked
 *   LegalRequirement identities, applicability text and exact source provenance.
 * - Order requirements and their provenance by stored ordinals; do not substitute the
 *   currently active Rule Set.
 *
 * Execution flow:
 * 1. Load requested pinned rules with linked requirements and ordered provenance.
 * 2. Normalize the stored text lists and order requirement entries.
 * 3. Return a map keyed by AssessmentRule identity for report assembly.
 *
 * Failure cases:
 * - Missing rules have no map entry and are not fabricated; database errors propagate and
 *   report-schema validation remains the caller’s responsibility.
 *
 * Side effects:
 * - Read-only queries through the supplied transaction; no legal or report state is mutated.
 */
async function loadLegalBasis(
  tx: Tx,
  ruleSetVersionId: string,
  assessmentRuleIds: string[],
) {
  const rules = await tx.assessmentRule.findMany({
    where: { ruleSetVersionId, assessmentRuleId: { in: assessmentRuleIds } },
    select: {
      assessmentRuleId: true,
      concept: true,
      legalIntent: true,
      applicabilityGuidance: true,
      legalRequirementLinks: {
        select: {
          legalRequirement: {
            select: {
              legalRequirementId: true,
              title: true,
              applicabilityConditions: true,
              qualifiers: true,
              exceptions: true,
              ordinal: true,
              provenance: {
                orderBy: { ordinal: "asc" },
                select: {
                  documentId: true,
                  locator: true,
                  contentSha256: true,
                },
              },
            },
          },
        },
      },
    },
  });
  return new Map(
    rules.map((rule) => [
      rule.assessmentRuleId,
      {
        concept: rule.concept,
        legalIntent: rule.legalIntent,
        applicabilityGuidance: rule.applicabilityGuidance,
        legalRequirements: rule.legalRequirementLinks
          .map((link) => link.legalRequirement)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((requirement) => ({
            legalRequirementId: requirement.legalRequirementId,
            title: requirement.title,
            applicabilityConditions: textList(
              requirement.applicabilityConditions,
            ),
            qualifiers: textList(requirement.qualifiers),
            exceptions: textList(requirement.exceptions),
            sources: requirement.provenance,
          })),
      },
    ]),
  );
}

/**
 * Business purpose: Include the accepted frozen evidence and facts that a particular report
 *   decision cites.
 *
 * Business rules:
 * - Resolve references solely from the completion snapshot; include supporting evidence of
 *   cited facts as well as directly cited evidence.
 * - Retain stored commit and source locations without creating citations for missing records.
 *
 * Execution flow:
 * 1. Collect the decision’s evidence and fact identities.
 * 2. Select cited snapshot facts and add their supporting evidence identities.
 * 3. Project matching frozen evidence and facts for the finding.
 *
 * Failure cases:
 * - References missing from the snapshot produce no invented record; upstream completion
 *   validation owns rejection of incomplete authority.
 *
 * Side effects:
 * - None: pure projection of the supplied decision and frozen snapshot.
 */
function citedRecords(
  decision: AssessmentFinalReportArtifact["findings"][number]["decision"],
  snapshot: {
    evidence: Array<{
      evidenceId: string;
      type: string;
      repositoryCommit: string;
      source: { path: string; startLine: number; endLine: number } | null;
    }>;
    facts: Array<{
      factId: string;
      kind: string;
      authority: string;
      statement: string;
      evidenceIds: string[];
    }>;
  },
) {
  const evidenceIds = new Set<string>();
  const factIds = new Set<string>();
  for (const reference of ruleDecisionReferences(decision)) {
    if (reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE) {
      evidenceIds.add(reference.evidenceId);
    } else {
      factIds.add(reference.factId);
    }
  }
  const facts = snapshot.facts.filter((fact) => factIds.has(fact.factId));
  for (const fact of facts) {
    for (const evidenceId of fact.evidenceIds) evidenceIds.add(evidenceId);
  }
  return {
    evidence: snapshot.evidence
      .filter((item) => evidenceIds.has(item.evidenceId))
      .map((item) => ({
        evidenceId: item.evidenceId,
        type: item.type,
        repositoryCommit: item.repositoryCommit,
        ...(item.source ?? {}),
      })),
    facts: facts.map((fact) => ({
      factId: fact.factId,
      kind: fact.kind,
      authority: fact.authority,
      statement: fact.statement,
    })),
  };
}

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

  /**
   * Business purpose: Persist one integrity-checked final report and complete the eligible
   *   Customer Assessment, with exact-request replay support.
   *
   * Business rules:
   * - Authorize the Root lease; a new report requires FINALIZING and a blocker-free completion
   *   snapshot.
   * - Narrative rule identities must exactly cover frozen decisions; preserve pins, revisions,
   *   decision fingerprints and source-backed legal/evidence/fact projections.
   * - An existing ACTIVE report can be replayed only for the same request digest and verified
   *   artifact identity, hash, byte size and decision fingerprint.
   *
   * Execution flow:
   * 1. Authorize the execution and verify an existing report for idempotent replay, if present.
   * 2. For a new report, enforce finalization eligibility and exact finding coverage.
   * 3. Assemble pinned legal basis and frozen citations, validate the report and reject
   *   unresolved report language.
   * 4. Write the immutable artifact, persist BUILDING then ACTIVE metadata/events, and
   *   transition the Assessment to COMPLETE.
   *
   * Failure cases:
   * - Conflicting or damaged existing reports are rejected; wrong lifecycle, completion
   *   blockers or mismatched findings prevent publication.
   * - Schema, unresolved-language, storage and hash-verification failures propagate; database
   *   failures roll back transactional metadata/events but cannot undo already written
   *   immutable storage bytes.
   *
   * Side effects:
   * - Writes immutable artifact bytes, report metadata and audit/runtime events, then completes
   *   the lifecycle transaction; an exact replay only reads and verifies stored content.
   */
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
          report.pins.ruleSetVersionId !== existing.ruleSetVersionId ||
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
          finding.assessmentRuleId,
          finding,
        ]),
      );
      const decisionRuleIds = snapshot.decisions
        .map(({ decision }) => decision.assessmentRuleId)
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

      const legalBasis = await loadLegalBasis(
        tx,
        snapshot.pins.ruleSetVersionId,
        snapshot.decisions.map(({ decision }) => decision.assessmentRuleId),
      );
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
          const narrative = narratives.get(item.decision.assessmentRuleId);
          if (!narrative) {
            throw new Error(
              "Completion snapshot and report narratives diverged",
            );
          }
          return {
            assessmentRuleId: item.decision.assessmentRuleId,
            ...item,
            summary: narrative.summary,
            recommendations: narrative.recommendations,
            legalBasis: legalBasis.get(item.decision.assessmentRuleId),
            ...citedRecords(item.decision, snapshot),
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
          ruleSetVersionId: snapshot.pins.ruleSetVersionId,
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
      if (run.auditRequestId) {
        await tx.assessmentRuleAuditRequest.update({
          where: { requestId: run.auditRequestId },
          data: { status: RULE_AUDIT_STATUSES.COMPLETED, completedAt: new Date() },
        });
      }

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
