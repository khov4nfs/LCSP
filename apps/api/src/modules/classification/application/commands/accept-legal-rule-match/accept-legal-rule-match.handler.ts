import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { ASSESSMENT_RUNTIME_STAGE_CODES } from "@lcsp/contracts/evidence";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_SCHEMA_VERSIONS,
  LEGAL_RULE_MATCH_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";
import {
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import {
  toPrismaEvidenceAcceptanceStatus,
  toPrismaLegalRuleLifecycleStatus,
  toPrismaLegalRuleMatchGuardrailStatus,
  toPrismaOverallCoverageStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type {
  LegalRuleEvaluationDiagnosticDto,
  LegalRuleMatchCallbackResponseDto,
  LegalRuleMatchDiagnosticsDto,
} from "../../contracts/classification/legal-rule-match-callback.contract.js";
import { CitationGuardrailService } from "../../services/classification/citation-guardrail.service.js";
import { AcceptLegalRuleMatchCommand } from "./accept-legal-rule-match.command.js";

const LEGAL_WORKER_ACTOR_ID = AUDIT_ACTOR_IDS.legalRuleMatchWorker;
const MAX_DIAGNOSTIC_EVALUATIONS = 50;
const MAX_RUNTIME_DIAGNOSTIC_EVALUATIONS = 12;
const MAX_DIAGNOSTIC_STRINGS = 100;

@CommandHandler(AcceptLegalRuleMatchCommand)
export class AcceptLegalRuleMatchHandler implements ICommandHandler<AcceptLegalRuleMatchCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
    private readonly citationGuardrail: CitationGuardrailService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  async execute(
    command: AcceptLegalRuleMatchCommand,
  ): Promise<LegalRuleMatchCallbackResponseDto> {
    this.validate(command);

    const payload = command.payload;

    const [corpus, catalog] = await Promise.all([
      this.prisma.legalCorpusVersion.findFirst({
        where: {
          id: payload.corpus_version_id,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        select: { id: true },
      }),
      this.prisma.legalRuleCatalogVersion.findFirst({
        where: {
          id: payload.legal_rule_catalog_version_id,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        select: { id: true },
      }),
    ]);
    if (!corpus) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.corpusVersionNotApproved),
      );
    }
    if (!catalog) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.ruleCatalogVersionNotApproved),
      );
    }

    const verifiedProfile = await this.prisma.verifiedProfile.findFirst({
      where: {
        id: payload.verified_profile_id,
        assessmentId: payload.assessment_id,
        status: toPrismaVerifiedProfileStatus(
          VERIFIED_PROFILE_STATUSES.approved,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
      },
    });

    if (!verifiedProfile) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.verifiedProfileNotFound),
      );
    }

    this.citationGuardrail.validate(
      payload.matches,
      payload.citation_allowlist,
      command.correlationId,
    );

    const diagnostics = normalizeDiagnostics(payload.diagnostics);
    const isMatchesEmpty = payload.matches.length === 0;
    const guardrailStatus = isMatchesEmpty
      ? LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked
      : LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed;
    const blockedReason = isMatchesEmpty
      ? (diagnostics.no_match_reason ?? "NO_CITATION_BASIS")
      : null;
    const overallCoverageStatus = isMatchesEmpty
      ? OVERALL_COVERAGE_STATUSES.noCitation
      : payload.overall_coverage_status;

    const legalRuleMatchId = crypto.randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.legalRuleMatch.create({
        data: {
          id: legalRuleMatchId,
          verifiedProfileId: payload.verified_profile_id,
          assessmentId: payload.assessment_id,
          organizationId: verifiedProfile.organizationId,
          corpusVersionId: payload.corpus_version_id,
          legalRuleCatalogVersionId: payload.legal_rule_catalog_version_id,
          schemaVersion: payload.schema_version,
          matches: payload.matches as unknown as Prisma.InputJsonValue,
          citationAllowlist: payload.citation_allowlist,
          overallCoverageStatus: toPrismaOverallCoverageStatus(
            overallCoverageStatus,
          ),
          guardrailStatus:
            toPrismaLegalRuleMatchGuardrailStatus(guardrailStatus),
          blockedReason,
          status: toPrismaEvidenceAcceptanceStatus(
            LEGAL_RULE_MATCH_STATUSES.accepted,
          ),
        },
      });

      await this.enqueueReadyEvent(
        command,
        tx,
        verifiedProfile,
        legalRuleMatchId,
        guardrailStatus,
      );

      await this.writeAuditLog(
        command,
        tx,
        verifiedProfile,
        legalRuleMatchId,
        guardrailStatus,
        blockedReason,
        diagnostics,
      );
    });

    const runtimeEvaluations = toRuntimeEvaluations(diagnostics.evaluations);
    await this.runtimeEvents.recordToolCompleted({
      organizationId: verifiedProfile.organizationId,
      assessmentId: verifiedProfile.assessmentId,
      runId: classificationRunId(
        verifiedProfile.assessmentId,
        verifiedProfile.id,
      ),
      correlationId: command.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.legalRetrieval,
      toolName: "legal_rule_match",
      summary: isMatchesEmpty
        ? "Legal retrieval completed without applicable matches"
        : "Legal retrieval completed with applicable matches",
      outputSummary: {
        legalRuleMatchId,
        matchCount: payload.matches.length,
        guardrailStatus,
        coverageStatus: overallCoverageStatus,
        diagnostics,
        ruleEvaluations: runtimeEvaluations,
        evaluationsTruncated:
          diagnostics.evaluations_truncated === true ||
          (diagnostics.evaluations?.length ?? 0) >
            MAX_RUNTIME_DIAGNOSTIC_EVALUATIONS,
      },
      completedAt: new Date(),
    });

    return {
      accepted: true,
      legal_rule_match_id: legalRuleMatchId,
      guardrail_status: guardrailStatus,
      correlationId: command.correlationId,
    };
  }

  private validate(command: AcceptLegalRuleMatchCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.verified_profile_id) ||
      !clean(payload.assessment_id) ||
      !clean(payload.corpus_version_id) ||
      !clean(payload.legal_rule_catalog_version_id) ||
      !LEGAL_RULE_MATCH_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof LEGAL_RULE_MATCH_SCHEMA_VERSIONS)[number],
      ) ||
      !Array.isArray(payload.matches) ||
      !Array.isArray(payload.citation_allowlist) ||
      !clean(payload.overall_coverage_status)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.legalRuleMatchSchemaInvalid),
      );
    }
  }

  private async enqueueReadyEvent(
    command: AcceptLegalRuleMatchCommand,
    tx: Prisma.TransactionClient,
    verifiedProfile: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    legalRuleMatchId: string,
    guardrailStatus: string,
  ): Promise<void> {
    const isPassed =
      guardrailStatus === LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed;
    const auditResult = isPassed
      ? SCAN_EVENT_TYPES.legalRuleMatchAcceptedAudit
      : SCAN_EVENT_TYPES.legalRuleMatchBlockedAudit;

    const outboxEvent = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.legalRuleMatch,
      aggregateId: legalRuleMatchId,
      eventType: SCAN_EVENT_TYPES.legalRuleMatchReady,
      organizationId: verifiedProfile.organizationId,
      assessmentId: verifiedProfile.assessmentId,
      correlationId: command.correlationId,
      causationId: verifiedProfile.id,
      actor: { id: LEGAL_WORKER_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
      result: auditResult,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${legalRuleMatchId}:${SCAN_EVENT_TYPES.legalRuleMatchReady}`,
      payload: {
        legalRuleMatchId,
        assessmentId: verifiedProfile.assessmentId,
        guardrailStatus,
        correlationId: command.correlationId,
      },
    });
    await this.outboxRepository.enqueue(outboxEvent, tx);
  }

  private async writeAuditLog(
    command: AcceptLegalRuleMatchCommand,
    tx: Prisma.TransactionClient,
    verifiedProfile: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    legalRuleMatchId: string,
    guardrailStatus: string,
    blockedReason: string | null,
    diagnostics: LegalRuleMatchDiagnosticsDto,
  ): Promise<void> {
    const isPassed =
      guardrailStatus === LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed;

    if (isPassed) {
      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.legalRuleMatchAcceptedAudit,
          actorId: LEGAL_WORKER_ACTOR_ID,
          organizationId: verifiedProfile.organizationId,
          assessmentId: verifiedProfile.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleMatch,
          resourceId: legalRuleMatchId,
          correlationId: command.correlationId,
          causationId: verifiedProfile.id,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.legalRuleMatchAcceptedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: LEGAL_WORKER_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
          payload: {
            legalRuleMatchId,
            assessmentId: verifiedProfile.assessmentId,
            corpusVersionId: command.payload.corpus_version_id,
            correlationId: command.correlationId,
          },
        },
        tx,
      );
    } else {
      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.legalRuleMatchBlockedAudit,
          actorId: LEGAL_WORKER_ACTOR_ID,
          organizationId: verifiedProfile.organizationId,
          assessmentId: verifiedProfile.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleMatch,
          resourceId: legalRuleMatchId,
          correlationId: command.correlationId,
          causationId: verifiedProfile.id,
          decision: AUDIT_DECISIONS.deny,
          result: SCAN_EVENT_TYPES.legalRuleMatchBlockedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: { id: LEGAL_WORKER_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
          payload: {
            assessmentId: verifiedProfile.assessmentId,
            guardrailStatus,
            blockedReason,
            ruleCount: diagnostics.rule_count,
            candidateRuleCount: diagnostics.candidate_rule_count,
            matchCount: diagnostics.match_count,
            correlationId: command.correlationId,
          },
        },
        tx,
      );
    }
  }

  private errorBody(command: AcceptLegalRuleMatchCommand, errorCode: string) {
    return problemResult(String(errorCode), command.correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

function normalizeDiagnostics(value: unknown): LegalRuleMatchDiagnosticsDto {
  const input = isRecord(value) ? value : {};
  const evaluations = Array.isArray(input.evaluations)
    ? input.evaluations
        .slice(0, MAX_DIAGNOSTIC_EVALUATIONS)
        .map(normalizeEvaluation)
        .filter(
          (item): item is LegalRuleEvaluationDiagnosticDto => item !== null,
        )
    : [];

  return {
    no_match_reason: clean(input.no_match_reason),
    rule_count: nonNegativeInteger(input.rule_count),
    candidate_rule_count: nonNegativeInteger(input.candidate_rule_count),
    chunk_count: nonNegativeInteger(input.chunk_count),
    deterministic_match_count: nonNegativeInteger(
      input.deterministic_match_count,
    ),
    matched_without_citation_count: nonNegativeInteger(
      input.matched_without_citation_count,
    ),
    match_count: nonNegativeInteger(input.match_count),
    profile_fact_fields: cleanStringList(input.profile_fact_fields),
    profile_evidence_fields: cleanStringList(input.profile_evidence_fields),
    evaluations,
    evaluations_truncated: input.evaluations_truncated === true,
  };
}

function normalizeEvaluation(
  value: unknown,
): LegalRuleEvaluationDiagnosticDto | null {
  if (!isRecord(value)) return null;
  const ruleId = clean(value.rule_id);
  const status = clean(value.status);
  if (!ruleId || !status) return null;
  return {
    rule_id: ruleId,
    status,
    rationale: cleanStringList(value.rationale),
    matched_required_facts: cleanStringList(value.matched_required_facts),
    blocking_facts: cleanStringList(value.blocking_facts),
  };
}

function toRuntimeEvaluations(
  evaluations: LegalRuleEvaluationDiagnosticDto[] | undefined,
) {
  return (evaluations ?? [])
    .slice(0, MAX_RUNTIME_DIAGNOSTIC_EVALUATIONS)
    .map((evaluation) => ({
      ruleId: evaluation.rule_id,
      status: evaluation.status,
      rationale: evaluation.rationale.join(" | "),
      matchedRequiredFacts: evaluation.matched_required_facts.join(" | "),
      blockingFacts: evaluation.blocking_facts.join(" | "),
    }));
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, MAX_DIAGNOSTIC_STRINGS)
        .map(clean)
        .filter((item): item is string => item !== null),
    ),
  ];
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classificationRunId(
  assessmentId: string,
  verifiedProfileId: string,
): string {
  return `classification:${assessmentId}:${verifiedProfileId}`;
}
