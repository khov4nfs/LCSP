import { createHash } from "node:crypto";
import { Injectable, HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_ERROR_CODES,
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentHumanRequestViewSchema,
  assessmentProvenanceArtifactSchema,
  ruleDecisionRecordSchema,
  type AssessmentProvenanceArtifact,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { sanitizeAgentStreamValue } from "../../../../platform/runtime-events/agent-stream-sanitizer.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";
import { toAssessmentEvent } from "../../../../platform/runtime-events/canonical-assessment-event.mapper.js";

/**
 * Loads the canonical Assessment Provenance Audit Trail and validates all references fail-closed.
 */
@Injectable()
export class AssessmentProvenanceLoader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Export the complete, verifiable provenance of an Assessment for its authorized reader.
   *
   * Business rules:
   * - Customers may read only their own Assessment; every record and reference must retain the same Assessment and immutable pins.
   * - A confirmed-fact reference names the decision's case revision. Its fact may originate in an earlier revision, but never after that decision.
   * - Selected scope counts only requested coverage and accepted resolved decisions; unrequested rules receive no legal outcome.
   * - Preserve historical revisions and human answers while redacting sensitive runtime payloads.
   *
   * Execution flow:
   * 1. Load the Assessment, pinned case and complete durable history, then enforce ownership.
   * 2. Verify record identities, pins and cross-references against the decision snapshot that used them.
   * 3. Project the history, redact sensitive payloads and return a schema-validated artifact with a deterministic checksum.
   *
   * Failure cases:
   * - Missing or foreign-owned Assessments return not found; broken references, future facts, mismatched pins or coverage exceeding the pinned catalog return a provenance integrity conflict.
   * - Invalid persisted contract shapes fail validation rather than producing a misleading audit trail.
   *
   * Side effects: Read-only database access and pure artifact projection; no state, checkpoint, decision or answer is rewritten.
   */
  async load(input: {
    assessmentId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
  }): Promise<AssessmentProvenanceArtifact> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: input.assessmentId },
      include: {
        runtime: true,
        domainCase: {
          include: {
            ruleSet: {
              include: {
                legalSourceVersion: true,
                _count: {
                  select: {
                    rules: true,
                    assessmentRules: true,
                  },
                },
              },
            },
            facts: {
              include: {
                evidenceLinks: true,
              },
              orderBy: [{ caseRevision: "asc" }, { createdAt: "asc" }],
            },
            evidence: {
              orderBy: { createdAt: "asc" },
            },
            decisions: {
              orderBy: [
                { assessmentRuleId: "asc" },
                { decisionRevision: "asc" },
              ],
            },
            coverage: {
              include: {
                assessmentRule: true,
              },
              orderBy: { assessmentRuleId: "asc" },
            },
            humanRequests: {
              orderBy: { createdAt: "asc" },
            },
            artifacts: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        events: {
          orderBy: { sequence: "asc" },
        },
      },
    });

    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Tenant / Owner enforcement: Customer role can ONLY view their own assessment.
    if (
      input.subjectRole === AUTH_USER_ROLES.customer &&
      assessment.ownerId !== input.sessionUserId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const domainCase = assessment.domainCase;

    // Fail-closed provenance reference and integrity verification
    if (domainCase) {
      if (domainCase.assessmentId !== input.assessmentId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const evidenceIdSet = new Set(
        domainCase.evidence.map((e) => e.evidenceId),
      );
      const factIdSet = new Set(domainCase.facts.map((f) => f.factId));
      const factMap = new Map(domainCase.facts.map((f) => [f.factId, f]));
      const decisionMap = new Map(
        domainCase.decisions.map((d) => [d.decisionId, d]),
      );

      // 1. Facts validation
      for (const fact of domainCase.facts) {
        if (fact.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        for (const link of fact.evidenceLinks) {
          if (
            (link.assessmentId && link.assessmentId !== input.assessmentId) ||
            !evidenceIdSet.has(link.evidenceId)
          ) {
            throw problemException(
              ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
              input.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
        }
      }

      // 2. Evidence validation (assessmentId and pinned commit cross-check)
      for (const evidence of domainCase.evidence) {
        if (evidence.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositoryCommit &&
          evidence.repositoryCommit !== domainCase.repositoryCommit
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }

      // 3. Decisions validation (row pins + parsed decision content references & pins)
      for (const decision of domainCase.decisions) {
        if (decision.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.ruleSetVersionId &&
          decision.ruleSetVersionId !== domainCase.ruleSetVersionId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositoryCommit &&
          decision.repositoryCommit !== domainCase.repositoryCommit
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (decision.caseRevision > domainCase.caseRevision) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Validate nested decision content payload references and pins
        const decPayload =
          typeof decision.decision === "object" && decision.decision !== null
            ? (decision.decision as Record<string, unknown>)
            : {};

        if (
          domainCase.ruleSetVersionId &&
          decPayload.ruleSetVersionId &&
          decPayload.ruleSetVersionId !== domainCase.ruleSetVersionId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositorySnapshotId &&
          decPayload.repositorySnapshotId &&
          decPayload.repositorySnapshotId !== domainCase.repositorySnapshotId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositoryCommit &&
          decPayload.repositoryCommit &&
          decPayload.repositoryCommit !== domainCase.repositoryCommit
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          typeof decPayload.caseRevision === "number" &&
          decPayload.caseRevision > domainCase.caseRevision
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Validate references in decision and its criteria
        const referencesToCheck: Array<{
          type?: string;
          evidenceId?: string;
          factId?: string;
          caseRevision?: number;
        }> = [];

        if (Array.isArray(decPayload.references)) {
          referencesToCheck.push(
            ...(decPayload.references as Array<{
              type?: string;
              evidenceId?: string;
              factId?: string;
              caseRevision?: number;
            }>),
          );
        }
        if (Array.isArray(decPayload.criteria)) {
          for (const crit of decPayload.criteria) {
            if (
              typeof crit === "object" &&
              crit !== null &&
              Array.isArray((crit as Record<string, unknown>).references)
            ) {
              referencesToCheck.push(
                ...((crit as Record<string, unknown>).references as Array<{
                  type?: string;
                  evidenceId?: string;
                  factId?: string;
                  caseRevision?: number;
                }>),
              );
            }
          }
        }

        for (const ref of referencesToCheck) {
          if (ref.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE) {
            if (!ref.evidenceId || !evidenceIdSet.has(ref.evidenceId)) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          } else if (
            ref.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT
          ) {
            if (!ref.factId || !factIdSet.has(ref.factId)) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
            const confirmedFact = factMap.get(ref.factId);
            if (
              !confirmedFact ||
              ref.caseRevision !== decision.caseRevision ||
              confirmedFact.caseRevision > decision.caseRevision
            ) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          }
        }
      }

      // 4. Coverage validation (currentDecisionId must resolve to a valid same-assessment decision for that rule)
      for (const cov of domainCase.coverage) {
        if (cov.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (cov.currentDecisionId) {
          const resolvedDec = decisionMap.get(cov.currentDecisionId);
          if (
            !resolvedDec ||
            resolvedDec.assessmentRuleId !== cov.assessmentRuleId ||
            (cov.decisionRevision != null &&
              resolvedDec.decisionRevision !== cov.decisionRevision)
          ) {
            throw problemException(
              ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
              input.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
        }
      }

      // 5. Human Requests validation (resolvedFactId cross-check)
      for (const request of domainCase.humanRequests) {
        if (request.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (request.resolvedFactId && !factIdSet.has(request.resolvedFactId)) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }

      // 6. Artifacts validation (cross-check pins against canonical case)
      for (const artifact of domainCase.artifacts) {
        if (artifact.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.ruleSetVersionId &&
          artifact.ruleSetVersionId &&
          artifact.ruleSetVersionId !== domainCase.ruleSetVersionId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositorySnapshotId &&
          artifact.repositorySnapshotId &&
          artifact.repositorySnapshotId !== domainCase.repositorySnapshotId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          domainCase.repositoryCommit &&
          artifact.repositoryCommit &&
          artifact.repositoryCommit !== domainCase.repositoryCommit
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          artifact.caseRevision != null &&
          artifact.caseRevision > domainCase.caseRevision
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }
    }

    for (const event of assessment.events) {
      if (event.assessmentId !== input.assessmentId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (
        assessment.runtime &&
        event.threadId !== assessment.runtime.threadId
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
    }

    const canonical = projectCanonicalAssessment(
      assessment.id,
      assessment,
      input.correlationId,
    );

    // Build pins
    const pins = domainCase
      ? {
          ruleSet: domainCase.ruleSet
            ? {
                ruleSetVersionId: domainCase.ruleSet.id,
                version: domainCase.ruleSet.version,
                legalSourceVersion:
                  typeof domainCase.ruleSet.legalSourceVersion === "object" &&
                  domainCase.ruleSet.legalSourceVersion !== null &&
                  "version" in domainCase.ruleSet.legalSourceVersion
                    ? (
                        domainCase.ruleSet.legalSourceVersion as {
                          version: string;
                        }
                      ).version
                    : String(domainCase.ruleSet.legalSourceVersion ?? "1.0.0"),
                legalRequirementCount:
                  domainCase.ruleSet._count?.rules ??
                  (domainCase.ruleSet as { legalRequirementCount?: number })
                    .legalRequirementCount ??
                  0,
                assessmentRuleCount:
                  domainCase.ruleSet._count?.assessmentRules ??
                  (domainCase.ruleSet as { assessmentRuleCount?: number })
                    .assessmentRuleCount ??
                  0,
              }
            : null,
          repositorySnapshotId: domainCase.repositorySnapshotId,
          repositoryScanJobId: domainCase.repositoryScanJobId,
          repositoryCommit: domainCase.repositoryCommit,
          pinnedAt: domainCase.pinnedAt
            ? domainCase.pinnedAt.toISOString()
            : null,
        }
      : null;

    // Sanitize and map accepted facts
    const acceptedFacts = (domainCase?.facts ?? []).map((fact) => ({
      factId: fact.factId,
      assessmentId: fact.assessmentId,
      caseRevision: fact.caseRevision,
      kind: fact.kind,
      authority: fact.authority,
      state: fact.state,
      statement: fact.statement,
      evidenceIds: fact.evidenceLinks.map((link) => link.evidenceId),
      createdAt: fact.createdAt.toISOString(),
    }));

    // Sanitize and map accepted evidence
    const acceptedEvidence = (domainCase?.evidence ?? []).map((evidence) => {
      const sanitizedPayload = (sanitizeAgentStreamValue(evidence.payload) ??
        {}) as Record<string, unknown>;
      return {
        evidenceId: evidence.evidenceId,
        assessmentId: evidence.assessmentId,
        type: evidence.type,
        state: evidence.state,
        repositoryCommit: evidence.repositoryCommit,
        contentSha256: evidence.contentSha256,
        payload: sanitizedPayload,
        createdAt: evidence.createdAt.toISOString(),
      };
    });

    // Map human resolutions preserving answers verbatim
    const humanResolutions = (domainCase?.humanRequests ?? []).map((hr) =>
      assessmentHumanRequestViewSchema.parse({
        requestId: hr.requestId,
        requestRevision: hr.requestRevision,
        openedCaseRevision: hr.caseRevision,
        status: hr.status,
        assessmentRuleId: hr.assessmentRuleId,
        criterionIds: hr.criterionIds,
        question: hr.question,
        unresolvedFact: hr.unresolvedFact,
        decisionImpact: hr.decisionImpact,
        resolutionAttempts: hr.resolutionAttempts,
        controlType: hr.controlType,
        choices: hr.choices,
        checkpointId: hr.checkpointId,
        resolvedFactId: hr.resolvedFactId,
        answers: hr.answers,
      }),
    );

    // Map decisions with sanitized decision payload
    const decisions = (domainCase?.decisions ?? []).map((dec) => {
      const sanitizedDecision = sanitizeAgentStreamValue(dec.decision);
      return ruleDecisionRecordSchema.parse({
        decisionId: dec.decisionId,
        assessmentId: dec.assessmentId,
        assessmentRuleId: dec.assessmentRuleId,
        scopeId: dec.scopeId,
        decisionRevision: dec.decisionRevision,
        state: dec.state,
        decision: sanitizedDecision,
        createdAt: dec.createdAt.toISOString(),
      });
    });

    // Map coverage
    const coverage = (domainCase?.coverage ?? []).map((cov) => ({
      assessmentRuleId: cov.assessmentRuleId,
      assessmentRuleVersion: cov.assessmentRuleVersion,
      resolutionState: cov.resolutionState,
      currentDecisionId: cov.currentDecisionId,
      decisionRevision: cov.decisionRevision,
      concept: cov.assessmentRule.concept,
    }));

    // Map events with sanitized payload
    const events = assessment.events.map((evt) => {
      const sanitizedPayload = sanitizeAgentStreamValue(evt.payload) ?? {};
      const sanitizedUsage = evt.tokenUsage
        ? sanitizeAgentStreamValue(evt.tokenUsage, 0, true)
        : undefined;
      return toAssessmentEvent({
        ...evt,
        payload: sanitizedPayload,
        tokenUsage: sanitizedUsage,
      });
    });

    // Map artifacts
    const artifacts = (domainCase?.artifacts ?? []).map((art) => ({
      artifactId: art.artifactId,
      kind: art.kind,
      lifecycleState: art.lifecycleState,
      ruleSetVersionId: art.ruleSetVersionId,
      repositorySnapshotId: art.repositorySnapshotId,
      repositoryCommit: art.repositoryCommit,
      caseRevision: art.caseRevision,
      contentSha256: art.contentSha256
        ? art.contentSha256.replace(/^sha256:/u, "")
        : null,
      sizeBytes: art.sizeBytes,
      createdAt: art.createdAt.toISOString(),
    }));

    const generatedAt = new Date().toISOString();
    const totalPinned = pins?.ruleSet?.assessmentRuleCount ?? 0;
    const auditMode =
      domainCase?.auditMode ?? ASSESSMENT_AUDIT_MODES.LEGACY_FULL;
    const requested =
      auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED
        ? coverage.length
        : totalPinned;
    if (requested > totalPinned) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const accepted = new Map(
      decisions.map((decision) => [decision.decisionId, decision]),
    );
    const ready = coverage.filter(
      (item) =>
        item.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED &&
        item.currentDecisionId &&
        accepted.get(item.currentDecisionId)?.state ===
          ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    ).length;
    const auditScope = {
      auditMode,
      totalPinned,
      requested,
      ready,
      notRequested: totalPinned - requested,
    };

    const stableProvenancePayload = {
      schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
      assessmentId: assessment.id,
      name: assessment.name,
      ownerId: assessment.ownerId,
      lifecycle: canonical.lifecycle,
      auditScope,
      pins,
      runtime: canonical.runtime,
      acceptedFacts,
      acceptedEvidence,
      humanResolutions,
      decisions,
      coverage,
      events,
      artifacts,
    };

    const contentFingerprintSha256 = createHash("sha256")
      .update(JSON.stringify(stableProvenancePayload))
      .digest("hex");

    const provenanceArtifact: AssessmentProvenanceArtifact = {
      ...stableProvenancePayload,
      generatedAt,
      correlationId: input.correlationId,
      contentFingerprintSha256,
      checksumSha256: contentFingerprintSha256,
    };

    return assessmentProvenanceArtifactSchema.parse(provenanceArtifact);
  }
}
