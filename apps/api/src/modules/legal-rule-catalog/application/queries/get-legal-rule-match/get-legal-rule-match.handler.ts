import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  EvidenceAcceptanceStatus,
  LegalRuleLifecycleStatus,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
  VerifiedProfileStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  GET_LEGAL_RULE_MATCH_TOOL,
  LEGAL_RULE_MATCH_APPLICABILITY,
  LEGAL_RULE_MATCH_LIMITATION_CODES,
  type GetLegalRuleMatchResponse,
  type LegalRuleMatchLimitationCode,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetLegalRuleMatchQuery } from "./get-legal-rule-match.query.js";

const PROFILE_REF_PREFIX = "profile_";
const LEGAL_RULE_MATCH_REF_PREFIX = "legal_rule_match_";
const CORPUS_REF_PREFIX = "corpus_";
const CATALOG_REF_PREFIX = "legal_rule_catalog_";
const CITATION_REF_PREFIX = "citation:";

type AcceptedMatch = {
  id: string;
  corpusVersionId: string;
  legalRuleCatalogVersionId: string;
  matches: unknown;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
  guardrailStatus: LegalRuleMatchGuardrailStatus;
  blockedReason: string | null;
};

type RuleProjection = {
  legalRuleId: string;
  legalRuleCatalogVersionId: string;
  requiredFacts: unknown;
};

type MatchItem = Record<string, unknown>;

