import { createHash } from "node:crypto";
import { Injectable, HttpStatus } from "@nestjs/common";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
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
   * Loads the complete provenance of an assessment with strict owner checks,
   * reference integrity validation, sensitive payload redaction, and deterministic SHA-256 checksumming.
   *
   * @param input - The assessment ID, requesting user session, subject role, and correlation ID.
   * @returns The fully validated, immutable AssessmentProvenanceArtifact.
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

      for (const evidence of domainCase.evidence) {
        if (evidence.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }

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
      }

      for (const request of domainCase.humanRequests) {
        if (request.assessmentId !== input.assessmentId) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }

      for (const artifact of domainCase.artifacts) {
        if (artifact.assessmentId !== input.assessmentId) {
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

    const baseArtifact = {
      schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
      assessmentId: assessment.id,
      name: assessment.name,
      ownerId: assessment.ownerId,
      generatedAt,
      correlationId: input.correlationId,
      lifecycle: canonical.lifecycle,
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

    const checksumSha256 = createHash("sha256")
      .update(JSON.stringify(baseArtifact))
      .digest("hex");

    const provenanceArtifact: AssessmentProvenanceArtifact = {
      ...baseArtifact,
      checksumSha256,
    };

    return assessmentProvenanceArtifactSchema.parse(provenanceArtifact);
  }
}
