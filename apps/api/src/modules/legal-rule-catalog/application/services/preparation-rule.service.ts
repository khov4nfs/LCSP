import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import {
  Prisma,
  AgentExecutionState as A,
  PreparationExecutionContract,
  RuleSetPreparationFailureReason,
} from "@prisma/client";
import { z } from "zod";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_CATALOG_EVENTS as EVENTS,
  LEGAL_RULE_SELECTION_MODES,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  preparationInstructionReceiptSchema,
  type PreparationRuleInput,
  type PreparationRuleComplete,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  declaresApplicabilityScope,
} from "@lcsp/contracts/compliance-rule-set";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";
import { validateAssessmentRuleBindings } from "../../../compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
import { CancelRuleSetPreparationCommand } from "../../../compliance-rule-set/application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import {
  LegalRuleCatalogService,
  catalogFailure,
  preparationInputFingerprint,
  type CatalogClient,
} from "./legal-rule-catalog.service.js";

const batchItemSchema = z.strictObject({
  ruleId: z.string().uuid(),
  resultId: z.string().uuid(),
  skipped: z.boolean(),
});
const terminalStates = new Set<A>([
  A.SUCCEEDED,
  A.FAILED,
  A.INTERRUPTED,
  A.CANCELLED,
]);
const retryStates = new Set<A>([
  A.FAILED,
  A.INTERRUPTED,
  A.CANCELLED,
  A.PAUSED,
]);

