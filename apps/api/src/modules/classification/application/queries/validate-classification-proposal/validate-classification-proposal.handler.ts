import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  EvidenceAcceptanceStatus,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_BASELINE_LABELS,
  CLASSIFICATION_PROPOSAL_NEXT_STATES,
  CLASSIFICATION_PROPOSAL_VERDICTS,
  CLASSIFICATION_PROPOSAL_VIOLATION_CODES,
  VALIDATE_CLASSIFICATION_PROPOSAL_TOOL,
  type ClassificationProposalViolationCode,
  type ValidateClassificationProposalResponse,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ValidateClassificationProposalQuery } from "./validate-classification-proposal.query.js";

const BASELINE_REF_PREFIX = "baseline:";
const CITATION_REF_PREFIX = "citation:";

type RuleMatchProjection = {
  id: string;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

type Violation =
  ValidateClassificationProposalResponse["result"]["violations"][number];

@QueryHandler(ValidateClassificationProposalQuery)
export class ValidateClassificationProposalHandler implements IQueryHandler<
  ValidateClassificationProposalQuery,
  ValidateClassificationProposalResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: ValidateClassificationProposalQuery,
  ): Promise<ValidateClassificationProposalResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId, organizationId: query.organizationId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const ruleMatchId = idFromRef(query.input.baselineRef, BASELINE_REF_PREFIX);
    const [ruleMatch, existingResult] = await Promise.all([
      this.prisma.legalRuleMatch.findFirst({
        where: {
          id: ruleMatchId,
          assessmentId: assessment.id,
          organizationId: query.organizationId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          citationAllowlist: true,
          overallCoverageStatus: true,
          guardrailStatus: true,
          blockedReason: true,
        },
      }),
      this.prisma.classificationResult.findUnique({
        where: { legalRuleMatchId: ruleMatchId },
        select: { id: true },
      }),
    ]);

    if (!ruleMatch) {
      return this.writeAndReturn(
        query,
        assessment.id,
        null,
        this.terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          CLASSIFICATION_PROPOSAL_VIOLATION_CODES.baselineUnavailable,
          query.input.baselineRef,
          "The pinned classification baseline cannot be resolved to an accepted legal rule match.",
        ),
      );
    }

    if (ruleMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED) {
      return this.writeAndReturn(
        query,
        assessment.id,
        ruleMatch,
        this.terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.conflict,
          AGENTIC_TOOL_COVERAGE_STATES.limited,
          CLASSIFICATION_PROPOSAL_VIOLATION_CODES.guardrailBlocked,
          query.input.baselineRef,
          ruleMatch.blockedReason ??
            "The baseline legal rule match guardrail blocks classification.",
        ),
      );
    }

    if (
      ruleMatch.overallCoverageStatus !==
      OverallCoverageStatus.COMPLETE_CITATION
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        ruleMatch,
        this.terminalResponse(
          query,
          AGENTIC_TOOL_STATUSES.outOfCoverage,
          AGENTIC_TOOL_COVERAGE_STATES.partial,
          CLASSIFICATION_PROPOSAL_VIOLATION_CODES.citationCoverageLimited,
          query.input.baselineRef,
          "The baseline does not have complete citation coverage.",
        ),
      );
    }

    const violations: Violation[] = [];
    if (
      query.input.candidateLabel !== CLASSIFICATION_BASELINE_LABELS.candidateA
    ) {
      violations.push(
        violation(
          CLASSIFICATION_PROPOSAL_VIOLATION_CODES.labelNotEligible,
          query.input.candidateLabel,
        ),
      );
    }
    const allowlist = citationRefs(ruleMatch.citationAllowlist);
    for (const citationRef of query.input.citationRefs.slice().sort()) {
      if (!allowlist.includes(citationRef)) {
        violations.push(
          violation(
            CLASSIFICATION_PROPOSAL_VIOLATION_CODES.citationOutOfAllowlist,
            citationRef,
          ),
        );
      }
    }
    if (existingResult) {
      violations.push(
        violation(
          CLASSIFICATION_PROPOSAL_VIOLATION_CODES.resultAlreadyExists,
          query.input.baselineRef,
        ),
      );
    }

    const response =
      violations.length === 0
        ? this.readyResponse(query)
        : this.failResponse(query, violations);
    return this.writeAndReturn(query, assessment.id, ruleMatch, response);
  }

  private readyResponse(
    query: ValidateClassificationProposalQuery,
  ): ValidateClassificationProposalResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.validateClassificationProposal,
      toolVersion: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.version,
      configHash: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { baselineRef: query.input.baselineRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: query.input.citationRefs.slice().sort(),
      limitations: [],
      result: {
        proposalGateRef: proposalGateRef(query.input),
        verdict: CLASSIFICATION_PROPOSAL_VERDICTS.pass,
        violations: [],
        allowedNextState:
          CLASSIFICATION_PROPOSAL_NEXT_STATES.readyForIndependentReview,
      },
    };
  }

  private failResponse(
    query: ValidateClassificationProposalQuery,
    violations: Violation[],
  ): ValidateClassificationProposalResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.validateClassificationProposal,
      toolVersion: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.version,
      configHash: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { baselineRef: query.input.baselineRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: query.input.citationRefs.slice().sort(),
      limitations: [],
      result: {
        proposalGateRef: proposalGateRef(query.input),
        verdict: CLASSIFICATION_PROPOSAL_VERDICTS.fail,
        violations: violations.slice(
          0,
          VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.maxViolations,
        ),
        allowedNextState: null,
      },
    };
  }

  private terminalResponse(
    query: ValidateClassificationProposalQuery,
    status: ValidateClassificationProposalResponse["status"],
    coverageState: ValidateClassificationProposalResponse["coverageState"],
    code: ClassificationProposalViolationCode,
    ref: string | null,
    reason: string,
  ): ValidateClassificationProposalResponse {
    const currentViolation = violation(code, ref);
    return {
      status,
      toolName: AGENTIC_TOOL_NAMES.validateClassificationProposal,
      toolVersion: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.version,
      configHash: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { baselineRef: query.input.baselineRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState,
      evidenceRefs: [],
      limitations: [
        {
          code,
          affectedScopeRef: ref,
          reason,
          retryable: false,
        },
      ],
      result: {
        proposalGateRef: proposalGateRef(query.input),
        verdict: CLASSIFICATION_PROPOSAL_VERDICTS.fail,
        violations: [currentViolation],
        allowedNextState: null,
      },
    };
  }

  private async writeAndReturn(
    query: ValidateClassificationProposalQuery,
    assessmentId: string,
    ruleMatch: RuleMatchProjection | null,
    response: ValidateClassificationProposalResponse,
  ): Promise<ValidateClassificationProposalResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.classificationProposalValidated,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: ruleMatch
        ? AUDIT_RESOURCE_TYPES.legalRuleMatch
        : AUDIT_RESOURCE_TYPES.assessment,
      resourceId: ruleMatch?.id ?? assessmentId,
      correlationId: query.correlationId,
      policyId: query.policyId,
      policyVersion: query.policyVersion,
      decision:
        response.status === AGENTIC_TOOL_STATUSES.ready
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: response.result.verdict,
      payload: {
        toolName: response.toolName,
        baselineRef: query.input.baselineRef,
        proposalHash: safeHash({
          candidateLabel: query.input.candidateLabel,
          citationRefs: query.input.citationRefs.slice().sort(),
        }),
        outputHash: safeHash(response),
        violationCodes: response.result.violations.map(({ code }) => code),
      },
    });
    return response;
  }
}

function citationRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        if (typeof item !== "string") return [];
        if (item.startsWith(CITATION_REF_PREFIX) && item.includes("chunk_")) {
          return [item];
        }
        if (item.startsWith("chunk_")) return [`${CITATION_REF_PREFIX}${item}`];
        return [];
      }),
    ),
  ].sort();
}

function violation(
  code: ClassificationProposalViolationCode,
  ref: string | null,
): Violation {
  return { code, ref };
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function provenanceRef(correlationId: string): string {
  return `provenance:classification-gate:${correlationId}`;
}

export function proposalGateRef(input: {
  baselineRef: string;
  candidateLabel: string;
  citationRefs: string[];
}): string {
  return `classification-gate:${createHash("sha256")
    .update(
      JSON.stringify({
        baselineRef: input.baselineRef,
        candidateLabel: input.candidateLabel,
        citationRefs: input.citationRefs.slice().sort(),
      }),
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
