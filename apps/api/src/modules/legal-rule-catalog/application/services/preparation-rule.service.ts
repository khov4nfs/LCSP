import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_UNRESOLVED_STATES,
} from "@lcsp/contracts/compliance-rule-set";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_CATALOG_EVENTS as EVENTS,
  LEGAL_RULE_SELECTION_MODES,
  preparationInstructionReceiptSchema,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  selectedScopeDecisionSchema,
  type AssessmentRuleImportRequest,
  type AssessmentRuleImportResult,
  // Shared contracts type activation, output collection, and rule validation.
  type LegalRuleActivationRequest,
  type LegalRuleActivationResult,
  type PreparationRuleComplete,
  type PreparationRuleInput,
  type PreparationRuleValidate,
  type SelectedScopeAuthorizationApprove,
  type SelectedScopeAuthorizationRevoke,
  type SelectedScopeAuthorizationSubmit,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { Injectable, Optional } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import {
  AgentExecutionState as A,
  PreparationExecutionContract,
  PreparationScopeReviewState,
  Prisma,
  RuleSetPreparationFailureReason,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";
import { ComplianceRuleSetActivation } from "../../../compliance-rule-set/infrastructure/persistence/compliance-rule-set-activation.service.js";
import { LegalSourceSnapshotLoader } from "../../../compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import {
  requireSelectedScopeAuthorization,
  requireSelectedScopeSource,
  selectedScopeKey,
  validateSelectedScopeDecisions,
} from "../../../compliance-rule-set/infrastructure/persistence/selected-scope-authority.js";
import { LegalSourceAuthorityService } from "../../../legal-source/application/services/legal-source-authority.service.js";

import { CancelRuleSetPreparationCommand } from "../../../compliance-rule-set/application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import { ActivatePreparedRulesCommand } from "../commands/activate-prepared-rules/activate-prepared-rules.command.js";
import { ActivatePreparedRulesHandler } from "../commands/activate-prepared-rules/activate-prepared-rules.handler.js";
import { ImportAssessmentRulesCommand } from "../commands/import-assessment-rules/import-assessment-rules.command.js";
import { ImportAssessmentRulesHandler } from "../commands/import-assessment-rules/import-assessment-rules.handler.js";
import {
  catalogFailure,
  LegalRuleCatalogService,
  preparationInputFingerprint,
  type CatalogClient,
} from "./legal-rule-catalog.service.js";
import { validateSelectedOutput } from "./selected-output-validation.js";

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
// Why: A selected-rule run can still execute while its native cancellation is pending.
// How: Reuse the canonical unresolved states shared with Rule Set reactivation.
// Invariant: No new selected-rule revision is created until a prior run reaches a terminal state.
const unresolvedPreparationStates = new Set<string>(
  RULE_SET_PREPARATION_UNRESOLVED_STATES,
);

// Why: Advisory locks without an explicit domain namespace can collide with other services sharing the database.
// How: Use a 32-bit application namespace constant (0x4c435350 = 'LCSP') for two-key pg_advisory_xact_lock.
// Invariant: Concurrent submit requests for legal rule preparation are partitioned safely from other advisory locks.
const ADVISORY_NAMESPACE_PREPARATION = 0x4c435350;

