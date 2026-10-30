import { randomUUID } from "node:crypto";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  RULE_AUDIT_EXPORT_KINDS,
  RULE_AUDIT_EXPORT_SCHEMA_VERSION,
  RULE_AUDIT_PROGRESS_STATES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
  ruleAuditCatalogSchema,
  ruleAuditExportMetadataSchema,
  ruleAuditExportSchema,
  ruleAuditRequestViewSchema,
  type SubmitRuleAudit,
  type RuleAuditExport,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssessmentAuditMode,
  AssessmentRuleAuditStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { ASSESSMENT_ROOT_COMMAND_TYPES } from "@lcsp/contracts/assessment-domain";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";
import { AssessmentCaseSupport } from "../../infrastructure/persistence/assessment-case-support.service.js";
import { validateRuleDecision } from "../../domain/decision-validator.js";

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

type Tx = Prisma.TransactionClient;

/**
 * Business purpose: Map persisted scope membership and accepted decisions to truthful customer progress.
 * Business rules:
 * - Absence from every request is NOT_SELECTED, never a legal applicability result.
 * Execution flow:
 * 1. Inspect membership, current coverage, human wait and runtime outcome.
 * 2. Return RESULT_READY only for a currently accepted resolved decision.
 * Failure cases:
 * - Invalidated coverage or decision is STALE, and failed work never fabricates a verdict.
 * Side effects:
 * - None; this is a pure projection of authoritative rows.
 */
function progressOf(input: {
  selected: boolean;
  resolutionState?: string;
  decisionId?: string | null;
  decisionState?: string | null;
  hasOpenRequest?: boolean;
  requestStatus?: string;
}) {
  if (!input.selected) return RULE_AUDIT_PROGRESS_STATES.NOT_SELECTED;
  if (
    input.resolutionState === DECISION_RESOLUTION_STATES.INVALIDATED ||
    (input.decisionId &&
      input.decisionState !== ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED)
  )
    return RULE_AUDIT_PROGRESS_STATES.STALE;
  if (
    input.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED &&
    input.decisionId &&
    input.decisionState === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED
  )
    return RULE_AUDIT_PROGRESS_STATES.RESULT_READY;
  if (
    input.hasOpenRequest ||
    input.resolutionState === DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT
  )
    return RULE_AUDIT_PROGRESS_STATES.WAITING_FOR_CUSTOMER;
  if (input.requestStatus === RULE_AUDIT_STATUSES.FAILED)
    return RULE_AUDIT_PROGRESS_STATES.FAILED;
  if (input.requestStatus === RULE_AUDIT_STATUSES.INTERRUPTED)
    return RULE_AUDIT_PROGRESS_STATES.INTERRUPTED;
  if (input.resolutionState === DECISION_RESOLUTION_STATES.INVESTIGATING)
    return RULE_AUDIT_PROGRESS_STATES.INVESTIGATING;
  return RULE_AUDIT_PROGRESS_STATES.QUEUED;
}

