import { Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma, AgentExecutionState as A } from "@prisma/client";
import {
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_PREPARATION_STATES as S,
  legalRuleActivationResultSchema,
  preparationRuleInputSchema,
  preparationRuleOutputSchema,
  type PreparationRuleInput,
  type PreparationRuleOutput,
  type LegalRuleActivationResult,
} from "@lcsp/contracts/legal-rule-catalog";
import { complianceRuleSetPacketSchema } from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../../assessment/domain/domain-ids.js";
import {
  sourceClaimKey,
  validateComplianceRuleSetPacket,
} from "../../../../compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
import {
  ComplianceRuleSetActivation,
  type SelectedActivationContext,
} from "../../../../compliance-rule-set/infrastructure/persistence/compliance-rule-set-activation.service.js";
import { LegalSourceSnapshotLoader } from "../../../../compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { LegalSourceAuthorityService } from "../../../../legal-source/application/services/legal-source-authority.service.js";
import { requireSelectedScopeAuthorization } from "../../../../compliance-rule-set/infrastructure/persistence/selected-scope-authority.js";
import { LegalRuleCatalogService } from "../../services/legal-rule-catalog.service.js";
import { validateSelectedOutput } from "../../services/selected-output-validation.js";
import { ActivatePreparedRulesCommand } from "./activate-prepared-rules.command.js";
import {
  catalogFailure,
  preparationInputFingerprint,
} from "../../services/legal-rule-catalog-shared.js";

// Why: Publication must own its complete validation and transaction boundary outside the preparation orchestration service.
// How: The compatibility service delegates one request to this handler while preserving the existing catalog and source pins.
// Invariant: Only the explicit selected results can become the active Rule Set.
@Injectable()
@CommandHandler(ActivatePreparedRulesCommand)
export class ActivatePreparedRulesHandler implements ICommandHandler<ActivatePreparedRulesCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: LegalRuleCatalogService,
    private readonly sourceSnapshot: LegalSourceSnapshotLoader,
    private readonly activation: ComplianceRuleSetActivation,
    private readonly authority: LegalSourceAuthorityService = new LegalSourceAuthorityService(),
  ) {}
  /**
   * Business purpose: Publish an explicit set of current selected-rule Assessment Rules through the canonical ACTIVE Rule Set lifecycle.
   *
   * Business rules:
   * - Every requested result must be the current, successful, fingerprint-matching revision for an eligible catalog rule and contain at least one Assessment Rule.
   * - All selected results share the catalog's pinned Legal Source Version; each output and source reference passes selected-result and Rule Set integrity validation.
   * - Every included output must still match independently reviewed semantic authority.
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
  async execute(
    command: ActivatePreparedRulesCommand,
  ): Promise<LegalRuleActivationResult> {
    const { catalogId, request, actor, correlationId: cid } = command;
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
            preparationInputFingerprint(input) !== result.inputFingerprint ||
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

        // Revalidate each publication against the reviewed material rule content and pinned source.
        const hydrated = await this.catalogs.hydrate(tx, inputs, cid);
        for (const [index, input] of hydrated.entries()) {
          manifest[index].scopeAuthorizationKey =
            await requireSelectedScopeAuthorization(
              tx,
              input,
              outputs[index],
              cid,
              this.authority,
            );
        }
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
}