@QueryHandler(GetLegalRuleMatchQuery)
export class GetLegalRuleMatchHandler implements IQueryHandler<
  GetLegalRuleMatchQuery,
  GetLegalRuleMatchResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetLegalRuleMatchQuery,
  ): Promise<GetLegalRuleMatchResponse> {
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

    const profileId = idFromRef(
      query.input.verifiedProfileId,
      PROFILE_REF_PREFIX,
    );
    const [verifiedProfile, rule] = await Promise.all([
      this.prisma.verifiedProfile.findFirst({
        where: {
          id: profileId,
          assessmentId: assessment.id,
          organizationId: query.organizationId,
          status: VerifiedProfileStatus.APPROVED,
        },
        select: { id: true },
      }),
      this.prisma.legalRule.findFirst({
        where: {
          legalRuleId: query.input.ruleId,
          status: LegalRuleLifecycleStatus.APPROVED,
        },
        select: {
          legalRuleId: true,
          legalRuleCatalogVersionId: true,
          requiredFacts: true,
        },
      }),
    ]);

    if (!verifiedProfile) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.limitedResponse(
          query,
          null,
          null,
          LEGAL_RULE_MATCH_LIMITATION_CODES.projectionUnavailable,
          query.input.verifiedProfileId,
          "The pinned verified profile is unavailable or not approved for this assessment.",
        ),
      );
    }
    if (!rule) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.limitedResponse(
          query,
          null,
          null,
          LEGAL_RULE_MATCH_LIMITATION_CODES.ruleUnavailable,
          query.input.ruleId,
          "The requested approved legal rule is unavailable.",
        ),
      );
    }

    const acceptedMatch = await this.prisma.legalRuleMatch.findFirst({
      where: {
        verifiedProfileId: verifiedProfile.id,
        assessmentId: assessment.id,
        organizationId: query.organizationId,
        legalRuleCatalogVersionId: rule.legalRuleCatalogVersionId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        corpusVersionId: true,
        legalRuleCatalogVersionId: true,
        matches: true,
        citationAllowlist: true,
        overallCoverageStatus: true,
        guardrailStatus: true,
        blockedReason: true,
      },
    });

    if (!acceptedMatch) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.limitedResponse(
          query,
          rule,
          null,
          LEGAL_RULE_MATCH_LIMITATION_CODES.noAcceptedMatch,
          query.input.ruleId,
          "No accepted legal rule match exists for the pinned verified profile and rule catalog.",
        ),
      );
    }

    const allowedCitationRefs = sortedCitationRefs(
      acceptedMatch.citationAllowlist,
    );
    const requestedCitationRefs = query.input.citationRefs.slice().sort();
    const allRequestedAllowed = requestedCitationRefs.every((citationRef) =>
      allowedCitationRefs.includes(citationRef),
    );
    if (!allRequestedAllowed) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.blockedResponse(
          query,
          rule,
          acceptedMatch,
          LEGAL_RULE_MATCH_LIMITATION_CODES.citationMismatch,
          "The requested citations are outside the accepted rule-match allowlist.",
        ),
      );
    }

    const matchItem = findRuleMatchItem(
      acceptedMatch.matches,
      query.input.ruleId,
    );
    if (!matchItem) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.limitedResponse(
          query,
          rule,
          acceptedMatch,
          LEGAL_RULE_MATCH_LIMITATION_CODES.noAcceptedMatch,
          query.input.ruleId,
          "The accepted legal rule match does not include the requested rule.",
        ),
      );
    }

    if (
      acceptedMatch.guardrailStatus === LegalRuleMatchGuardrailStatus.BLOCKED ||
      acceptedMatch.blockedReason
    ) {
      return this.writeAndReturn(
        query,
        assessment.id,
        this.conflictResponse(query, rule, acceptedMatch, matchItem),
      );
    }

    const requiredFacts = factRefs(rule.requiredFacts);
    const explicitKnownFacts = factRefs(
      matchItem.knownFacts ?? matchItem.known_facts,
    );
    const usageClaimRefs = factRefs(
      matchItem.usage_claim_ref ?? matchItem.usageClaimRef,
    );
    const knownFacts = capFacts(
      [...explicitKnownFacts, ...usageClaimRefs, ...requiredFacts].filter(
        (fact) =>
          explicitKnownFacts.includes(fact) ||
          usageClaimRefs.includes(fact) ||
          requiredFacts.length === 0,
      ),
    );
    const unknownFacts = capFacts(
      factRefs(matchItem.unknownFacts ?? matchItem.unknown_facts),
    );
    const missingFacts = capFacts(
      requiredFacts.filter((fact) => !knownFacts.includes(fact)),
    );
    const coverageValue = matchItem.coverage_status ?? matchItem.coverageStatus;
    const coverageStatus =
      typeof coverageValue === "string" ? coverageValue : "";
    const hasLimitedCoverage =
      acceptedMatch.overallCoverageStatus !==
        OverallCoverageStatus.COMPLETE_CITATION ||
      coverageStatus === OverallCoverageStatus.PARTIAL_CITATION ||
      coverageStatus === OverallCoverageStatus.NO_CITATION;

    const status = hasLimitedCoverage
      ? AGENTIC_TOOL_STATUSES.outOfCoverage
      : AGENTIC_TOOL_STATUSES.ready;
    const applicability =
      missingFacts.length === 0 &&
      unknownFacts.length === 0 &&
      !hasLimitedCoverage
        ? LEGAL_RULE_MATCH_APPLICABILITY.applicable
        : LEGAL_RULE_MATCH_APPLICABILITY.conditional;
    const limitations = hasLimitedCoverage
      ? [
          limitation(
            LEGAL_RULE_MATCH_LIMITATION_CODES.coverageLimited,
            query.input.ruleId,
            "The accepted match has incomplete citation coverage.",
            false,
          ),
        ]
      : [];

    return this.writeAndReturn(query, assessment.id, {
      status,
      toolName: AGENTIC_TOOL_NAMES.getLegalRuleMatch,
      toolVersion: GET_LEGAL_RULE_MATCH_TOOL.version,
      configHash: GET_LEGAL_RULE_MATCH_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: artifactVersions(query, rule, acceptedMatch),
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: hasLimitedCoverage
        ? AGENTIC_TOOL_COVERAGE_STATES.partial
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: uniqueSorted([
        ...requestedCitationRefs,
        legalRuleMatchRef(acceptedMatch.id),
      ]),
      limitations,
      result: {
        legalRuleMatchId: legalRuleMatchRef(acceptedMatch.id),
        ruleId: query.input.ruleId,
        applicability,
        requiredFacts,
        knownFacts,
        missingFacts,
        unknownFacts,
        allowedCitationRefs,
      },
    });
  }

  private limitedResponse(
    query: GetLegalRuleMatchQuery,
    rule: RuleProjection | null,
    acceptedMatch: AcceptedMatch | null,
    code: LegalRuleMatchLimitationCode,
    affectedScopeRef: string | null,
    reason: string,
  ): GetLegalRuleMatchResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.needsInput,
      toolName: AGENTIC_TOOL_NAMES.getLegalRuleMatch,
      toolVersion: GET_LEGAL_RULE_MATCH_TOOL.version,
      configHash: GET_LEGAL_RULE_MATCH_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: artifactVersions(query, rule, acceptedMatch),
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [limitation(code, affectedScopeRef, reason, false)],
      result: emptyResult(query, acceptedMatch),
    };
  }

  private blockedResponse(
    query: GetLegalRuleMatchQuery,
    rule: RuleProjection,
    acceptedMatch: AcceptedMatch,
    code: LegalRuleMatchLimitationCode,
    reason: string,
  ): GetLegalRuleMatchResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.blocked,
      toolName: AGENTIC_TOOL_NAMES.getLegalRuleMatch,
      toolVersion: GET_LEGAL_RULE_MATCH_TOOL.version,
      configHash: GET_LEGAL_RULE_MATCH_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: artifactVersions(query, rule, acceptedMatch),
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [limitation(code, query.input.ruleId, reason, false)],
      result: emptyResult(query, acceptedMatch),
    };
  }

  private conflictResponse(
    query: GetLegalRuleMatchQuery,
    rule: RuleProjection,
    acceptedMatch: AcceptedMatch,
    matchItem: MatchItem,
  ): GetLegalRuleMatchResponse {
    return {
      status: AGENTIC_TOOL_STATUSES.conflict,
      toolName: AGENTIC_TOOL_NAMES.getLegalRuleMatch,
      toolVersion: GET_LEGAL_RULE_MATCH_TOOL.version,
      configHash: GET_LEGAL_RULE_MATCH_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: artifactVersions(query, rule, acceptedMatch),
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.limited,
      evidenceRefs: [legalRuleMatchRef(acceptedMatch.id)],
      limitations: [
        limitation(
          LEGAL_RULE_MATCH_LIMITATION_CODES.guardrailBlocked,
          query.input.ruleId,
          acceptedMatch.blockedReason ??
            "The accepted match guardrail blocked this rule match.",
          false,
        ),
      ],
      result: {
        legalRuleMatchId: legalRuleMatchRef(acceptedMatch.id),
        ruleId: query.input.ruleId,
        applicability: LEGAL_RULE_MATCH_APPLICABILITY.unavailable,
        requiredFacts: factRefs(rule.requiredFacts),
        knownFacts: factRefs(matchItem.knownFacts ?? matchItem.known_facts),
        missingFacts: [],
        unknownFacts: factRefs(
          matchItem.unknownFacts ?? matchItem.unknown_facts,
        ),
        allowedCitationRefs: sortedCitationRefs(
          acceptedMatch.citationAllowlist,
        ),
      },
    };
  }

  private async writeAndReturn(
    query: GetLegalRuleMatchQuery,
    assessmentId: string,
    response: GetLegalRuleMatchResponse,
  ): Promise<GetLegalRuleMatchResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.legalRuleMatchRead,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId,
      resourceType: response.artifactVersions.legalRuleMatchId
        ? AUDIT_RESOURCE_TYPES.legalRuleMatch
        : AUDIT_RESOURCE_TYPES.assessment,
      resourceId:
        response.artifactVersions.legalRuleMatchId?.slice(
          LEGAL_RULE_MATCH_REF_PREFIX.length,
        ) ?? assessmentId,
      correlationId: query.correlationId,
      policyId: query.policyId,
      policyVersion: query.policyVersion,
      decision:
        response.status === AGENTIC_TOOL_STATUSES.ready ||
        response.status === AGENTIC_TOOL_STATUSES.outOfCoverage
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        verifiedProfileRef: query.input.verifiedProfileId,
        ruleId: query.input.ruleId,
        legalRuleMatchRef: response.artifactVersions.legalRuleMatchId,
        citationRefHash: safeHash(query.input.citationRefs),
        outputHash: safeHash(response),
        limitationCodes: response.limitations.map(({ code }) => code),
      },
    });
    return response;
  }
}

