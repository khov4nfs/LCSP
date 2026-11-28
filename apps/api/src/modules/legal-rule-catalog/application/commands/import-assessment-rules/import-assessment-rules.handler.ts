import { RULE_SET_PREPARATION_UNRESOLVED_STATES } from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_RULE_IMPORT_EXCLUSION_REASONS,
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_CATALOG_EVENTS as EVENTS,
  LEGAL_RULE_SELECTION_MODES,
  type AssessmentRuleImportResult,
} from "@lcsp/contracts/legal-rule-catalog";
import { Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as A,
  PreparationExecutionContract,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../../assessment/domain/domain-ids.js";
import {
  requireSelectedExclusionAuthorization,
  requireSelectedScopeAuthorization,
} from "../../../../compliance-rule-set/infrastructure/persistence/selected-scope-authority.js";
import { LegalSourceAuthorityService } from "../../../../legal-source/application/services/legal-source-authority.service.js";
import {
  catalogFailure,
  preparationInputFingerprint,
} from "../../services/legal-rule-catalog-shared.js";
import { LegalRuleCatalogService } from "../../services/legal-rule-catalog.service.js";
import {
  isIdenticalCurrentResult,
  normalizeImportItem,
  rejectSelectedOutput,
  validateSelectedOutput,
} from "../../services/selected-output-validation.js";
import { ImportAssessmentRulesCommand } from "./import-assessment-rules.command.js";

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
    private readonly authority: LegalSourceAuthorityService = new LegalSourceAuthorityService(),
  ) {}
  /**
   * Business purpose: Let an Admin load externally authored Assessment Rules for catalog Legal Rules as prepared results, without running the Preparation agent.
   *
   * Business rules:
   * - Only Admin callers reach this path; the document must name this catalog, its current revision and its pinned Legal Source Version.
   * - Every item must target an eligible catalog Legal Rule and pass the same selected-output validation as agent output: identities carry the rule prefix, and every citation exactly matches the pinned source (document, locator, content hash).
   * - An imported result is only a prepared revision; it becomes ACTIVE solely through the explicit activation step, and declared exclusions receive a source-pinned audit receipt.
   * - Exact semantic approval is required for every import item, including dry runs. Unresolved or contradictory exclusions reject.
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
        // An exclusion cannot contradict an imported item or another decision.
        const importedIds = new Set(request.items.map((item) => item.ruleId));
        const excludedIds = new Set(
          request.excludedItems.map((item) => item.ruleId),
        );
        if (
          excludedIds.size !== request.excludedItems.length ||
          request.excludedItems.some((item) => importedIds.has(item.ruleId))
        )
          catalogFailure(E.INVALID, cid, 422);
        // Bind every exclusion to the same eligible, content-verified source
        // snapshot as an included rule. The client reason is not legal approval.
        const excludedInputs = request.excludedItems.map((item) => {
          const input = entries.get(item.ruleId)?.input;
          if (!input) catalogFailure(E.INELIGIBLE, cid);
          return input;
        });
        const hydratedExclusions = excludedInputs.length
          ? await this.catalogs.hydrate(tx, excludedInputs, cid)
          : [];
        // Every excluded rule must also have positive semantic approval (e.g. NON_DEVELOPMENT)
        // in SelectedRuleScopeAuthorization before dry-run or persistence.
        const exclusionScopeKeys: string[] = [];
        for (const [index, excluded] of request.excludedItems.entries()) {
          const scopeKey = await requireSelectedExclusionAuthorization(
            tx,
            hydratedExclusions[index],
            excluded.reasonCode,
            cid,
            this.authority,
          );
          exclusionScopeKeys.push(scopeKey);
        }
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

        // Validate semantic approval before the first write in both dry run and import.
        // Why: JSON Import is model-free, so unreviewed imported rules must never be treated as legally verified.
        for (const { input, output } of prepared)
          await requireSelectedScopeAuthorization(
            tx,
            input,
            output,
            cid,
            this.authority,
            { requireReviewedAuthorization: true },
          );
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
        // Keep an idempotent receipt even for exclusion-only or replay-only
        // imports. Do not manufacture a prepared revision or dispatch a model.
        if (hydratedExclusions.length) {
          const exclusions = request.excludedItems.map((item, index) => {
            const input = hydratedExclusions[index];
            return {
              ...item,
              scopeAuthorizationKey: exclusionScopeKeys[index],
              legalRuleId: input.legalRuleId,
              inputFingerprint: preparationInputFingerprint(input),
              indexId: input.indexId,
              indexContentDigest: input.indexContentHash,
              citations: input.citations.map(
                ({ chunkId, documentId, locator, contentSha256 }) => ({
                  chunkId,
                  documentId,
                  locator,
                  contentSha256,
                }),
              ),
            };
          });
          const receipt = {
            catalogVersionId: catalog.id,
            catalogRevision: catalog.revision,
            legalSourceVersionId: catalog.legalSourceVersionId,
            exclusions,
            imported: imported.map(({ ruleId, resultId, revision }) => ({
              ruleId,
              resultId,
              revision,
            })),
          };
          const receiptDigest = sha256Hex(canonicalJson(receipt));
          await this.catalogs.record(
            tx,
            EVENTS.IMPORT_EXCLUSIONS_RECORDED,
            catalog.id,
            actor,
            cid,
            { ...receipt, receiptDigest },
            `${EVENTS.IMPORT_EXCLUSIONS_RECORDED}:${actor}:${receiptDigest}`,
          );
        }
        return {
          catalogVersionId: catalog.id,
          catalogRevision: catalog.revision,
          legalSourceVersionId: catalog.legalSourceVersionId,
          dryRun: false,
          imported,
          excludedItems: request.excludedItems,
        };
      },
      // Why: Interactive imports should not monopolize a connection for a full minute.
      // How: The shared 100-item contract bounds work; a 20-second transaction ceiling releases the pool on slow imports.
      // Invariant: Timeout rolls back every import revision and audit write together.
      { timeout: 20000 },
    );
  }
}