@Injectable()
export class PreparationRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: LegalRuleCatalogService,
    private readonly outbox: OutboxRepository,
    private readonly commands: CommandBus,
    private readonly sourceSnapshot: LegalSourceSnapshotLoader,
    private readonly activation: ComplianceRuleSetActivation,
    private readonly scopeSourceAuthority: LegalSourceAuthorityService = new LegalSourceAuthorityService(),
    @Optional() private readonly activateHandler?: ActivatePreparedRulesHandler,
    @Optional() private readonly importHandler?: ImportAssessmentRulesHandler,
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
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_NAMESPACE_PREPARATION}, hashtext(${`${actor}:${request.idempotencyKey}`}))`;
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
        // Why: Row locks acquired in arbitrary or client-supplied order cause deadlocks under concurrency.
        // How: Upsert all PreparationRule records, collect their unique IDs, and lock them in strict ascending order before per-item processing.
        // Invariant: Concurrent transactions always acquire row locks on PreparationRule in the exact same order.
        const artifactMap = new Map<string, { id: string }>();
        for (const input of inputs) {
          const artifact = await tx.preparationRule.upsert({
            where: { legalRuleId: input.ruleId },
            create: { legalRuleId: input.ruleId },
            update: {},
          });
          artifactMap.set(input.ruleId, artifact);
        }
        const sortedArtifactIds = [
          ...new Set([...artifactMap.values()].map((a) => a.id)),
        ].sort();
        if (sortedArtifactIds.length > 0) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "PreparationRule" WHERE "id" IN (${Prisma.join(sortedArtifactIds)}) ORDER BY "id" FOR UPDATE`,
          );
        }
        const items: z.infer<typeof batchItemSchema>[] = [];
        for (const input of inputs) {
          const artifact = artifactMap.get(input.ruleId)!;
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
            unresolvedPreparationStates.has(last.preparationRun.executionState)
          )
            catalogFailure(E.CONFLICT, cid);
          const skipped =
            !!last &&
            (unresolvedPreparationStates.has(
              last.preparationRun.executionState,
            ) ||
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
        legalRequirements: items.flatMap((item) =>
          item.executionState === A.SUCCEEDED
            ? (item.output?.legalRequirements ?? [])
            : [],
        ),
        assessmentRules: items.flatMap((item) =>
          item.executionState === A.SUCCEEDED
            ? (item.output?.assessmentRules ?? [])
            : [],
        ),
        contextRelations: items.flatMap((item) =>
          item.executionState === A.SUCCEEDED
            ? (item.output?.contextRelations ?? [])
            : [],
        ),
      },
    };
  }

  /**
   * Business purpose: Publish an Admin-selected prepared result through the canonical Rule Set lifecycle.
   * Business rules:
   * - Preserve the handler's exact result, actor, revision and source-pin checks.
   * Execution flow:
   * 1. Dispatch the typed publication command through CQRS in Nest; direct service tests use the same handler as fallback.
   * 2. Execute the request.
   * Failure cases:
   * - Handler rejection propagates without a partial publication.
   * Side effects:
   * - The handler atomically publishes the selected Rule Set and audit/outbox records.
   */
  async activate(
    catalogId: string,
    request: LegalRuleActivationRequest,
    actor: string,
    cid: string,
  ): Promise<LegalRuleActivationResult> {
    // Why: Existing callers and direct-instantiation tests use this service facade; the handler owns publication decisions.
    // How: Dispatch through CommandBus when Nest injected the handler; direct service tests construct the same handler.
    // Invariant: The request stays in one transaction owned by the handler.
    const command = new ActivatePreparedRulesCommand(
      catalogId,
      request,
      actor,
      cid,
    );
    if (this.activateHandler)
      return this.commands.execute<
        ActivatePreparedRulesCommand,
        LegalRuleActivationResult
      >(command);
    return new ActivatePreparedRulesHandler(
      this.prisma,
      this.catalogs,
      this.sourceSnapshot,
      this.activation,
      this.scopeSourceAuthority,
    ).execute(command);
  }

  /**
   * Business purpose: Register reusable source-backed semantic review without creating a Preparation run.
   * Business rules:
   * - Only the authenticated Admin route supplies the author; the candidate must match the current catalog and official original source.
   * - A draft cannot publish; approved authority is immutable and cannot be self-approved.
   * Execution flow: 1. Lock and hydrate the exact catalog entry. 2. Validate output and decision source support. 3. CAS-create/update the draft and audit.
   * Failure cases:
   * - Stale revisions, missing source or invalid scope evidence reject before writes.
   * Side effects:
   * - Saves a review candidate and audit event only; never invokes a provider or creates a result.
   */
  async submitScopeAuthorization(
    catalogId: string,
    request: SelectedScopeAuthorizationSubmit,
    actor: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.catalogs.lock(
        tx,
        catalogId,
        request.expectedCatalogRevision,
        cid,
      );
      const { items } = await this.catalogs.entries(tx, catalogId, cid);
      const item = items.find((row) => row.id === request.ruleId);
      if (!item?.input) catalogFailure(E.INELIGIBLE, cid);
      const [input] = await this.catalogs.hydrate(tx, [item.input], cid);
      validateSelectedOutput(input, request.output, cid, true);
      const scopeKey = selectedScopeKey(input, request.output);
      const decisionDigest = validateSelectedScopeDecisions(
        input,
        request.output,
        request.decisions,
        cid,
        false,
      );
      const existing = await tx.selectedRuleScopeAuthorization.findUnique({
        where: { scopeKey },
      });
      // Preserve immutable approval/revocation history: never overwrite a row that
      // has already been APPROVED, REJECTED (revoked), or carries an approvedBy signature.
      if (
        (existing?.revision ?? 0) !== request.expectedReviewRevision ||
        (existing &&
          (existing.state !== PreparationScopeReviewState.DRAFT ||
            existing.approvedBy !== null))
      )
        catalogFailure(E.CONFLICT, cid);
      const data = {
        legalSourceVersionId: input.legalSourceVersionId,
        catalogId,
        ruleId: input.ruleId,
        output: request.output as unknown as Prisma.InputJsonValue,
        decisions: request.decisions as unknown as Prisma.InputJsonValue,
        decisionDigest,
        submittedBy: actor,
        state: PreparationScopeReviewState.DRAFT,
        approvedBy: null,
        approvedAt: null,
      };
      const row = existing
        ? await tx.selectedRuleScopeAuthorization.update({
            where: { scopeKey },
            data: { ...data, revision: { increment: 1 } },
          })
        : await tx.selectedRuleScopeAuthorization.create({
            data: { scopeKey, ...data },
          });
      await this.catalogs.record(
        tx,
        EVENTS.SCOPE_AUTHORIZATION_SUBMITTED,
        scopeKey,
        actor,
        cid,
        {
          scopeAuthorizationId: scopeKey,
          decisionDigest,
          revision: row.revision,
        },
      );
      return {
        scopeKey,
        decisionDigest,
        revision: row.revision,
        state: row.state,
      };
    });
  }

  /**
   * Business purpose: List persisted semantic review authorizations for a specific Legal Rule in a catalog.
   * Business rules:
   * - Read-only catalog/rule scoped query; returns newest first so UI can auto-select without manual key entry.
   * Execution flow: 1. Query SelectedRuleScopeAuthorization by catalogId and ruleId ordered by updatedAt desc.
   * Failure cases:
   * - Database read errors propagate without modifying persisted records.
   * Side effects:
   * - Read-only database query.
   */
  async listScopeAuthorizationsForRule(catalogId: string, ruleId: string) {
    const rows = await this.prisma.selectedRuleScopeAuthorization.findMany({
      where: { catalogId, ruleId },
      orderBy: [{ updatedAt: "desc" }],
      take: 20,
      select: {
        scopeKey: true,
        decisionDigest: true,
        revision: true,
        state: true,
      },
    });
    return { authorizations: rows };
  }

  /**
   * Business purpose: Present a persisted semantic candidate and the exact source to an independent reviewer.
   * Business rules:
   * - Only the owning catalog, current eligible rule and matching pinned evidence are accessible, including historical keys.
   * Execution flow: 1. Read the candidate. 2. Resolve the catalog entry and hydrate its pinned source. 3. Recheck the semantic key and return the reviewed payload.
   * Failure cases:
   * - Missing, mismatched or stale evidence returns a typed conflict.
   * Side effects:
   * - Read-only; no model invocation, mutation or approval.
   */
  async readScopeAuthorization(
    catalogId: string,
    scopeKey: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.selectedRuleScopeAuthorization.findUnique({
        where: { scopeKey },
      });
      if (!row || row.catalogId !== catalogId) catalogFailure(E.CONFLICT, cid);
      const { items } = await this.catalogs.entries(tx, catalogId, cid);
      const item = items.find((candidate) => candidate.id === row.ruleId);
      if (!item?.input) catalogFailure(E.INELIGIBLE, cid);
      const [input] = await this.catalogs.hydrate(tx, [item.input], cid);
      const output = preparationRuleOutputSchema.parse(row.output);
      const decisions = z
        .array(selectedScopeDecisionSchema)
        .parse(row.decisions);
      if (
        // Historical rows remain auditable under their original key.
        (selectedScopeKey(input, output) !== scopeKey &&
          selectedScopeKey(input, output, 1) !== scopeKey) ||
        validateSelectedScopeDecisions(input, output, decisions, cid, false) !==
          row.decisionDigest
      )
        catalogFailure(E.CONFLICT, cid);
      return {
        scopeKey,
        ruleId: row.ruleId,
        state: row.state,
        revision: row.revision,
        catalogRevision: input.catalogRevision,
        decisionDigest: row.decisionDigest,
        submittedBy: row.submittedBy,
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt,
        legalSourceVersionId: input.legalSourceVersionId,
        output,
        decisions,
        citations: input.citations,
      };
    });
  }

  /**
   * Business purpose: Independently approve an exact reusable legal-scope candidate.
   * Business rules:
   * - The reviewer must differ from the author and explicitly confirm the reviewed legal meaning.
   * - All operative decisions, effective original citations and material context must match; unresolved or mixed unsupported candidates cannot publish.
   * Execution flow: 1. Lock catalog revision and reload the draft. 2. Rehydrate source and revalidate candidate/digest. 3. Mark approved and audit atomically.
   * Failure cases:
   * - Self-approval, stale or changed candidates, unresolved scope, source drift and malformed evidence reject.
   * Side effects:
   * - Persists independent reviewer identity; no Preparation, provider calls or automatic activation.
   */
  async approveScopeAuthorization(
    catalogId: string,
    request: SelectedScopeAuthorizationApprove,
    actor: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.catalogs.lock(
        tx,
        catalogId,
        request.expectedCatalogRevision,
        cid,
      );
      const row = await tx.selectedRuleScopeAuthorization.findUnique({
        where: { scopeKey: request.scopeKey },
      });
      if (
        request.confirmsLegalReview !== true ||
        !row ||
        row.catalogId !== catalogId ||
        row.ruleId !== request.ruleId ||
        row.state !== PreparationScopeReviewState.DRAFT ||
        row.submittedBy === actor ||
        row.revision !== request.expectedReviewRevision ||
        row.decisionDigest !== request.decisionDigest
      )
        catalogFailure(E.CONFLICT, cid);
      const { items } = await this.catalogs.entries(tx, catalogId, cid);
      const item = items.find((candidate) => candidate.id === request.ruleId);
      if (!item?.input) catalogFailure(E.INELIGIBLE, cid);
      const [input] = await this.catalogs.hydrate(tx, [item.input], cid);
      const output = preparationRuleOutputSchema.parse(row.output);
      const decisions = z
        .array(selectedScopeDecisionSchema)
        .parse(row.decisions);
      validateSelectedOutput(input, output, cid);
      if (
        row.legalSourceVersionId !== input.legalSourceVersionId ||
        selectedScopeKey(input, output) !== row.scopeKey ||
        validateSelectedScopeDecisions(input, output, decisions, cid) !==
          row.decisionDigest
      )
        catalogFailure(E.CONFLICT, cid);
      await requireSelectedScopeSource(
        tx,
        input,
        output,
        cid,
        this.scopeSourceAuthority,
      );
      const approved = await tx.selectedRuleScopeAuthorization.update({
        where: { scopeKey: row.scopeKey },
        data: {
          state: PreparationScopeReviewState.APPROVED,
          approvedBy: actor,
          approvedAt: new Date(),
        },
      });
      await this.catalogs.record(
        tx,
        EVENTS.SCOPE_AUTHORIZATION_APPROVED,
        row.scopeKey,
        actor,
        cid,
        {
          scopeAuthorizationId: row.scopeKey,
          decisionDigest: row.decisionDigest,
          revision: row.revision,
        },
      );
      return {
        scopeKey: approved.scopeKey,
        decisionDigest: approved.decisionDigest,
        revision: approved.revision,
        state: approved.state,
      };
    });
  }

  /**
   * Business purpose: Revoke a previously approved semantic authorization so flawed interpretations cannot authorize new publications or imports.
   * Business rules:
   * - Only an APPROVED authorization belonging to this catalog at the expected review revision may be revoked.
   * - Historical published Rule Sets and prior audit records remain intact; revocation only transitions the authorization to REJECTED.
   * Execution flow: 1. Lock the catalog revision. 2. Verify the target authorization is APPROVED and matches expectedReviewRevision. 3. Transition state to REJECTED, increment revision, and write an attributed audit event.
   * Failure cases:
   * - Stale catalog/review revisions, missing rows, or non-APPROVED rows reject with CONFLICT.
   * Side effects:
   * - Updates SelectedRuleScopeAuthorization.state to REJECTED and appends a SCOPE_AUTHORIZATION_REVOKED audit record.
   */
  async revokeScopeAuthorization(
    catalogId: string,
    request: SelectedScopeAuthorizationRevoke,
    actor: string,
    cid: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.catalogs.lock(
        tx,
        catalogId,
        request.expectedCatalogRevision,
        cid,
      );
      const row = await tx.selectedRuleScopeAuthorization.findUnique({
        where: { scopeKey: request.scopeKey },
      });
      if (
        !row ||
        row.catalogId !== catalogId ||
        row.revision !== request.expectedReviewRevision ||
        row.state !== PreparationScopeReviewState.APPROVED
      )
        catalogFailure(E.CONFLICT, cid);
      // Preserve approvedBy, approvedAt, output, and decisions on the row for historical traceability
      // while blocking any new publication or import from reusing this authority.
      const revoked = await tx.selectedRuleScopeAuthorization.update({
        where: { scopeKey: row.scopeKey },
        data: {
          state: PreparationScopeReviewState.REJECTED,
          revision: { increment: 1 },
        },
      });
      await this.catalogs.record(
        tx,
        EVENTS.SCOPE_AUTHORIZATION_REVOKED,
        row.scopeKey,
        actor,
        cid,
        {
          scopeAuthorizationId: row.scopeKey,
          decisionDigest: row.decisionDigest,
          previousRevision: row.revision,
          revision: revoked.revision,
          reason: request.reason,
          previousApprovedBy: row.approvedBy,
        },
      );
      return {
        scopeKey: revoked.scopeKey,
        decisionDigest: revoked.decisionDigest,
        revision: revoked.revision,
        state: revoked.state,
      };
    });
  }

  /**
   * Business purpose: Import externally authored assessment rules as prepared revisions.
   * Business rules:
   * - Preserve catalog ownership, pinned source, replay and dry-run decisions in the handler.
   * Execution flow:
   * 1. Dispatch the typed import command through CQRS in Nest; direct service tests use the same handler as fallback.
   * 2. Execute the request.
   * Failure cases:
   * - Validation and transaction errors propagate with their canonical problem codes.
   * Side effects:
   * - The handler writes revisions and audits only for non-dry-run imports.
   */
  async importAssessmentRules(
    catalogId: string,
    request: AssessmentRuleImportRequest,
    actor: string,
    cid: string,
  ): Promise<AssessmentRuleImportResult> {
    // Why: Maintain the existing service API while relocating the transaction-heavy use case.
    // How: Dispatch through CommandBus when Nest injected the handler; direct service tests construct the same handler.
    // Invariant: Dry-run and replay behavior remain identical for existing callers.
    const command = new ImportAssessmentRulesCommand(
      catalogId,
      request,
      actor,
      cid,
    );
    if (this.importHandler)
      return this.commands.execute<
        ImportAssessmentRulesCommand,
        AssessmentRuleImportResult
      >(command);
    return new ImportAssessmentRulesHandler(
      this.prisma,
      this.catalogs,
      this.scopeSourceAuthority,
    ).execute(command);
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
      if (!result || result.preparationRun.executionState !== A.RUNNING)
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
   * Business purpose: Let the worker learn whether a drafted selected-rule result would be accepted, so a fixable structural mistake is repaired before the run settles as FAILED.
   * Business rules:
   * - Only a RUNNING selected run with a recorded instruction receipt can be checked; the exact settlement validation is reused, so a dry run can never accept what completion would reject.
   * - Diagnostics are limited to structural field paths; authored values and citation content are never echoed.
   * Execution flow:
   * 1. Load the run's result and pinned input snapshot.
   * 2. Reject runs that are not RUNNING or have no instruction receipt.
   * 3. Apply the shared selected-output validation to the draft.
   * Failure cases:
   * - A run without a selected result returns NOT_FOUND; non-running runs return CONFLICT; invalid drafts return RESULT_INVALID with a safe field path.
   * Side effects:
   * - Read-only: no result, run state, audit event or outbox message is written.
   */
  async validate(request: PreparationRuleValidate, cid: string) {
    const result = await this.prisma.preparationRuleResult.findUnique({
      where: { preparationRunId: request.preparationRunId },
      include: { preparationRun: true },
    });
    if (!result) catalogFailure(E.NOT_FOUND, cid, 404);
    if (
      result.preparationRun.executionState !== A.RUNNING ||
      !result.instructionReceipt
    )
      catalogFailure(E.CONFLICT, cid);
    const input = preparationRuleInputSchema.parse(result.inputSnapshot);
    validateSelectedOutput(input, request.output, cid);
    // A missing positive grant is a legal-review error, never a paid structural repair.
    await requireSelectedScopeAuthorization(
      this.prisma,
      input,
      request.output,
      cid,
      this.scopeSourceAuthority,
    );
    return { valid: true as const };
  }

  /**
   * Business purpose: Finish one selected rule without rolling back or activating unrelated results.
   * Business rules:
   * - Successful output requires a recorded instruction receipt and exact source allowlist; terminal callback replays must be identical.
   * - A failed legal-review result may retain its validated draft for history only; it is never a prepared rule set.
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
        const input = preparationRuleInputSchema.parse(result.inputSnapshot);
        validateSelectedOutput(input, request.output, cid);
        // Completion rechecks authority even when worker preflight was inconclusive.
        await requireSelectedScopeAuthorization(
          tx,
          input,
          request.output,
          cid,
          this.scopeSourceAuthority,
        );
      } else if (
        request.executionState === A.FAILED &&
        request.failureCode === E.SCOPE_REVIEW_REQUIRED &&
        request.output &&
        result.instructionReceipt
      ) {
        // Retain a provenance-validated unresolved draft for history, never publication.
        validateSelectedOutput(
          preparationRuleInputSchema.parse(result.inputSnapshot),
          request.output,
          cid,
          true,
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
          // Preserve the typed terminal reason without copying the legal draft into audit.
          ...(request.failureCode ? { failureCode: request.failureCode } : {}),
          revision: result.revision,
        },
      );
      return { resultId: result.id };
    });
  }

  /**
   * Business purpose: Cancel one selected run through existing native runtime cancellation.
   * Business rules:
   * - The authenticated Admin is the cancellation audit actor; successful revisions remain immutable.
   * - Cancellation fences publication before signaling the runtime.
   * Execution flow:
   * 1. Verify this run belongs to a selected rule result.
   * 2. Delegate cancellation and write fencing with the authenticated actor to the existing command handler.
   * Failure cases:
   * - Missing runs reject; transport cancellation errors remain visible while the publication fence stays closed.
   * Side effects:
   * - Updates cancellation state and signals the existing runtime; no other selected items change.
   */
  async cancel(runId: string, actorId: string, cid: string) {
    const result = await this.prisma.preparationRuleResult.findUnique({
      where: { preparationRunId: runId },
    });
    if (!result) catalogFailure(E.NOT_FOUND, cid, 404);
    // Why: The shared cancellation handler writes the supplied actor into the audit event.
    // How: Forward only the authenticated controller actor, not a fixed system identity.
    // Invariant: The selected-rule route and direct Admin route attribute the same human action consistently.
    await this.commands.execute(
      new CancelRuleSetPreparationCommand(runId, cid, actorId),
    );
    return { preparationRunId: runId };
  }
}