function artifactVersions(
  query: GetLegalRuleMatchQuery,
  rule: RuleProjection | null,
  acceptedMatch: AcceptedMatch | null,
): GetLegalRuleMatchResponse["artifactVersions"] {
  return {
    verifiedProfileId: query.input.verifiedProfileId,
    ruleId: query.input.ruleId,
    legalRuleMatchId: acceptedMatch
      ? legalRuleMatchRef(acceptedMatch.id)
      : null,
    corpusVersionId: acceptedMatch
      ? `${CORPUS_REF_PREFIX}${acceptedMatch.corpusVersionId}`
      : null,
    legalRuleCatalogVersionId:
      (rule?.legalRuleCatalogVersionId ??
      acceptedMatch?.legalRuleCatalogVersionId)
        ? `${CATALOG_REF_PREFIX}${
            rule?.legalRuleCatalogVersionId ??
            acceptedMatch?.legalRuleCatalogVersionId
          }`
        : null,
  };
}

function emptyResult(
  query: GetLegalRuleMatchQuery,
  acceptedMatch: AcceptedMatch | null,
): GetLegalRuleMatchResponse["result"] {
  return {
    legalRuleMatchId: acceptedMatch
      ? legalRuleMatchRef(acceptedMatch.id)
      : null,
    ruleId: query.input.ruleId,
    applicability: LEGAL_RULE_MATCH_APPLICABILITY.unavailable,
    requiredFacts: [],
    knownFacts: [],
    missingFacts: [],
    unknownFacts: [],
    allowedCitationRefs: acceptedMatch
      ? sortedCitationRefs(acceptedMatch.citationAllowlist)
      : [],
  };
}

