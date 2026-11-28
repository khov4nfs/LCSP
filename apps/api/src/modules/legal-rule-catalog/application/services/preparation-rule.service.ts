import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
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
  LEGAL_RULE_PREPARATION_STATES as S,
  LEGAL_RULE_SELECTION_MODES,
  ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS,
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
  legalRuleActivationResultSchema,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  preparationInstructionReceiptSchema,
  type PreparationRuleInput,
  type PreparationRuleComplete,
  // Shared contracts type activation, output collection, and rule validation.
  type LegalRuleActivationRequest,
  type AssessmentRuleImportItem,
  type AssessmentRuleImportRequest,
  type AssessmentRuleImportResult,
  type PreparationRuleOutput,
  type PreparationRuleValidate,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  complianceRuleSetPacketSchema,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  declaresApplicabilityScope,
  PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
} from "@lcsp/contracts/compliance-rule-set";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../assessment/domain/domain-ids.js";
import {
  sourceClaimKey,
  validateAssessmentRuleBindings,
  validateComplianceRuleSetPacket,
} from "../../../compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
import {
  ComplianceRuleSetActivation,
  type SelectedActivationContext,
} from "../../../compliance-rule-set/infrastructure/persistence/compliance-rule-set-activation.service.js";
import { LegalSourceSnapshotLoader } from "../../../compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
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
    private readonly sourceSnapshot: LegalSourceSnapshotLoader,
    private readonly activation: ComplianceRuleSetActivation,
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
   * Business purpose: Publish an explicit set of current selected-rule Assessment Rules through the canonical ACTIVE Rule Set lifecycle.
   *
   * Business rules:
   * - Every requested result must be the current, successful, fingerprint-matching revision for an eligible catalog rule and contain at least one Assessment Rule.
   * - All selected results share the catalog's pinned Legal Source Version; each output and source reference passes selected-result and Rule Set integrity validation.
   * - Admin confirmation is explicit; activation never includes unselected results or reruns AI.
   *
   * Execution flow:
   * 1. Lock the catalog revision and verify selected result identities against current catalog entries.
   * 2. Lock selected PreparationRule artifacts, re-read freshness, hydrate exact source chunks, and validate each persisted output.
   * 3. Combine only the chosen LegalRequirements, AssessmentRules, and context relations; validate citations against the pinned source.
   * 4. Commit the selected-result manifest and packet through the shared atomic ACTIVE Rule Set publisher.
   *
   * Failure cases:
   * - Empty, duplicate, stale, failed, zero-rule, incompatible, or source-invalid selections return a typed request/result error without changing the current ACTIVE version.
   * - Transaction, audit, outbox, or persistence errors roll back publication and retain the current ACTIVE version.
   *
   * Side effects:
   * - Creates one ComplianceRuleSetVersion and activation audit/outbox record; selected Preparation results and Legal Sources are immutable and unchanged.
   */
  async activate(
    catalogId: string,
    request: LegalRuleActivationRequest,
    actor: string,
    cid: string,
  ) {
    const requested = [...request.results].sort((left, right) =>
      left.ruleId.localeCompare(right.ruleId),
    );
    const requestDigest = sha256Hex(
      canonicalJson({
        catalogId,
        expectedRevision: request.expectedRevision,
        results: requested,
      }),
    );

    return this.prisma.$transaction(
      async (tx) => {
        await this.catalogs.lock(tx, catalogId, request.expectedRevision, cid);
        const first = await this.catalogs.entries(tx, catalogId, cid);
        for (const selection of requested) {
          const item = first.items.find(
            (candidate) => candidate.id === selection.ruleId,
          );
          if (
            !item ||
            item.state !== S.PREPARED ||
            item.assessmentRuleCount === 0 ||
            item.lastResultId !== selection.resultId ||
            item.lastResultRevision !== selection.revision
          )
            catalogFailure(E.RESULT_INVALID, cid, 422);
        }
        const results = await tx.preparationRuleResult.findMany({
          where: { id: { in: requested.map((item) => item.resultId) } },
          include: { preparationRule: true, preparationRun: true },
        });
        if (results.length !== requested.length)
          catalogFailure(E.RESULT_INVALID, cid, 422);
        const artifacts = [
          ...new Set(results.map((result) => result.preparationRuleId)),
        ];
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "PreparationRule" WHERE "id" IN (${Prisma.join(artifacts)}) ORDER BY "id" FOR UPDATE`,
        );

        const current = await this.catalogs.entries(tx, catalogId, cid);
        const currentItems = new Map(
          current.items.map((item) => [item.id, item]),
        );
        const resultById = new Map(
          results.map((result) => [result.id, result]),
        );
        const inputs = [] as PreparationRuleInput[];
        const outputs: PreparationRuleOutput[] = [];
        const manifest: SelectedActivationContext["selectedPreparationResults"] =
          [];

        for (const selection of requested) {
          const item = currentItems.get(selection.ruleId);
          const result = resultById.get(selection.resultId);
          if (
            !item ||
            item.state !== S.PREPARED ||
            !item.input ||
            item.lastResultId !== selection.resultId ||
            item.lastResultRevision !== selection.revision ||
            item.assessmentRuleCount <= 0 ||
            !result ||
            result.revision !== selection.revision ||
            result.preparationRule.legalRuleId !== selection.ruleId ||
            result.preparationRun.executionState !== A.SUCCEEDED ||
            result.preparationRun.legalSourceVersionId !==
              first.catalog.legalSourceVersionId ||
            result.inputFingerprint !==
              preparationInputFingerprint(item.input) ||
            !result.output
          )
            catalogFailure(E.RESULT_INVALID, cid, 422);
          const input = preparationRuleInputSchema.parse(result.inputSnapshot);
          const output = preparationRuleOutputSchema.parse(result.output);
          if (
            input.ruleId !== selection.ruleId ||
            input.legalSourceVersionId !== first.catalog.legalSourceVersionId ||
            output.assessmentRules.length === 0
          )
            catalogFailure(E.RESULT_INVALID, cid, 422);
          validateSelectedOutput(input, output, cid);
          inputs.push(input);
          outputs.push(output);
          manifest.push({
            ruleId: selection.ruleId,
            resultId: result.id,
            revision: result.revision,
            inputFingerprint: result.inputFingerprint,
            outputDigest: sha256Hex(canonicalJson(output)),
          });
        }

        await this.catalogs.hydrate(tx, inputs, cid);
        const packet = complianceRuleSetPacketSchema.parse({
          legalRequirements: outputs.flatMap(
            (output) => output.legalRequirements,
          ),
          assessmentRules: outputs.flatMap((output) => output.assessmentRules),
          contextRelations: outputs.flatMap(
            (output) => output.contextRelations,
          ),
        });
        const source = await this.sourceSnapshot.loadSelected(
          tx,
          first.catalog.legalSourceVersionId,
          packet,
        );
        const validation = validateComplianceRuleSetPacket(
          packet,
          source.snapshot,
          (claim) =>
            source.foreignHashes.has(
              `${sourceClaimKey(claim)}|${claim.contentSha256}`,
            ),
          { requireSemanticGraph: false },
        );
        if (validation.failures.length || !packet.assessmentRules.length)
          catalogFailure(E.RESULT_INVALID, cid, 422);

        return legalRuleActivationResultSchema.parse(
          await this.activation.commitSelected(
            tx,
            {
              idempotencyKey: request.idempotencyKey,
              requestDigest,
              ruleSetDigest: sha256Hex(canonicalJson(packet)),
              packet,
              resolved: validation.resolved,
              legalSource: {
                id: first.catalog.legalSourceVersionId,
                version: first.catalog.legalSourceVersion.version,
              },
              selectedPreparationResults: manifest,
              correlationId: cid,
            },
            actor,
          ),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /**
   * Business purpose: Let an Admin load externally authored Assessment Rules for catalog Legal Rules as prepared results, without running the Preparation agent.
   *
   * Business rules:
   * - Only Admin callers reach this path; the document must name this catalog, its current revision and its pinned Legal Source Version.
   * - Every item must target an eligible catalog Legal Rule and pass the same selected-output validation as agent output: identities carry the rule prefix, and every citation exactly matches the pinned source (document, locator, content hash).
   * - An imported result is only a prepared revision; it becomes ACTIVE solely through the explicit activation step, and excluded items are validated against the catalog but never stored.
   * - An exclusion explicitly requiring legal review blocks the atomic import until resolved; a caller exclusion is never proof of legal scope eligibility.
   * - A rule with a queued or running Preparation run cannot be replaced; an identical prepared result is acknowledged as a replay without a new revision.
   *
   * Execution flow:
   * 1. Lock the catalog at the expected revision and verify the pinned source.
   * 2. Resolve each item and excluded item to catalog entries and hydrate the exact source content.
   * 3. Normalize every item into the selected-output contract and validate all of them before writing anything.
   * 4. In a dry run, report per rule the revision an import would record (or a replay) from reads alone and stop.
   * 5. Otherwise, for each item, lock its PreparationRule, skip an identical current result, otherwise record the next revision under one import selection and batch with a SUCCEEDED run.
   * 6. Audit each recorded revision and return per-rule acknowledgements with the validated exclusions.
   *
   * Failure cases:
   * - Mismatched catalog or source returns request-invalid or stale; unknown or ineligible rules are rejected; invalid output returns RESULT_INVALID with a safe field path; active runs return CONFLICT.
   * - Any failure rolls back the whole import, leaving previous results and the ACTIVE Rule Set unchanged.
   *
   * Side effects:
   * - A dry run writes nothing. Otherwise creates one selection, one batch and per-rule SUCCEEDED run/result revisions plus audit events in one transaction; enqueues no outbox work and starts no model run.
   */
  async importAssessmentRules(
    catalogId: string,
    request: AssessmentRuleImportRequest,
    actor: string,
    cid: string,
  ): Promise<AssessmentRuleImportResult> {
    if (request.catalogVersionId !== catalogId)
      catalogFailure(E.INVALID, cid, 422);
    return this.prisma.$transaction(
      async (tx) => {
        await this.catalogs.lock(
          tx,
          catalogId,
          request.expectedCatalogRevision,
          cid,
        );
        const { catalog, items } = await this.catalogs.entries(
          tx,
          catalogId,
          cid,
        );
        if (catalog.legalSourceVersionId !== request.legalSourceVersionId)
          catalogFailure(E.STALE, cid);
        const entries = new Map(items.map((entry) => [entry.id, entry]));
        if (request.excludedItems.some((item) => !entries.has(item.ruleId)))
          catalogFailure(E.INVALID, cid, 422);
        // An acknowledged unresolved proposition cannot be silently excluded to make a document pass.
        // This rejects known ambiguity only; it is not positive semantic scope authorization.
        const reviewRequiredIndex = request.excludedItems.findIndex(
          (item) =>
            item.reasonCode ===
            ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS.NEEDS_REVIEW,
        );
        if (reviewRequiredIndex !== -1)
          rejectSelectedOutput(
            cid,
            `excludedItems.${reviewRequiredIndex}.reasonCode`,
            E.SCOPE_REVIEW_REQUIRED,
          );
        const selected = request.items.map((item) => {
          const entry = entries.get(item.ruleId);
          if (!entry) catalogFailure(E.NOT_FOUND, cid, 404);
          if (!entry.input) catalogFailure(E.INELIGIBLE, cid);
          return { item, input: entry.input };
        });
        const hydrated = selected.length
          ? await this.catalogs.hydrate(
              tx,
              selected.map((entry) => entry.input),
              cid,
            )
          : [];
        // Validate every item before the first write so a bad item cannot leave a partial import.
        const prepared = selected.map(({ item }, index) => {
          const output = normalizeImportItem(item, index, cid);
          validateSelectedOutput(hydrated[index], output, cid);
          return { input: hydrated[index], output };
        });

        if (request.dryRun) {
          // Preview only: report what an import would record, using reads alone.
          const preview: AssessmentRuleImportResult["imported"] = [];
          for (const { input, output } of prepared) {
            const artifact = await tx.preparationRule.findUnique({
              where: { legalRuleId: input.ruleId },
            });
            const last = artifact
              ? await tx.preparationRuleResult.findFirst({
                  where: { preparationRuleId: artifact.id },
                  orderBy: { revision: "desc" },
                  include: { preparationRun: true },
                })
              : null;
            if (
              last?.preparationRun.executionState === A.QUEUED ||
              last?.preparationRun.executionState === A.RUNNING
            )
              catalogFailure(E.CONFLICT, cid);
            const replayed =
              last !== null &&
              isIdenticalCurrentResult(
                last,
                preparationInputFingerprint(input),
                output,
              );
            preview.push({
              ruleId: input.ruleId,
              resultId: null,
              revision:
                last && replayed ? last.revision : (last?.revision ?? 0) + 1,
              assessmentRuleCount: output.assessmentRules.length,
              replayed,
            });
          }
          return {
            catalogVersionId: catalog.id,
            catalogRevision: catalog.revision,
            legalSourceVersionId: catalog.legalSourceVersionId,
            dryRun: true,
            imported: preview,
            excludedItems: request.excludedItems,
          };
        }

        const imported: AssessmentRuleImportResult["imported"] = [];
        let batchId: string | null = null;
        for (const { input, output } of prepared) {
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
          const fingerprint = preparationInputFingerprint(input);
          if (
            last?.preparationRun.executionState === A.QUEUED ||
            last?.preparationRun.executionState === A.RUNNING
          )
            catalogFailure(E.CONFLICT, cid);
          if (last && isIdenticalCurrentResult(last, fingerprint, output)) {
            imported.push({
              ruleId: input.ruleId,
              resultId: last.id,
              revision: last.revision,
              assessmentRuleCount: output.assessmentRules.length,
              replayed: true,
            });
            continue;
          }
          if (!batchId) {
            const pending = prepared.map((entry) => entry.input);
            const selection = await tx.preparationRuleSelection.create({
              data: {
                catalogVersionId: catalog.id,
                catalogRevision: catalog.revision,
                createdBy: actor,
                scope: {
                  catalogVersionId: catalog.id,
                  expectedRevision: catalog.revision,
                  mode: LEGAL_RULE_SELECTION_MODES.EXPLICIT,
                  filters: { search: "" },
                  ruleIds: pending.map((entry) => entry.ruleId),
                },
                inputs: pending,
                fingerprint: sha256Hex(
                  canonicalJson(pending.map(preparationInputFingerprint)),
                ),
              },
            });
            const batch = await tx.preparationRuleBatch.create({
              data: {
                selectionId: selection.id,
                requestedBy: actor,
                idempotencyKey: `import:${randomUUID()}`,
                requestHash: sha256Hex(canonicalJson(request)),
              },
            });
            batchId = batch.id;
          }
          const revision = (last?.revision ?? 0) + 1;
          const now = new Date();
          const run = await tx.ruleSetPreparationRun.create({
            data: {
              idempotencyKey: `imported-rule:${artifact.id}:${revision}`,
              executionContract: PreparationExecutionContract.SELECTED_RULE_V1,
              legalSourceVersionId: input.legalSourceVersionId,
              requestedBy: actor,
              correlationId: randomUUID(),
              executionState: A.SUCCEEDED,
              startedAt: now,
              completedAt: now,
            },
          });
          const result = await tx.preparationRuleResult.create({
            data: {
              preparationRuleId: artifact.id,
              batchId,
              preparationRunId: run.id,
              revision,
              inputSnapshot: input,
              inputFingerprint: fingerprint,
              output,
            },
          });
          await this.catalogs.record(
            tx,
            EVENTS.RESULT_IMPORTED,
            result.id,
            actor,
            cid,
            {
              preparationRunId: run.id,
              inputFingerprint: fingerprint,
              outputDigest: sha256Hex(canonicalJson(output)),
              revision,
            },
          );
          imported.push({
            ruleId: input.ruleId,
            resultId: result.id,
            revision,
            assessmentRuleCount: output.assessmentRules.length,
            replayed: false,
          });
        }
        if (batchId)
          await tx.preparationRuleBatch.update({
            where: { id: batchId },
            data: {
              items: imported
                .filter((entry) => !entry.replayed)
                .map((entry) => ({
                  ruleId: entry.ruleId,
                  resultId: entry.resultId,
                  skipped: false,
                })),
            },
          });
        return {
          catalogVersionId: catalog.id,
          catalogRevision: catalog.revision,
          legalSourceVersionId: catalog.legalSourceVersionId,
          dryRun: false,
          imported,
          excludedItems: request.excludedItems,
        };
      },
      { timeout: 60000 },
    );
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
    validateSelectedOutput(
      preparationRuleInputSchema.parse(result.inputSnapshot),
      request.output,
      cid,
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
        validateSelectedOutput(
          preparationRuleInputSchema.parse(result.inputSnapshot),
          request.output,
          cid,
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
 * Business purpose: Identify the structural field that prevented a selected result from being recorded.
 * Business rules:
 * - Report only schema field paths supplied by the validation code; authored data and citation values stay private.
 * Execution flow:
 * 1. Return the catalog result rejection with the field path and request correlation.
 * Failure cases:
 * - Always rejects settlement with HTTP 422 so the worker can record a failed attempt.
 * Side effects:
 * - Throws a typed problem without changing run state.
 */
function rejectSelectedOutput(
  cid: string,
  issues: string,
  code:
    typeof E.RESULT_INVALID | typeof E.SCOPE_REVIEW_REQUIRED = E.RESULT_INVALID,
): never {
  throw problemException(code, cid, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    meta: { issues },
  });
}

/**
 * Business purpose: Turn one externally authored import item into the same selected-rule output an agent would have produced.
 * Business rules:
 * - Investigation hints the import does not carry are stored empty; server-derived prose is never supplied by the author.
 * - The shared selected-output contract decides validity; the import adds no legal interpretation.
 * Execution flow:
 * 1. Fill the fixed analysis note and empty investigation hints.
 * 2. Parse through the shared output contract, which derives intent, guidance and context relations.
 * Failure cases:
 * - A contract violation is rejected as RESULT_INVALID with the item index and structural field path only; authored values are never echoed.
 * Side effects:
 * - Pure normalization; nothing is persisted.
 */
export function normalizeImportItem(
  item: AssessmentRuleImportItem,
  index: number,
  cid: string,
): PreparationRuleOutput {
  const parsed = preparationRuleOutputSchema.safeParse({
    analysis: item.analysis ?? ASSESSMENT_RULE_IMPORT_DEFAULT_ANALYSIS,
    legalRequirements: item.legalRequirements,
    contextRelations: item.contextRelations,
    assessmentRules: item.assessmentRules.map((rule) => ({
      investigationGoals: [],
      startingNodeTypes: [],
      targetNodeTypes: [],
      edgeStrategies: [],
      graphQueries: [],
      keywords: [],
      commonApis: [],
      commonLibraries: [],
      patterns: [],
      supportingEvidence: [],
      negativeEvidence: [],
      ...rule,
    })),
  });
  if (!parsed.success)
    rejectSelectedOutput(
      cid,
      `items.${index}.${parsed.error.issues[0]?.path.join(".") ?? "output"}`,
    );
  return parsed.data;
}

/**
 * Business purpose: Recognize an import that would only repeat the rule's current prepared result, so re-running an import never creates noise revisions.
 * Business rules:
 * - Only a SUCCEEDED current result built from the same pinned input and carrying exactly the same output counts as identical.
 * Execution flow:
 * 1. Compare the current result's input fingerprint and run state.
 * 2. Compare the canonical form of its stored output with the incoming output.
 * Failure cases:
 * - No current result, a different input, a non-succeeded run or different output is not identical.
 * Side effects:
 * - Pure comparison; nothing is persisted.
 */
function isIdenticalCurrentResult(
  last: {
    inputFingerprint: string;
    output: Prisma.JsonValue | null;
    preparationRun: { executionState: A };
  },
  fingerprint: string,
  output: PreparationRuleOutput,
): boolean {
  return Boolean(
    last.inputFingerprint === fingerprint &&
    last.preparationRun.executionState === A.SUCCEEDED &&
    last.output &&
    canonicalJson(last.output) === canonicalJson(output),
  );
}

/**
 * Business purpose: Validate selected preparation structure and provenance without deciding legal applicability.
 * Business rules:
 * - References stay within pinned chunks; AssessmentRule parents must be present, assessable and uniquely identified.
 * - Explicit unresolved legal scope blocks validation, import and selected activation; absence of the signal is not semantic approval.
 * - Only failure settlement may retain an unresolved draft, after validating its complete structure and provenance.
 * Execution flow:
 * 1. Parse canonical downstream contracts
 * 2. Verify unique identities, source allowlist and parent links.
 * Failure cases:
 * - Invalid structure, duplicates, foreign sources or missing/non-assessable parents return RESULT_INVALID with a safe field path.
 * Side effects:
 * - Pure validation; no semantic decision, publication or model work.
 */
export function validateSelectedOutput(
  input: PreparationRuleInput,
  output: z.infer<typeof preparationRuleOutputSchema>,
  cid: string,
  retainUnresolvedDraft = false,
): void {
  const parsed = preparationRuleOutputSchema.safeParse(output);
  if (!parsed.success) rejectSelectedOutput(cid, "output");
  // Check ambiguity before other structural defects can route the draft into repair.
  const unresolvedIndex = output.legalRequirements.findIndex((rule) =>
    rule.coverage.nonAssessableReason?.startsWith(
      PREPARATION_SCOPE_REVIEW_REQUIRED_REASON_PREFIX,
    ),
  );
  if (unresolvedIndex !== -1 && !retainUnresolvedDraft)
    rejectSelectedOutput(
      cid,
      `output.legalRequirements.${unresolvedIndex}.coverage.nonAssessableReason`,
      E.SCOPE_REVIEW_REQUIRED,
    );
  if (retainUnresolvedDraft && unresolvedIndex === -1)
    rejectSelectedOutput(cid, "output.legalRequirements");
  const requirements = new Map(
    output.legalRequirements.map((rule) => [rule.legalRequirementId, rule]),
  );
  const assessmentIds = new Set(
    output.assessmentRules.map((rule) => rule.assessmentRuleId),
  );
  const relationIds = new Set(
    output.contextRelations.map((edge) => edge.relationId),
  );
  if (requirements.size !== output.legalRequirements.length)
    rejectSelectedOutput(cid, "output.legalRequirements.legalRequirementId");
  if (assessmentIds.size !== output.assessmentRules.length)
    rejectSelectedOutput(cid, "output.assessmentRules.assessmentRuleId");
  if (relationIds.size !== output.contextRelations.length)
    rejectSelectedOutput(cid, "output.contextRelations.relationId");
  const allowed = new Set(
    input.citations.map((ref) =>
      canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
    ),
  );
  const prefix = `${input.ruleId}:`;
  for (const [index, rule] of output.legalRequirements.entries()) {
    const path = `output.legalRequirements.${index}`;
    if (!rule.legalRequirementId.startsWith(prefix))
      rejectSelectedOutput(cid, `${path}.legalRequirementId`);
    if (!rule.operativePropositions?.length)
      rejectSelectedOutput(cid, `${path}.operativePropositions`);
    if (
      !declaresApplicabilityScope(
        rule.coverage.state,
        rule.applicabilityConditions,
        rule.applicabilityMode,
      )
    )
      rejectSelectedOutput(
        cid,
        `${path}.applicabilityConditions,${path}.applicabilityMode`,
      );
    const own = new Set(rule.sourceRefs.map((ref) => canonicalJson(ref)));
    if (
      rule.operativePropositions.some((proposition) =>
        proposition.sourceRefs.some((ref) => !own.has(canonicalJson(ref))),
      )
    )
      rejectSelectedOutput(cid, `${path}.operativePropositions.sourceRefs`);
  }
  for (const collection of ["legalRequirements", "assessmentRules"] as const) {
    for (const [index, rule] of output[collection].entries()) {
      if (
        !rule.sourceRefs.length ||
        rule.sourceRefs.some(
          (ref) =>
            !allowed.has(
              canonicalJson([ref.documentId, ref.locator, ref.contentSha256]),
            ),
        )
      )
        rejectSelectedOutput(cid, `output.${collection}.${index}.sourceRefs`);
    }
  }
  for (const [index, edge] of output.contextRelations.entries()) {
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
      rejectSelectedOutput(cid, `output.contextRelations.${index}`);
  }
  for (const [index, rule] of output.assessmentRules.entries()) {
    const path = `output.assessmentRules.${index}`;
    if (!rule.assessmentRuleId.startsWith(prefix))
      rejectSelectedOutput(cid, `${path}.assessmentRuleId`);
    if (
      rule.legalRequirementIds.some(
        (id) =>
          !requirements.has(id) ||
          requirements.get(id)!.coverage.state ===
            LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      )
    )
      rejectSelectedOutput(cid, `${path}.legalRequirementIds`);
  }
  if (validateAssessmentRuleBindings(output).length)
    rejectSelectedOutput(cid, "output.assessmentRules");
}