@Injectable()
export class AssessmentRuleAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Give an owner a complete, paged choice of pinned legal rules and current progress.
   * Business rules:
   * - The catalog uses the assessment's immutable pins, never the newly active Rule Set.
   * Execution flow:
   * 1. Verify owner and ready pins.
   * 2. Read the ordered page, linked legal titles and persisted request/decision state.
   * Failure cases:
   * - Missing owner or pins fails closed with NOT_FOUND or PINS_NOT_READY.
   * Side effects:
   * - None; all data is read from canonical assessment tables.
   */
  async catalog(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    offset: number,
    limit: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { assessment, domainCase, ruleSet } = await this.readyCase(
        tx,
        assessmentId,
        ownerId,
        correlationId,
      );
      void assessment;
      const [total, rules, allItems, coverage, openRequests, latestRequest] =
        await Promise.all([
          tx.assessmentRule.count({ where: { ruleSetVersionId: ruleSet.id } }),
          tx.assessmentRule.findMany({
            where: { ruleSetVersionId: ruleSet.id },
            orderBy: [{ ordinal: "asc" }, { assessmentRuleId: "asc" }],
            skip: offset,
            take: limit,
            include: {
              legalRequirementLinks: { include: { legalRequirement: true } },
            },
          }),
          tx.assessmentRuleAuditItem.findMany({
            where: { request: { assessmentId } },
            select: { assessmentRuleId: true },
          }),
          tx.assessmentDecisionCoverage.findMany({
            where: { assessmentId },
            include: { currentDecision: { select: { state: true } } },
          }),
          tx.assessmentHumanRequest.findMany({
            where: { assessmentId, status: "OPEN" },
            select: { assessmentRuleId: true },
          }),
          tx.assessmentRuleAuditRequest.findFirst({
            where: { assessmentId },
            orderBy: { requestRevision: "desc" },
            select: {
              requestId: true,
              status: true,
              rules: { select: { assessmentRuleId: true } },
            },
          }),
        ]);
      const selected = new Set(allItems.map((item) => item.assessmentRuleId));
      const latestIds = new Set(
        latestRequest?.rules.map((item) => item.assessmentRuleId) ?? [],
      );
      const covered = new Map(
        coverage.map((row) => [row.assessmentRuleId, row]),
      );
      const waiting = new Set(openRequests.map((row) => row.assessmentRuleId));
      return ruleAuditCatalogSchema.parse({
        assessmentId,
        auditMode: domainCase.auditMode,
        auditRevision: domainCase.auditRequestRevision,
        ruleSetVersionId: ruleSet.id,
        ruleSetDigest: ruleSet.ruleSetDigest,
        repositorySnapshotId: domainCase.repositorySnapshotId,
        repositoryCommit: domainCase.repositoryCommit,
        latestRequestId: latestRequest?.requestId ?? null,
        latestRequestStatus: latestRequest?.status ?? null,
        total,
        offset,
        nextOffset:
          offset + rules.length < total ? offset + rules.length : null,
        rules: rules.map((rule) => {
          const row = covered.get(rule.assessmentRuleId);
          return {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
            concept: rule.concept,
            summary: rule.legalIntent,
            legalRequirements: rule.legalRequirementLinks.map((link) => ({
              legalRequirementId: link.legalRequirement.legalRequirementId,
              title: link.legalRequirement.title,
            })),
            progress: progressOf({
              selected: selected.has(rule.assessmentRuleId),
              resolutionState: row?.resolutionState,
              decisionId: row?.currentDecisionId,
              decisionState: row?.currentDecision?.state,
              hasOpenRequest: waiting.has(rule.assessmentRuleId),
              requestStatus: latestIds.has(rule.assessmentRuleId)
                ? latestRequest?.status
                : undefined,
            }),
            decisionId:
              row?.currentDecision?.state ===
              ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED
                ? row.currentDecisionId
                : null,
          };
        }),
      });
    });
  }

  /**
   * Business purpose: Freeze a customer's exact audit choice and authorize one Root dispatch.
   * Business rules:
   * - Only the owner of a ready customer-selected assessment can start a nonempty,
   * current, wholly pinned scope; one active request and one Root lease exist at a time.
   * Execution flow:
   * 1. Lock assessment and replay a matching idempotency key before comparing revisions.
   * 2. Validate the complete server catalog and reject duplicate, foreign or stale IDs.
   * 3. Store immutable request/items, advance revision and enqueue its Root command atomically.
   * Failure cases:
   * - Conflicting replay, stale pins/revision, invalid lifecycle or scope aborts the transaction.
   * Side effects:
   * - Writes request, new coverage, runtime target and transactional outbox once.
   */
  async submit(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    body: SubmitRuleAudit,
  ) {
    const digest = sha256Hex(canonicalJson(body));
    const requestId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${assessmentId} FOR UPDATE`,
      );
      const { assessment, domainCase, ruleSet } = await this.readyCase(
        tx,
        assessmentId,
        ownerId,
        correlationId,
      );
      if (
        domainCase.auditMode !== AssessmentAuditMode.CUSTOMER_SELECTED ||
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const replay = await tx.assessmentRuleAuditRequest.findUnique({
        where: {
          assessmentId_idempotencyKey: {
            assessmentId,
            idempotencyKey: body.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (replay.requestDigest !== digest)
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            correlationId,
            { status: HttpStatus.CONFLICT },
          );
        return replay.requestId;
      }
      if (
        domainCase.auditRequestRevision !== body.expectedAuditRevision ||
        ruleSet.id !== body.ruleSetVersionId ||
        ruleSet.ruleSetDigest !== body.ruleSetDigest ||
        domainCase.repositorySnapshotId !== body.repositorySnapshotId ||
        domainCase.repositoryCommit?.toLowerCase() !==
          body.repositoryCommit.toLowerCase()
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.DECISION_REVISION_STALE,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const previous = await tx.assessmentRuleAuditRequest.findFirst({
        where: { assessmentId },
        orderBy: { requestRevision: "desc" },
        select: { status: true },
      });
      if (previous && previous.status !== AssessmentRuleAuditStatus.COMPLETED)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const catalog = await tx.assessmentRule.findMany({
        where: { ruleSetVersionId: ruleSet.id },
        orderBy: [{ ordinal: "asc" }, { assessmentRuleId: "asc" }],
        select: { assessmentRuleId: true, assessmentRuleVersion: true },
      });
      const byId = new Map(
        catalog.map((rule) => [rule.assessmentRuleId, rule]),
      );
      const chosen =
        body.scopeMode === RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET
          ? catalog
          : body.rules;
      const ids = new Set(chosen.map((rule) => rule.assessmentRuleId));
      if (
        catalog.length === 0 ||
        chosen.length === 0 ||
        ids.size !== chosen.length ||
        (body.scopeMode === RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET &&
          body.rules.length !== 0) ||
        chosen.some(
          (rule) =>
            byId.get(rule.assessmentRuleId)?.assessmentRuleVersion !==
            rule.assessmentRuleVersion,
        )
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      const runtime = await tx.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId },
      });
      if (
        runtime.leaseToken ||
        runtime.executionState === AGENT_EXECUTION_STATES.RUNNING
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const nextRevision = domainCase.auditRequestRevision + 1;
      const id = randomUUID();
      const currentCoverage = await tx.assessmentDecisionCoverage.findMany({
        where: {
          assessmentId,
          assessmentRuleId: { in: chosen.map((rule) => rule.assessmentRuleId) },
        },
        include: { currentDecision: true },
      });
      const reusable = new Map(
        currentCoverage.flatMap((row) => {
          const decision = row.currentDecision;
          return row.resolutionState === DECISION_RESOLUTION_STATES.RESOLVED &&
            row.assessmentRuleVersion ===
              byId.get(row.assessmentRuleId)?.assessmentRuleVersion &&
            decision?.state === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED &&
            decision.caseRevision === domainCase.caseRevision &&
            decision.repositoryCommit === domainCase.repositoryCommit &&
            decision.ruleSetVersionId === ruleSet.id
            ? [[row.assessmentRuleId, decision.decisionId] as const]
            : [];
        }),
      );
      await tx.assessmentRuleAuditRequest.create({
        data: {
          requestId: id,
          assessmentId,
          requestRevision: nextRevision,
          idempotencyKey: body.idempotencyKey,
          requestDigest: digest,
          scopeMode: body.scopeMode,
          ruleSetVersionId: ruleSet.id,
          ruleSetDigest: ruleSet.ruleSetDigest,
          repositorySnapshotId: domainCase.repositorySnapshotId,
          repositoryCommit: domainCase.repositoryCommit,
          rules: {
            create: chosen.map((rule, ordinal) => ({
              ...rule,
              ordinal,
              reusedDecisionId: reusable.get(rule.assessmentRuleId) ?? null,
            })),
          },
        },
      });
      await tx.assessmentDecisionCoverage.createMany({
        data: chosen.map((rule) => ({
          assessmentId,
          ruleSetVersionId: ruleSet.id,
          ...rule,
        })),
        skipDuplicates: true,
      });
      await tx.assessmentCase.update({
        where: { assessmentId },
        data: { auditRequestRevision: nextRevision },
      });
      await tx.assessmentRuntime.update({
        where: { assessmentId },
        data: {
          currentAuditRequestId: id,
          currentExecutionId: null,
          checkpointId: null,
          executionState: AGENT_EXECUTION_STATES.QUEUED,
        },
      });
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: assessmentId,
          assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          correlationId,
          causationId: correlationId,
          actor: ORCHESTRATOR,
          result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `rule-audit:${id}:start`,
          payload: { assessmentId, auditRequestId: id },
        }),
        tx,
      );
      return id;
    });
    return this.request(assessmentId, ownerId, correlationId, requestId);
  }

  /**
   * Business purpose: Resume one failed frozen audit without selecting more rules or losing its checkpoint.
   * Business rules:
   * - Only the owner can retry the current failed request; replaying its retry key is read-only.
   * Execution flow:
   * 1. Lock and verify the assessment, request, current revision, pins and released lease.
   * 2. Move the request back to QUEUED and enqueue one Root command with a stable retry key.
   * Failure cases:
   * - A different scope, active worker, stale pins or nonfailed request rejects transactionally.
   * Side effects:
   * - Updates the request retry journal and writes one transactional outbox command.
   */
  async retry(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    requestId: string,
    idempotencyKey: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${assessmentId} FOR UPDATE`,
      );
      const { assessment, domainCase, ruleSet } = await this.readyCase(
        tx,
        assessmentId,
        ownerId,
        correlationId,
      );
      const request = await tx.assessmentRuleAuditRequest.findUnique({
        where: { requestId },
      });
      if (!request || request.assessmentId !== assessmentId)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      if (request.lastRetryKey === idempotencyKey) return;
      const runtime = await tx.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId },
      });
      if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        request.status !== RULE_AUDIT_STATUSES.FAILED ||
        runtime.executionState !== AGENT_EXECUTION_STATES.FAILED ||
        runtime.leaseToken ||
        runtime.currentAuditRequestId !== requestId ||
        request.requestRevision !== domainCase.auditRequestRevision ||
        request.ruleSetVersionId !== ruleSet.id ||
        request.ruleSetDigest !== ruleSet.ruleSetDigest ||
        request.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        request.repositoryCommit !== domainCase.repositoryCommit
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      await tx.assessmentRuleAuditRequest.update({
        where: { requestId },
        data: {
          status: RULE_AUDIT_STATUSES.QUEUED,
          lastRetryKey: idempotencyKey,
          retryAttempt: { increment: 1 },
        },
      });
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: assessmentId,
          assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          correlationId,
          causationId: correlationId,
          actor: ORCHESTRATOR,
          result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `rule-audit:${requestId}:retry:${idempotencyKey}`,
          payload: { assessmentId, auditRequestId: requestId },
        }),
        tx,
      );
    });
    return this.request(assessmentId, ownerId, correlationId, requestId);
  }

  /**
   * Business purpose: Return durable selected-scope progress, including results already accepted while siblings work.
   * Business rules:
   * - Read is owner-scoped and counts only members of this immutable request.
   * Execution flow:
   * 1. Load request, its items, current coverage and human requests.
   * 2. Project each item's current state and count ready decisions.
   * Failure cases:
   * - Missing or foreign request returns NOT_FOUND without revealing membership.
   * Side effects:
   * - None; read-only authoritative projection.
   */
  async request(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    requestId: string,
  ) {
    const row = await this.prisma.assessmentRuleAuditRequest.findUnique({
      where: { requestId },
      include: {
        assessmentCase: { include: { assessment: true } },
        rules: { orderBy: { ordinal: "asc" } },
      },
    });
    if (
      !row ||
      row.assessmentId !== assessmentId ||
      row.assessmentCase.assessment.ownerId !== ownerId
    )
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const [
      totalPinned,
      coverage,
      openRequests,
      everRequested,
      requestDecisions,
    ] = await Promise.all([
      this.prisma.assessmentRule.count({
        where: { ruleSetVersionId: row.ruleSetVersionId },
      }),
      this.prisma.assessmentDecisionCoverage.findMany({
        where: {
          assessmentId,
          assessmentRuleId: {
            in: row.rules.map((rule) => rule.assessmentRuleId),
          },
        },
        include: { currentDecision: { select: { state: true } } },
      }),
      this.prisma.assessmentHumanRequest.findMany({
        where: { assessmentId, status: "OPEN" },
        select: { assessmentRuleId: true },
      }),
      this.prisma.assessmentRuleAuditItem.findMany({
        where: { request: { assessmentId } },
        select: { assessmentRuleId: true },
      }),
      this.prisma.assessmentRuleDecision.findMany({
        where: { auditRequestId: requestId },
        orderBy: { decisionRevision: "desc" },
        select: { assessmentRuleId: true, decisionId: true, state: true },
      }),
    ]);
    const byId = new Map(coverage.map((item) => [item.assessmentRuleId, item]));
    const decided = new Map<string, (typeof requestDecisions)[number]>();
    for (const decision of requestDecisions)
      if (!decided.has(decision.assessmentRuleId))
        decided.set(decision.assessmentRuleId, decision);
    const waiting = new Set(openRequests.map((item) => item.assessmentRuleId));
    const rules = row.rules.map((item) => {
      const current = byId.get(item.assessmentRuleId);
      const own = decided.get(item.assessmentRuleId);
      const decisionId = own?.decisionId ?? item.reusedDecisionId;
      const isCurrent = Boolean(
        decisionId && current?.currentDecisionId === decisionId,
      );
      const progress = progressOf({
        selected: true,
        resolutionState:
          decisionId && !isCurrent
            ? DECISION_RESOLUTION_STATES.INVALIDATED
            : current?.resolutionState,
        decisionId: isCurrent ? decisionId : null,
        decisionState: isCurrent ? current?.currentDecision?.state : null,
        hasOpenRequest: waiting.has(item.assessmentRuleId),
        requestStatus: row.status,
      });
      return {
        assessmentRuleId: item.assessmentRuleId,
        assessmentRuleVersion: item.assessmentRuleVersion,
        ordinal: item.ordinal,
        progress,
        decisionId:
          progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY
            ? decisionId
            : null,
      };
    });
    return ruleAuditRequestViewSchema.parse({
      requestId: row.requestId,
      assessmentId,
      requestRevision: row.requestRevision,
      scopeMode: row.scopeMode,
      status: row.status,
      ruleSetVersionId: row.ruleSetVersionId,
      ruleSetDigest: row.ruleSetDigest,
      repositorySnapshotId: row.repositorySnapshotId,
      repositoryCommit: row.repositoryCommit,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      totalPinned,
      requested: rules.length,
      ready: rules.filter(
        (rule) => rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
      ).length,
      notRequested: Math.max(
        0,
        totalPinned -
          new Set(everRequested.map((item) => item.assessmentRuleId)).size,
      ),
      rules,
    });
  }

  /**
   * Business purpose: Freeze only currently accepted selected-rule results in a labelled partial export.
   * Business rules:
   * - Export is owner-scoped, idempotent and includes no pending, invalidated or unrequested verdict.
   * Execution flow:
   * 1. Verify request ownership and return an existing export for the same key.
   * 2. Revalidate each available decision against current pins, facts and evidence.
   * 3. Persist one immutable JSON snapshot with exact decision revisions and legal basis.
   * Failure cases:
   * - No valid result or invalid pins rejects without creating an empty report.
   * Side effects:
   * - Creates one immutable database export; never creates FINAL_REPORT or changes lifecycle.
   */
  async createExport(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    requestId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { domainCase, ruleSet } = await this.readyCase(
        tx,
        assessmentId,
        ownerId,
        correlationId,
      );
      const request = await tx.assessmentRuleAuditRequest.findUnique({
        where: { requestId },
        include: { rules: { orderBy: { ordinal: "asc" } } },
      });
      if (!request || request.assessmentId !== assessmentId)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      const existing = await tx.assessmentRuleAuditExport.findUnique({
        where: { requestId_idempotencyKey: { requestId, idempotencyKey } },
      });
      if (existing)
        return ruleAuditExportMetadataSchema.parse({
          exportId: existing.exportId,
          requestId,
          contentSha256: existing.contentSha256,
          createdAt: existing.createdAt.toISOString(),
        });
      if (
        request.ruleSetVersionId !== ruleSet.id ||
        request.repositorySnapshotId !== domainCase.repositorySnapshotId ||
        request.repositoryCommit !== domainCase.repositoryCommit
      )
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const pins = await this.support.loadPins(tx, assessmentId, correlationId);
      const legalRules = await tx.assessmentRule.findMany({
        where: {
          ruleSetVersionId: ruleSet.id,
          assessmentRuleId: {
            in: request.rules.map((rule) => rule.assessmentRuleId),
          },
        },
        include: {
          legalRequirementLinks: {
            include: {
              legalRequirement: { include: { provenance: true } },
            },
          },
        },
      });
      const legalById = new Map(
        legalRules.map((rule) => [rule.assessmentRuleId, rule]),
      );
      const results: RuleAuditExport["results"] = [];
      for (const item of request.rules) {
        const coverage = await tx.assessmentDecisionCoverage.findUnique({
          where: {
            assessmentId_assessmentRuleId: {
              assessmentId,
              assessmentRuleId: item.assessmentRuleId,
            },
          },
          include: { currentDecision: true },
        });
        const record = coverage?.currentDecision;
        if (
          record?.auditRequestId !== requestId &&
          record?.decisionId !== item.reusedDecisionId
        )
          continue;
        if (
          coverage?.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED ||
          record?.state !== ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED ||
          record.caseRevision !== pins.caseRevision ||
          record.repositoryCommit !== pins.repositoryCommit ||
          record.assessmentRuleVersion !== item.assessmentRuleVersion
        )
          continue;
        const parsed = ruleDecisionSchema.safeParse(record.decision);
        if (
          !parsed.success ||
          parsed.data.assessmentRuleId !== item.assessmentRuleId
        )
          continue;
        const context = await this.support.buildValidationContext(tx, {
          assessmentId,
          pins,
          decision: parsed.data,
        });
        if (validateRuleDecision(parsed.data, context).length > 0) continue;
        const legal = legalById.get(item.assessmentRuleId);
        if (!legal) continue;
        results.push({
          assessmentRuleId: item.assessmentRuleId,
          assessmentRuleVersion: item.assessmentRuleVersion,
          decisionId: record.decisionId,
          decisionRevision: record.decisionRevision,
          decision: parsed.data,
          legalBasis: {
            concept: legal.concept,
            legalIntent: legal.legalIntent,
            legalRequirements: legal.legalRequirementLinks.map((link) => ({
              legalRequirementId: link.legalRequirement.legalRequirementId,
              title: link.legalRequirement.title,
              sources: link.legalRequirement.provenance.map((source) => ({
                documentId: source.documentId,
                locator: source.locator,
              })),
            })),
          },
        });
      }
      if (results.length === 0)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.COMPLETION_GATE_BLOCKED,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      const [totalPinned, everRequested] = await Promise.all([
        tx.assessmentRule.count({ where: { ruleSetVersionId: ruleSet.id } }),
        tx.assessmentRuleAuditItem.findMany({
          where: { request: { assessmentId } },
          select: { assessmentRuleId: true },
        }),
      ]);
      const exportId = randomUUID();
      const now = new Date();
      const content = ruleAuditExportSchema.parse({
        schemaVersion: RULE_AUDIT_EXPORT_SCHEMA_VERSION,
        kind: RULE_AUDIT_EXPORT_KINDS.PARTIAL_SELECTED_RULE_AUDIT,
        exportId,
        requestId,
        assessmentId,
        requestRevision: request.requestRevision,
        ruleSetVersionId: request.ruleSetVersionId,
        ruleSetDigest: request.ruleSetDigest,
        repositorySnapshotId: request.repositorySnapshotId,
        repositoryCommit: request.repositoryCommit,
        requestedRuleIds: request.rules.map((rule) => rule.assessmentRuleId),
        includedRuleIds: results.map((item) => item.assessmentRuleId),
        notRequestedRuleCount: Math.max(
          0,
          totalPinned -
            new Set(everRequested.map((item) => item.assessmentRuleId)).size,
        ),
        exportedAt: now.toISOString(),
        results,
      });
      const contentSha256 = sha256Hex(canonicalJson(content));
      await tx.assessmentRuleAuditExport.create({
        data: {
          exportId,
          requestId,
          assessmentId,
          idempotencyKey,
          contentSha256,
          content: content,
          createdAt: now,
        },
      });
      return ruleAuditExportMetadataSchema.parse({
        exportId,
        requestId,
        contentSha256,
        createdAt: now.toISOString(),
      });
    });
  }

  /**
   * Business purpose: Download the exact immutable partial export created by the owner.
   * Business rules:
   * - Export identity, request ownership, schema and content checksum must match.
   * Execution flow:
   * 1. Load the owner-bound export and validate its stored payload.
   * 2. Recalculate checksum and return its canonical JSON bytes.
   * Failure cases:
   * - Foreign, missing or tampered exports fail closed.
   * Side effects:
   * - None; read-only download.
   */
  async downloadExport(
    assessmentId: string,
    ownerId: string,
    correlationId: string,
    requestId: string,
    exportId: string,
  ) {
    const row = await this.prisma.assessmentRuleAuditExport.findUnique({
      where: { exportId },
      include: {
        request: {
          include: { assessmentCase: { include: { assessment: true } } },
        },
      },
    });
    if (
      !row ||
      row.assessmentId !== assessmentId ||
      row.requestId !== requestId ||
      row.request.assessmentCase.assessment.ownerId !== ownerId
    )
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const parsed = ruleAuditExportSchema.safeParse(row.content);
    if (
      !parsed.success ||
      parsed.data.exportId !== exportId ||
      sha256Hex(canonicalJson(parsed.data)) !== row.contentSha256
    )
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    return {
      content: Buffer.from(canonicalJson(parsed.data)),
      contentSha256: row.contentSha256,
    };
  }

  /**
   * Business purpose: Resolve authoritative owner and immutable pins before catalog or request work.
   * Business rules:
   * - Only a customer owner with a pinned Rule Set and ready snapshot may see choices.
   * Execution flow:
   * 1. Read owner and case.
   * 2. Verify rule-set and snapshot identities before returning them.
   * Failure cases:
   * - Foreign/missing assessment is NOT_FOUND; incomplete pins are PINS_NOT_READY.
   * Side effects:
   * - None; read-only transaction helper.
   */
  private async readyCase(
    tx: Tx,
    assessmentId: string,
    ownerId: string,
    correlationId: string,
  ) {
    const assessment = await tx.assessment.findUnique({
      where: { id: assessmentId },
      include: { domainCase: true },
    });
    if (!assessment || assessment.ownerId !== ownerId)
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const domainCase = assessment.domainCase;
    if (
      !domainCase?.ruleSetVersionId ||
      !domainCase.repositorySnapshotId ||
      !domainCase.repositoryCommit
    )
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    const ruleSet = await tx.complianceRuleSetVersion.findUnique({
      where: { id: domainCase.ruleSetVersionId },
    });
    if (!ruleSet)
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    return { assessment, domainCase, ruleSet };
  }
}