@Injectable()
export class PreparationRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: LegalRuleCatalogService,
    private readonly outbox: OutboxRepository,
    private readonly commands: CommandBus,
  ) {}

  /**
   * Business purpose: Atomically accept an exact Admin selection and dispatch only its unprepared items.
   * Business rules:
   * - The selection belongs to this actor; stale catalog/source pins reject. Replays return the same batch and charges cannot be redispatched.
   * Execution flow:
   * 1. Lock request identity
   * 2. Replay or revalidate selection
   * 3. Create item runs and existing outbox requests
   * 4. Save batch membership and audit.
   * Failure cases:
   * - Missing/foreign/empty/stale selection or conflicting idempotency payload rolls back every new write.
   * Side effects:
   * - Creates a batch, per-rule revisions, canonical runs and outbox events in one transaction.
   */
  async submit(
    request: { selectionId: string; idempotencyKey: string },
    actor: string,
    cid: string,
  ) {
    const id = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor}:${request.idempotencyKey}`}, 0))`;
        const requestHash = sha256Hex(canonicalJson(request));
        const existing = await tx.preparationRuleBatch.findUnique({
          where: {
            requestedBy_idempotencyKey: {
              requestedBy: actor,
              idempotencyKey: request.idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            catalogFailure(E.CONFLICT, cid);
          return existing.id;
        }
        const selection = await tx.preparationRuleSelection.findUnique({
          where: { id: request.selectionId },
        });
        if (!selection || selection.createdBy !== actor)
          catalogFailure(E.NOT_FOUND, cid, 404);
        await this.catalogs.lock(
          tx,
          selection.catalogVersionId,
          selection.catalogRevision,
          cid,
        );
        const inputs = z
          .array(preparationRuleInputSchema)
          .min(1)
          .parse(selection.inputs);
        const current = await this.catalogs.entries(
          tx,
          selection.catalogVersionId,
          cid,
        );
        const byId = new Map(current.items.map((item) => [item.id, item]));
        for (const input of inputs) {
          const now = byId.get(input.ruleId)?.input;
          if (
            !now ||
            preparationInputFingerprint(now) !==
              preparationInputFingerprint(input)
          )
            catalogFailure(E.STALE, cid);
        }
        await this.catalogs.hydrate(tx, inputs, cid);
        const batch = await tx.preparationRuleBatch.create({
          data: {
            selectionId: selection.id,
            requestedBy: actor,
            idempotencyKey: request.idempotencyKey,
            requestHash,
          },
        });
        const items: z.infer<typeof batchItemSchema>[] = [];
        for (const input of inputs) {
          const artifact = await tx.preparationRule.upsert({
            where: { legalRuleId: input.ruleId },
            create: { legalRuleId: input.ruleId },
            update: {},
          });
          await tx.$queryRaw`SELECT "id" FROM "PreparationRule" WHERE "id" = ${artifact.id} FOR UPDATE`;
          const last = await tx.preparationRuleResult.findFirst({
            where: { preparationRuleId: artifact.id },
            orderBy: { revision: "desc" },
            include: { preparationRun: true },
          });
          const same =
            last?.inputFingerprint === preparationInputFingerprint(input);
          if (
            last &&
            !same &&
            (last.preparationRun.executionState === A.QUEUED ||
              last.preparationRun.executionState === A.RUNNING)
          )
            catalogFailure(E.CONFLICT, cid);
          const skipped =
            !!last &&
            (last.preparationRun.executionState === A.QUEUED ||
              last.preparationRun.executionState === A.RUNNING ||
              (same && last.preparationRun.executionState === A.SUCCEEDED));
          const result = skipped
            ? last
            : await this.createResult(
                tx,
                artifact.id,
                batch.id,
                (last?.revision ?? 0) + 1,
                input,
                actor,
                cid,
              );
          items.push({ ruleId: input.ruleId, resultId: result.id, skipped });
        }
        await tx.preparationRuleBatch.update({
          where: { id: batch.id },
          data: { items },
        });
        await this.catalogs.record(
          tx,
          EVENTS.PREPARATION_REQUESTED,
          batch.id,
          actor,
          cid,
          {
            selectedCount: inputs.length,
            selectionFingerprint: selection.fingerprint,
          },
        );
        return batch.id;
      },
      { timeout: 30000 },
    );
    return this.batch(id, cid);
  }

  /**
   * Business purpose: Create one independent revision through the existing Preparation dispatch system.
   * Business rules:
   * - Runs have distinct correlation identities; snapshots are copied before dispatch, and no whole-source result is activated.
   * Execution flow:
   * 1. Create run/revision
   * 2. Enqueue the existing preparation event with the selected-result identity.
   * Failure cases:
   * - Any run, revision or outbox error rolls back the caller transaction.
   * Side effects:
   * - Persists a result attempt, RuleSetPreparationRun and existing outbox record.
   */
  private async createResult(
    tx: CatalogClient,
    artifactId: string,
    batchId: string,
    revision: number,
    input: PreparationRuleInput,
    actor: string,
    cid: string,
    retryOfId?: string,
  ) {
    const run = await tx.ruleSetPreparationRun.create({
      data: {
        idempotencyKey: `selected-rule:${artifactId}:${revision}`,
        executionContract: PreparationExecutionContract.SELECTED_RULE_V1,
        legalSourceVersionId: input.legalSourceVersionId,
        requestedBy: actor,
        correlationId: randomUUID(),
        executionState: A.QUEUED,
      },
    });
    const result = await tx.preparationRuleResult.create({
      data: {
        preparationRuleId: artifactId,
        batchId,
        preparationRunId: run.id,
        revision,
        inputSnapshot: input,
        inputFingerprint: preparationInputFingerprint(input),
        retryOfId,
      },
    });
    const outboxEventId = await this.outbox.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
        aggregateId: input.legalSourceVersionId,
        eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
        correlationId: run.correlationId,
        causationId: result.id,
        actor: { id: actor, type: AUDIT_ACTOR_TYPES.user },
        result: AGENTIC_TOOL_STATUSES.ready,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${run.id}:preparation`,
        payload: {
          preparationRunId: run.id,
          preparationRuleResultId: result.id,
          legalSourceVersionId: input.legalSourceVersionId,
        },
      }),
      tx,
    );
    await tx.ruleSetPreparationRun.update({
      where: { id: run.id },
      data: { outboxEventId },
    });
    await this.catalogs.record(
      tx,
      EVENTS.PREPARATION_REQUESTED,
      result.id,
      actor,
      cid,
      {
        preparationRunId: run.id,
        inputFingerprint: result.inputFingerprint,
        revision,
      },
    );
    return result;
  }

  /**
   * Business purpose: Read the selected Preparation Rule Set with independent progress and generated catalog output.
   * Business rules:
   * - Exact membership comes from the persisted batch; successes remain visible when another item fails.
   * Execution flow:
   * 1. Load membership and referenced revisions
   * 2. Project totals and aggregate the acknowledged outputs.
   * Failure cases:
   * - Missing batches/results reject instead of fabricating a completed set.
   * Side effects:
   * - Read-only; no model work or result mutation.
   */
  async batch(id: string, cid: string) {
    const batch = await this.prisma.preparationRuleBatch.findUnique({
      where: { id },
      include: { selection: true },
    });
    if (!batch) catalogFailure(E.NOT_FOUND, cid, 404);
    const members = z.array(batchItemSchema).parse(batch.items);
    const results = await this.prisma.preparationRuleResult.findMany({
      where: { id: { in: members.map((item) => item.resultId) } },
      include: { preparationRun: true },
    });
    if (results.length !== members.length)
      catalogFailure(E.RESULT_INVALID, cid);
    const items = members.map((member) => {
      const result = results.find((row) => row.id === member.resultId)!;
      const input = preparationRuleInputSchema.parse(result.inputSnapshot);
      return {
        ...member,
        legalRuleId: input.legalRuleId,
        title: input.title,
        revision: result.revision,
        preparationRunId: result.preparationRunId,
        executionState: result.preparationRun.executionState,
        failureCode: result.failureCode,
        output: result.output
          ? preparationRuleOutputSchema.parse(result.output)
          : null,
      };
    });
    return {
      id: batch.id,
      selectionId: batch.selectionId,
      requestedBy: batch.requestedBy,
      createdAt: batch.createdAt.toISOString(),
      scope: batch.selection.scope,
      selected: items.length,
      prepared: items.filter((item) => item.executionState === A.SUCCEEDED)
        .length,
      failed: items.filter((item) => retryStates.has(item.executionState))
        .length,
      skipped: items.filter((item) => item.skipped).length,
      complete: items.every((item) => terminalStates.has(item.executionState)),
      items,
      ruleSet: {
        legalRequirements: items.flatMap(
          (item) => item.output?.legalRequirements ?? [],
        ),
        assessmentRules: items.flatMap(
          (item) => item.output?.assessmentRules ?? [],
        ),
        contextRelations: items.flatMap(
          (item) => item.output?.contextRelations ?? [],
        ),
      },
    };
  }

  /**
   * Business purpose: Make every previous and current rule result inspectable without rerunning preparation.
   * Business rules:
   * - Latest successful revision is current; failed newer attempts remain visible with their exact pins.
   * Execution flow:
   * 1. Find the canonical artifact
   * 2. Read its bounded result history and source/instruction metadata.
   * Failure cases:
   * - Missing rule artifacts return not found; no successful result is invented.
   * Side effects:
   * - Reads persisted revision history without any model calls or mutations.
   */
  async history(ruleId: string, cid: string, beforeRevision?: number) {
    const artifact = await this.prisma.preparationRule.findUnique({
      where: { legalRuleId: ruleId },
    });
    if (!artifact) catalogFailure(E.NOT_FOUND, cid, 404);
    const where = { preparationRuleId: artifact.id };
    const [rows, current, latest] = await Promise.all([
      this.prisma.preparationRuleResult.findMany({
        where: {
          ...where,
          ...(beforeRevision ? { revision: { lt: beforeRevision } } : {}),
        },
        orderBy: { revision: "desc" },
        take: 51,
        include: { preparationRun: true },
      }),
      this.prisma.preparationRuleResult.findFirst({
        where: { ...where, preparationRun: { executionState: A.SUCCEEDED } },
        orderBy: { revision: "desc" },
        select: { id: true },
      }),
      this.prisma.preparationRuleResult.findFirst({
        where,
        orderBy: { revision: "desc" },
        select: { id: true },
      }),
    ]);
    const results = rows.slice(0, 50);
    return {
      ruleId,
      currentResultId: current?.id ?? null,
      latestResultId: latest?.id ?? null,
      nextBeforeRevision: rows.length > 50 ? results.at(-1)!.revision : null,
      results: results.map((result) => ({
        id: result.id,
        revision: result.revision,
        batchId: result.batchId,
        preparationRunId: result.preparationRunId,
        executionState: result.preparationRun.executionState,
        requestedBy: result.preparationRun.requestedBy,
        createdAt: result.createdAt.toISOString(),
        startedAt: result.preparationRun.startedAt?.toISOString() ?? null,
        completedAt: result.preparationRun.completedAt?.toISOString() ?? null,
        inputFingerprint: result.inputFingerprint,
        input: result.inputSnapshot,
        instructionReceipt: result.instructionReceipt,
        output: result.output,
        failureCode: result.failureCode,
      })),
    };
  }

  /**
   * Business purpose: Regenerate exactly one canonical rule, retaining its previous result and default source/catalog pins.
   * Business rules:
   * - Expected latest result prevents concurrent extra attempts; the request key replays. Fresh inputs require an explicit choice.
   * Execution flow:
   * 1. Lock artifact
   * 2. Replay or check current result
   * 3. Reuse pins or resolve latest inputs
   * 4. Queue one new revision.
   * Failure cases:
   * - Active work, stale result identity or invalid fresh source inputs rejects without extra model work.
   * Side effects:
   * - Creates one idempotent batch and revision using the existing outbox; prior results remain intact.
   */
  async regenerate(
    ruleId: string,
    request: {
      idempotencyKey: string;
      expectedResultId: string;
      useLatestInputs: boolean;
    },
    actor: string,
    cid: string,
  ) {
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PreparationRule" WHERE "legalRuleId" = ${ruleId} FOR UPDATE`;
      const requestHash = sha256Hex(canonicalJson({ ruleId, ...request }));
      const replay = await tx.preparationRuleBatch.findUnique({
        where: {
          requestedBy_idempotencyKey: {
            requestedBy: actor,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) catalogFailure(E.CONFLICT, cid);
        return replay.id;
      }
      const artifact = await tx.preparationRule.findUnique({
        where: { legalRuleId: ruleId },
        include: {
          results: {
            orderBy: { revision: "desc" },
            take: 1,
            include: { preparationRun: true, batch: true },
          },
        },
      });
      const last = artifact?.results[0];
      if (!last || !artifact) catalogFailure(E.NOT_FOUND, cid, 404);
      if (
        last.id !== request.expectedResultId ||
        !terminalStates.has(last.preparationRun.executionState)
      )
        catalogFailure(E.CONFLICT, cid);
      const previous = await tx.preparationRuleResult.findFirst({
        where: {
          preparationRuleId: artifact.id,
          preparationRun: { executionState: A.SUCCEEDED },
        },
        orderBy: { revision: "desc" },
      });
      let input = preparationRuleInputSchema.parse(
        (previous ?? last).inputSnapshot,
      );
      if (request.useLatestInputs) {
        const { items } = await this.catalogs.entries(
          tx,
          input.catalogVersionId,
          cid,
        );
        const latest = items.find((item) => item.id === ruleId)?.input;
        if (!latest) catalogFailure(E.INELIGIBLE, cid);
        input = (await this.catalogs.hydrate(tx, [latest], cid))[0];
      } else await this.catalogs.hydrate(tx, [input], cid);
      const selection = await tx.preparationRuleSelection.create({
        data: {
          catalogVersionId: input.catalogVersionId,
          catalogRevision: input.catalogRevision,
          createdBy: actor,
          scope: {
            catalogVersionId: input.catalogVersionId,
            expectedRevision: input.catalogRevision,
            mode: LEGAL_RULE_SELECTION_MODES.EXPLICIT,
            filters: { search: "" },
            ruleIds: [ruleId],
          },
          inputs: [input],
          fingerprint: preparationInputFingerprint(input),
        },
      });
      const batch = await tx.preparationRuleBatch.create({
        data: {
          selectionId: selection.id,
          requestedBy: actor,
          idempotencyKey: request.idempotencyKey,
          requestHash,
        },
      });
      const result = await this.createResult(
        tx,
        artifact.id,
        batch.id,
        last.revision + 1,
        input,
        actor,
        cid,
      );
      await tx.preparationRuleBatch.update({
        where: { id: batch.id },
        data: { items: [{ ruleId, resultId: result.id, skipped: false }] },
      });
      return batch.id;
    });
    return this.batch(id, cid);
  }

  /**
   * Business purpose: Retry failed/interrupted selected items while retaining successful batch results.
   * Business rules:
   * - One failed revision gets at most one retry; successful items never receive another attempt.
   * Execution flow:
   * 1. Lock batch and artifacts
   * 2. Reuse existing retries or create failed-item revisions
   * 3. Persist a new retry batch while preserving the original membership.
   * Failure cases:
   * - Missing batches or still-active revisions reject; a duplicate call reuses its previously created retry.
   * Side effects:
   * - Creates only needed retry runs and outbox events; preserves all previous revisions.
   */
  async retry(
    batchId: string,
    idempotencyKey: string,
    actor: string,
    cid: string,
  ) {
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PreparationRuleBatch" WHERE "id" = ${batchId} FOR UPDATE`;
      const batch = await tx.preparationRuleBatch.findUnique({
        where: { id: batchId },
      });
      if (!batch) catalogFailure(E.NOT_FOUND, cid, 404);
      const requestHash = sha256Hex(canonicalJson({ batchId, idempotencyKey }));
      const replay = await tx.preparationRuleBatch.findUnique({
        where: {
          requestedBy_idempotencyKey: { requestedBy: actor, idempotencyKey },
        },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) catalogFailure(E.CONFLICT, cid);
        return replay.id;
      }
      const retriedBatch = await tx.preparationRuleBatch.create({
        data: {
          selectionId: batch.selectionId,
          requestedBy: actor,
          idempotencyKey,
          requestHash,
        },
      });
      const items = z.array(batchItemSchema).parse(batch.items);
      for (const item of items) {
        const result = await tx.preparationRuleResult.findUniqueOrThrow({
          where: { id: item.resultId },
          include: { preparationRun: true },
        });
        if (!retryStates.has(result.preparationRun.executionState)) {
          item.skipped = true;
          continue;
        }
        await tx.$queryRaw`SELECT "id" FROM "PreparationRule" WHERE "id" = ${result.preparationRuleId} FOR UPDATE`;
        const existing = await tx.preparationRuleResult.findUnique({
          where: { retryOfId: result.id },
        });
        const latest = await tx.preparationRuleResult.findFirstOrThrow({
          where: { preparationRuleId: result.preparationRuleId },
          orderBy: { revision: "desc" },
        });
        if (!existing && latest.id !== result.id)
          catalogFailure(E.CONFLICT, cid);
        const input = preparationRuleInputSchema.parse(result.inputSnapshot);
        await this.catalogs.hydrate(tx, [input], cid);
        const retry =
          existing ??
          (await this.createResult(
            tx,
            result.preparationRuleId,
            retriedBatch.id,
            result.revision + 1,
            input,
            actor,
            cid,
            result.id,
          ));
        item.resultId = retry.id;
        item.skipped = false;
      }
      await tx.preparationRuleBatch.update({
        where: { id: retriedBatch.id },
        data: { items },
      });
      return retriedBatch.id;
    });
    return this.batch(id, cid);
  }

  /**
   * Business purpose: Admit exactly one worker for a selected rule using its persisted source snapshot.
   * Business rules:
   * - Only QUEUED can claim; automatic takeover cannot repeat paid work. Interrupted items need explicit retry.
   * Execution flow:
   * 1. Lock run
   * 2. Verify selected identity and source pins
   * 3. Atomically set RUNNING and return one input.
   * Failure cases:
   * - Duplicate, cancelled, foreign or missing runs reject before model construction.
   * Side effects:
   * - Sets this run's start time and RUNNING state only.
   */
  async claim(runId: string, cid: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${runId} FOR UPDATE`;
      const result = await tx.preparationRuleResult.findUnique({
        where: { preparationRunId: runId },
        include: { preparationRun: true },
      });
      if (!result) catalogFailure(E.NOT_FOUND, cid, 404);
      if (result.preparationRun.executionState !== A.QUEUED)
        catalogFailure(E.CONFLICT, cid);
      const input = preparationRuleInputSchema.parse(result.inputSnapshot);
      await tx.ruleSetPreparationRun.update({
        where: { id: runId },
        data: { executionState: A.RUNNING, startedAt: new Date() },
      });
      try {
        await this.catalogs.hydrate(tx, [input], cid);
      } catch (error) {
        if (!(error instanceof Error) || !("getStatus" in error)) throw error;
        await tx.preparationRuleResult.update({
          where: { id: result.id },
          data: { failureCode: E.INELIGIBLE },
        });
        await tx.ruleSetPreparationRun.update({
          where: { id: runId },
          data: {
            executionState: A.FAILED,
            failureReason:
              RuleSetPreparationFailureReason.SOURCE_VERSION_UNAVAILABLE,
            completedAt: new Date(),
          },
        });
        await this.catalogs.record(
          tx,
          EVENTS.RESULT_RECORDED,
          result.id,
          result.preparationRun.requestedBy,
          cid,
          { preparationRunId: runId, outcome: A.FAILED, reason: E.INELIGIBLE },
        );
        return {
          preparationRunId: runId,
          resultId: result.id,
          refused: true,
          failureCode: E.INELIGIBLE,
        };
      }
      return {
        preparationRunId: runId,
        resultId: result.id,
        revision: result.revision,
        input,
        inputFingerprint: result.inputFingerprint,
      };
    });
  }

  /**
   * Business purpose: Record the exact freshly loaded instruction bytes before selected-rule model work begins.
   * Business rules:
   * - The receipt is write-once, hash verified and bound to a RUNNING selected run; development instruction edits need no publication workflow.
   * Execution flow:
   * 1. Lock run
   * 2. Verify state and content hash
   * 3. Store or replay the identical receipt.
   * Failure cases:
   * - State drift, byte/hash mismatch or changed receipt rejects before model invocation.
   * Side effects:
   * - Persists the immutable instruction receipt for one result revision.
   */
  async instructions(
    runId: string,
    receipt: z.infer<typeof preparationInstructionReceiptSchema>,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${runId} FOR UPDATE`;
      const result = await tx.preparationRuleResult.findUnique({
        where: { preparationRunId: runId },
        include: { preparationRun: true },
      });
      if (
        !result ||
        result.preparationRun.executionState !== A.RUNNING ||
        sha256Hex(receipt.content) !== receipt.fingerprint
      )
        catalogFailure(E.CONFLICT, cid);
      if (
        result.instructionReceipt &&
        canonicalJson(result.instructionReceipt) !== canonicalJson(receipt)
      )
        catalogFailure(E.CONFLICT, cid);
      if (!result.instructionReceipt)
        await tx.preparationRuleResult.update({
          where: { id: result.id },
          data: { instructionReceipt: receipt },
        });
      return { recorded: true };
    });
  }

  /**
   * Business purpose: Finish one selected rule without rolling back or activating unrelated results.
   * Business rules:
   * - Successful output requires a recorded instruction receipt and exact source allowlist; terminal callback replays must be identical.
   * Execution flow:
   * 1. Lock run
   * 2. Verify output identity/references
   * 3. Record result and terminal run state together
   * 4. Audit.
   * Failure cases:
   * - Foreign citations, unknown parent requirements, inconsistent terminal replay or missing receipt rejects.
   * Side effects:
   * - Stores immutable result output, timestamps, outcome and audit; no catalog or customer assessment is changed.
   */
  async complete(request: PreparationRuleComplete, cid: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${request.preparationRunId} FOR UPDATE`;
      const result = await tx.preparationRuleResult.findUnique({
        where: { preparationRunId: request.preparationRunId },
        include: { preparationRun: true },
      });
      if (!result) catalogFailure(E.NOT_FOUND, cid, 404);
      if (terminalStates.has(result.preparationRun.executionState)) {
        if (
          result.preparationRun.executionState !== request.executionState ||
          canonicalJson(result.output) !== canonicalJson(request.output) ||
          result.failureCode !== request.failureCode
        )
          catalogFailure(E.CONFLICT, cid);
        return { resultId: result.id };
      }
      if (result.preparationRun.executionState !== A.RUNNING)
        catalogFailure(E.CONFLICT, cid);
      const success = request.executionState === A.SUCCEEDED;
      if (success) {
        if (
          !result.instructionReceipt ||
          !request.output ||
          request.failureCode
        )
          catalogFailure(E.RESULT_INVALID, cid, 422);
        validateSelectedOutput(
          preparationRuleInputSchema.parse(result.inputSnapshot),
          request.output,
          cid,
        );
      } else if (request.output) catalogFailure(E.RESULT_INVALID, cid, 422);
      await tx.preparationRuleResult.update({
        where: { id: result.id },
        data: {
          output: request.output
            ? (request.output as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          failureCode: request.failureCode,
        },
      });
      await tx.ruleSetPreparationRun.update({
        where: { id: request.preparationRunId },
        data: {
          executionState: request.executionState,
          failureReason:
            request.executionState === A.FAILED
              ? RuleSetPreparationFailureReason.RUNTIME_ERROR
              : null,
          completedAt: new Date(),
        },
      });
      await this.catalogs.record(
        tx,
        EVENTS.RESULT_RECORDED,
        result.id,
        result.preparationRun.requestedBy,
        cid,
        {
          preparationRunId: request.preparationRunId,
          outcome: request.executionState,
          revision: result.revision,
        },
      );
      return { resultId: result.id };
    });
  }

  /**
   * Business purpose: Cancel one selected run through existing native runtime cancellation.
   * Business rules:
   * - Successful revisions remain immutable; cancellation fences publication before signaling the runtime.
   * Execution flow:
   * 1. Verify this run belongs to a selected rule result.
   * 2. Delegate cancellation and write fencing to the existing command handler.
   * Failure cases:
   * - Missing runs reject; transport cancellation errors remain visible while the publication fence stays closed.
   * Side effects:
   * - Updates cancellation state and signals the existing runtime; no other selected items change.
   */
  async cancel(runId: string, cid: string) {
    const result = await this.prisma.preparationRuleResult.findUnique({
      where: { preparationRunId: runId },
    });
    if (!result) catalogFailure(E.NOT_FOUND, cid, 404);
    await this.commands.execute(
      new CancelRuleSetPreparationCommand(runId, cid),
    );
    return { preparationRunId: runId };
  }
}

/**
 * Business purpose: Validate selected preparation structure and provenance without deciding legal applicability.
 * Business rules:
 * - References stay within pinned chunks; AssessmentRule parents must be present, assessable and uniquely identified.
 * Execution flow:
 * 1. Parse canonical downstream contracts
 * 2. Verify unique identities, source allowlist and parent links.
 * Failure cases:
 * - Invalid structure, duplicates, foreign sources or missing/non-assessable parents return RESULT_INVALID.
 * Side effects:
 * - Pure validation; no semantic decision, publication or model work.
 */
export function validateSelectedOutput(
  input: PreparationRuleInput,
  output: z.infer<typeof preparationRuleOutputSchema>,
  cid: string,
): void {
  const parsed = preparationRuleOutputSchema.safeParse(output);
  if (!parsed.success) catalogFailure(E.RESULT_INVALID, cid, 422);
  const requirements = new Map(
    output.legalRequirements.map((rule) => [rule.legalRequirementId, rule]),
  );
  const assessmentIds = new Set(
    output.assessmentRules.map((rule) => rule.assessmentRuleId),
  );
  const relationIds = new Set(
    output.contextRelations.map((edge) => edge.relationId),
  );
  if (
    requirements.size !== output.legalRequirements.length ||
    assessmentIds.size !== output.assessmentRules.length ||
    relationIds.size !== output.contextRelations.length ||
    validateAssessmentRuleBindings(output).length
  )
    catalogFailure(E.RESULT_INVALID, cid, 422);
  const allowed = new Set(
    input.citations.map((ref) =>
      canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
    ),
  );
  const prefix = `${input.ruleId}:`;
  for (const rule of output.legalRequirements) {
    if (
      !rule.legalRequirementId.startsWith(prefix) ||
      !rule.operativePropositions?.length ||
      !declaresApplicabilityScope(
        rule.coverage.state,
        rule.applicabilityConditions,
        rule.applicabilityMode,
      )
    )
      catalogFailure(E.RESULT_INVALID, cid, 422);
    const own = new Set(rule.sourceRefs.map((ref) => canonicalJson(ref)));
    if (
      rule.operativePropositions.some((proposition) =>
        proposition.sourceRefs.some((ref) => !own.has(canonicalJson(ref))),
      )
    )
      catalogFailure(E.RESULT_INVALID, cid, 422);
  }
  for (const rule of [...output.legalRequirements, ...output.assessmentRules]) {
    if (
      !rule.sourceRefs.length ||
      rule.sourceRefs.some(
        (ref) =>
          !allowed.has(
            canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
          ),
      )
    )
      catalogFailure(E.RESULT_INVALID, cid, 422);
  }
  for (const edge of output.contextRelations) {
    if (
      !edge.relationId.startsWith(prefix) ||
      !requirements.has(edge.fromLegalRequirementId) ||
      (edge.toLegalRequirementId &&
        !requirements.has(edge.toLegalRequirementId)) ||
      (edge.toSourceRef &&
        !allowed.has(
          canonicalJson([
            edge.toSourceRef.documentId,
            edge.toSourceRef.locator,
            edge.toSourceRef.contentSha256,
          ]),
        ))
    )
      catalogFailure(E.RESULT_INVALID, cid, 422);
  }
  for (const rule of output.assessmentRules) {
    if (
      !rule.assessmentRuleId.startsWith(prefix) ||
      rule.legalRequirementIds.some(
        (id) =>
          !requirements.has(id) ||
          requirements.get(id)!.coverage.state ===
            LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      )
    )
      catalogFailure(E.RESULT_INVALID, cid, 422);
  }
}