function findRuleMatchItem(matches: unknown, ruleId: string): MatchItem | null {
  if (!Array.isArray(matches)) return null;
  const item = matches.find(
    (candidate): candidate is MatchItem =>
      isRecord(candidate) &&
      (candidate.rule_id === ruleId || candidate.ruleId === ruleId),
  );
  return item ?? null;
}

function factRefs(value: unknown): string[] {
  if (typeof value === "string") return cleanFact(value) ? [value] : [];
  if (!Array.isArray(value)) return [];
  return capFacts(
    value.flatMap((item) => {
      if (typeof item === "string" && cleanFact(item)) return [item];
      if (!isRecord(item)) return [];
      const ref = item.id ?? item.fact_id ?? item.factId ?? item.name;
      return typeof ref === "string" && cleanFact(ref) ? [ref] : [];
    }),
  );
}

function sortedCitationRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueSorted(
    value.flatMap((item) => {
      if (typeof item !== "string") return [];
      if (item.startsWith(CITATION_REF_PREFIX) && item.includes("chunk_")) {
        return [item];
      }
      if (item.startsWith("chunk_")) return [`${CITATION_REF_PREFIX}${item}`];
      return [];
    }),
  ).slice(0, GET_LEGAL_RULE_MATCH_TOOL.maxCitationRefs);
}

function legalRuleMatchRef(id: string): string {
  return `${LEGAL_RULE_MATCH_REF_PREFIX}${id}`;
}

function idFromRef(ref: string, prefix: string): string {
  return ref.slice(prefix.length);
}

function provenanceRef(correlationId: string): string {
  return `provenance:legal-rule-match:${correlationId}`;
}

function limitation(
  code: LegalRuleMatchLimitationCode,
  affectedScopeRef: string | null,
  reason: string,
  retryable: boolean,
): GetLegalRuleMatchResponse["limitations"][number] {
  return { code, affectedScopeRef, reason, retryable };
}

function capFacts(values: string[]): string[] {
  return uniqueSorted(values).slice(0, GET_LEGAL_RULE_MATCH_TOOL.maxFacts);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function cleanFact(value: string): boolean {
  return /^[A-Za-z0-9:_./-]{1,128}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
