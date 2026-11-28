import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  Prisma,
  AgentExecutionState as A,
  PreparationExecutionContract,
} from "@prisma/client";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_CATALOG_EVENTS as EVENTS,
  LEGAL_RULE_SELECTION_MODES,
  type AssessmentRuleImportResult,
} from "@lcsp/contracts/legal-rule-catalog";
import { RULE_SET_PREPARATION_UNRESOLVED_STATES } from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../../assessment/domain/domain-ids.js";
import { LegalRuleCatalogService } from "../../services/legal-rule-catalog.service.js";
import { ImportAssessmentRulesCommand } from "./import-assessment-rules.command.js";
import {
  isIdenticalCurrentResult,
  normalizeImportItem,
  validateSelectedOutput,
} from "../../services/selected-output-validation.js";
import {
  catalogFailure,
  preparationInputFingerprint,
} from "../../services/legal-rule-catalog-shared.js";

// Why: Import writes a full preparation revision and must remain atomic across all selected rules.
// How: This handler validates before writing and locks artifacts in stable order inside one transaction.
// Invariant: Dry runs are read-only, and imported results never publish an active Rule Set.
@Injectable()
@CommandHandler(ImportAssessmentRulesCommand)
export class ImportAssessmentRulesHandler implements ICommandHandler<ImportAssessmentRulesCommand> {
  private readonly unresolvedPreparationStates = new Set<string>(
    RULE_SET_PREPARATION_UNRESOLVED_STATES,
  );
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: LegalRuleCatalogService,
  ) {}
  /**
   * Business purpose: Let an Admin load externally authored Assessment Rules for catalog Legal Rules as prepared results, without running the Preparation agent.
   *
   * Business rules:
   * - Only Admin callers reach this path; the document must name this catalog, its current revision and its pinned Legal Source Version.
   * - Every item must target an eligible catalog Legal Rule and pass the same selected-output validation as agent output: identities carry the rule prefix, and every citation exactly matches the pinned source (document, locator, content hash).
   * - An imported result is only a prepared revision; it becomes ACTIVE solely through the explicit activation step, and excluded items are validated against the catalog but never stored.
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
  async execute(
    command: ImportAssessmentRulesCommand,
  ): Promise<AssessmentRuleImportResult> {
    const { catalogId, request, actor, correlationId: cid } = command;
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
              last &&
              this.unresolvedPreparationStates.has(
                last.preparationRun.executionState,
              )
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

        // Why: Prevent deadlocks during bulk import by sorting and locking all PreparationRule rows upfront in canonical ID order.
        // How: Upsert preparation rule artifacts, sort their IDs alphabetically, and lock via a single ordered SELECT ... FOR UPDATE.
        // Invariant: Row lock ordering is strictly deterministic regardless of the order of items in the import payload.
        const importArtifactMap = new Map<string, { id: string }>();
        for (const { input } of prepared) {
          const artifact = await tx.preparationRule.upsert({
            where: { legalRuleId: input.ruleId },
            create: { legalRuleId: input.ruleId },
            update: {},
          });
          importArtifactMap.set(input.ruleId, artifact);
        }
        const sortedImportArtifactIds = [
          ...new Set([...importArtifactMap.values()].map((a) => a.id)),
        ].sort();
        if (sortedImportArtifactIds.length > 0) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "PreparationRule" WHERE "id" IN (${Prisma.join(sortedImportArtifactIds)}) ORDER BY "id" FOR UPDATE`,
          );
        }

        const imported: AssessmentRuleImportResult["imported"] = [];
        let batchId: string | null = null;
        for (const { input, output } of prepared) {
          const artifact = importArtifactMap.get(input.ruleId)!;
          const last = await tx.preparationRuleResult.findFirst({
            where: { preparationRuleId: artifact.id },
            orderBy: { revision: "desc" },
            include: { preparationRun: true },
          });
          const fingerprint = preparationInputFingerprint(input);
          if (
            last &&
            this.unresolvedPreparationStates.has(
              last.preparationRun.executionState,
            )
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
}
