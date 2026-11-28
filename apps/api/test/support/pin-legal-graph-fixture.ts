import { completeFixtureFrontier } from "./complete-fixture-frontier.js";
import {
  inventoryFingerprint,
  inventoryHash,
} from "../../src/modules/compliance-rule-set/domain/claim-inventory.js";
import { sourceReviewUnits } from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";
import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
import { ClaimInventoryHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js";
import { ClaimInventoryCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.command.js";
import { ValidateComplianceRuleSetHandler } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { ValidateComplianceRuleSetCommand } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.command.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { canonicalInventoryFixture } from "./canonical-claim-inventory-fixture.js";
import {
  complianceRuleSetPacketSchema,
  ruleSetPreparationAuthoringDraftSchema,
  CLAIM_INVENTORY_ACTIONS as A,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
} from "@lcsp/contracts/compliance-rule-set";
import {
  AgentExecutionState,
  ClaimPreparationPhase,
  PreparationExecutionContract,
} from "@prisma/client";
import { fixtureLegalSource } from "./compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import type { PrismaClient } from "@prisma/client";
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";
import { PreparationScopeReviewService } from "../../src/modules/compliance-rule-set/infrastructure/persistence/preparation-scope-review.service.js";
import { ResumeRuleSetPreparationHandler } from "../../src/modules/compliance-rule-set/application/commands/resume-rule-set-preparation/resume-rule-set-preparation.handler.js";
import { ResumeRuleSetPreparationCommand } from "../../src/modules/compliance-rule-set/application/commands/resume-rule-set-preparation/resume-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { OutboxRepository } from "../../src/platform/outbox/outbox.repository.js";
import { fixtureSourceAuthority } from "./fixture-source-authority.js";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_EXECUTION_CONTRACTS,
  PREPARATION_SCOPE_STAGES,
} from "@lcsp/contracts/compliance-rule-set";

/** Only translates the reusable synthetic fixture's node identities into its real DB source pin. */
export async function pinFixtureRequest<T>(
  prisma: PrismaClient,
  body: T,
): Promise<T> {
  if (!body || typeof body !== "object") return body;
  const request = body as {
    preparationRunId?: string;
    packet?: ComplianceRuleSetPacket;
  };
  const fixture = fixtureLegalSource();
  if (
    request.packet?.semanticGraph?.legalSourceVersionId !==
      fixture.legalSourceVersionId ||
    !request.preparationRunId
  )
    return body;
  const run = await prisma.ruleSetPreparationRun.findUnique({
    where: { id: request.preparationRunId },
  });
  if (!run) return body;
  const graph = await new LegalDocumentGraphService(
    prisma as PrismaService,
  ).export(run.legalSourceVersionId);
  if (!graph) return body;
  const paths = new Map(
    fixture.documentGraph!.nodes.map((n) => [n.nodeId, n.structuralPath]),
  );
  const targets = new Map(graph.nodes.map((n) => [n.structuralPath, n.nodeId]));
  const id = (nodeId: string) => targets.get(paths.get(nodeId) ?? "") ?? nodeId;
  const packet = structuredClone(request.packet);
  if (run.scopeReviewRequested) {
    // The fixture labels its external-only duty explicitly before freezing the canonical packet.
    const externalDuty = packet.legalRequirements.find(
      (requirement) =>
        requirement.legalRequirementId === "LR-PERSON" &&
        requirement.coverage.state ===
          LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
    );
    if (externalDuty) {
      externalDuty.coverage.nonAssessableReason =
        "OUT_OF_SCOPE_TARGET: Synthetic duty is fulfilled outside development.";
    }
  }
  const semantic = packet.semanticGraph!;
  semantic.legalSourceVersionId = graph.legalSourceVersionId;
  semantic.materializationId = graph.materializationId;
  if (run.targetDate)
    semantic.targetDate = run.targetDate.toISOString().slice(0, 10);
  for (const claim of semantic.claims) {
    claim.legalSourceVersionId = graph.legalSourceVersionId;
    claim.sourceNodeIds = claim.sourceNodeIds.map(id);
    if (claim.sourceSupport)
      claim.sourceSupport = claim.sourceSupport.map((s) => ({
        ...s,
        nodeId: id(s.nodeId),
      }));
  }
  for (const inspected of semantic.sourceAccounting)
    inspected.sourceNodeId = id(inspected.sourceNodeId);
  const { graph: inventory, identities } = canonicalInventoryFixture(
    packet,
    run.id,
    run.claimInventoryRevision,
  );
  const candidate = complianceRuleSetPacketSchema.safeParse(packet);
  if (!candidate.success) return { ...body, packet };
  const frozen = await prisma.ruleSetPreparationClaimInventory.findUnique({
    where: {
      preparationRunId_revision: {
        preparationRunId: run.id,
        revision: run.claimInventoryRevision,
      },
    },
  });
  if (frozen) {
    packet.semanticGraph!.reviewFrontier = (
      frozen.graph as unknown as NonNullable<
        ComplianceRuleSetPacket["semanticGraph"]
      >
    ).reviewFrontier;
    const units = new Set(sourceReviewUnits(graph).map((n) => n.nodeId));
    packet.semanticGraph!.sourceAccounting =
      packet.semanticGraph!.sourceAccounting.filter((r) =>
        units.has(r.sourceNodeId),
      );
    packet.claimInventory = {
      revision: run.claimInventoryRevision,
      fingerprint: inventoryFingerprint(
        run.claimInventoryRevision,
        packet.semanticGraph!,
      ),
    };
  }
  if (run.executionState === AgentExecutionState.RUNNING) {
    // Submit fixtures traverse the real freeze, scope review, and readiness boundaries.
    const service = prisma as PrismaService;
    const loader = new LegalSourceSnapshotLoader(
      service,
      new LegalDocumentGraphService(service),
    );
    const handler = new ClaimInventoryHandler(service, loader);
    if (!frozen) {
      const reviewed = await completeFixtureFrontier(
        service,
        run.id,
        run.claimInventoryRevision,
        graph,
        inventory,
        identities,
        run.executionContract === PreparationExecutionContract.DIRECT_DRAFT_V1
          ? {
              legalRequirements: Object.fromEntries(
                packet.legalRequirements.map((item) => [
                  item.legalRequirementId,
                  item,
                ]),
              ),
              assessmentRules: Object.fromEntries(
                packet.assessmentRules.map((item) => [
                  item.assessmentRuleId,
                  item,
                ]),
              ),
              contextRelations: Object.fromEntries(
                packet.contextRelations.map((item) => [item.relationId, item]),
              ),
            }
          : undefined,
      );
      packet.semanticGraph = inventory;
      packet.claimInventory = {
        revision: run.claimInventoryRevision,
        fingerprint: inventoryFingerprint(
          run.claimInventoryRevision,
          inventory,
        ),
      };
      const result =
        reviewed.outcome === O.PASSED
          ? await handler.execute(
              new ClaimInventoryCommand(
                {
                  preparationRunId: run.id,
                  action: A.FINALIZE,
                  revision: run.claimInventoryRevision,
                  graph: inventory,
                  identities,
                },
                "fixture-finalize",
              ),
            )
          : reviewed;
      if (result.outcome === O.PASSED) {
        if (result.scopeReviewHold) {
          const [development, nonDevelopment] = PREPARATION_SCOPE_STAGES;
          const scope = new PreparationScopeReviewService(service);
          const paths = new Map(
            graph.nodes.map((node) => [node.nodeId, node.structuralPath]),
          );
          const decisions = inventory.claims
            .filter(
              (claim) =>
                claim.state === "RELEVANT" &&
                claim.semanticAuthority === "LEGAL_NORMATIVE" &&
                claim.operative,
            )
            .map((claim) => {
              // Only synthetic fixture packets supply this preclassified coverage ledger.
              const requirement = packet.legalRequirements.find((requirement) =>
                requirement.claimBindings?.some(
                  (binding) =>
                    binding.claimId === claim.claimId &&
                    binding.role === "OPERATIVE_PROPOSITION",
                ),
              );
              const outOfScope =
                requirement?.coverage.state ===
                  LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE &&
                requirement.coverage.nonAssessableReason?.startsWith(
                  "OUT_OF_SCOPE_TARGET:",
                );
              const { actor, action, modality } = claim.operative!;
              return {
                claimId: claim.claimId,
                legalSourceVersionId: run.legalSourceVersionId,
                sourceNodeIds: claim.sourceNodeIds,
                actor,
                action,
                modality,
                stage: outOfScope ? nonDevelopment : development,
                reason: "Synthetic scope fixture",
                grouping: null,
                evidence: {
                  targetObject: action,
                  triggerAndTiming: "Synthetic scope fixture",
                  technicalDeliverable: outOfScope ? null : action,
                  repositoryVerifiability: "Synthetic scope fixture",
                  externalFulfillment: null,
                  conditions: [],
                  exceptions: [],
                  materialContextClaimIds: [],
                  sourceSupport: claim.sourceNodeIds.map((sourceNodeId) => ({
                    sourceNodeId,
                    locator: paths.get(sourceNodeId)!,
                    rationale: "Synthetic scope fixture",
                  })),
                },
              };
            });
          const cid = "fixture-development-scope";
          const revision = run.claimInventoryRevision;
          const draft = await scope.submit(
            run.id,
            {
              inventoryRevision: revision,
              inventoryFingerprint: packet.claimInventory.fingerprint,
              expectedReviewRevision: 0,
              decisions,
            },
            "fixture-scope-author",
            cid,
          );
          await scope.approve(
            run.id,
            {
              inventoryRevision: revision,
              expectedReviewRevision: draft.revision,
              decisionDigest: draft.decisionDigest,
              confirmsLegalReview: true,
            },
            "fixture-scope-reviewer",
            cid,
          );
          await scope.activate(run.id, revision, "fixture-scope-reviewer", cid);
          await new ResumeRuleSetPreparationHandler(
            service,
            new OutboxRepository(service),
            fixtureSourceAuthority,
          ).execute(
            new ResumeRuleSetPreparationCommand(
              run.id,
              "fixture-scope-reviewer",
              cid,
            ),
          );
          await new ClaimRuleSetPreparationHandler(
            service,
            new LegalDocumentGraphService(service),
            fixtureSourceAuthority,
          ).execute(
            new ClaimRuleSetPreparationCommand(
              {
                preparationRunId: run.id,
                supportedExecutionContracts: [
                  PREPARATION_EXECUTION_CONTRACTS.DIRECT_DRAFT_V1,
                ],
              },
              cid,
            ),
          );
        }
        await handler.execute(
          new ClaimInventoryCommand(
            {
              preparationRunId: run.id,
              action: A.AUTHOR_RULES,
              revision: run.claimInventoryRevision,
            },
            "fixture-author",
          ),
        );
      }
    } else if (run.claimPhase === ClaimPreparationPhase.CLAIM_INVENTORY_READY) {
      await handler.execute(
        new ClaimInventoryCommand(
          {
            preparationRunId: run.id,
            action: A.AUTHOR_RULES,
            revision: run.claimInventoryRevision,
          },
          "fixture-author",
        ),
      );
    }
    if (
      run.executionContract === PreparationExecutionContract.DIRECT_DRAFT_V1
    ) {
      const saved = await prisma.ruleSetPreparationAuthoringDraft.findUnique({
        where: {
          preparationRunId_revision: {
            preparationRunId: run.id,
            revision: run.claimInventoryRevision,
          },
        },
      });
      const draft = ruleSetPreparationAuthoringDraftSchema.parse({
        legalRequirements: Object.fromEntries(
          packet.legalRequirements.map((item) => [
            item.legalRequirementId,
            item,
          ]),
        ),
        assessmentRules: Object.fromEntries(
          packet.assessmentRules.map((item) => [item.assessmentRuleId, item]),
        ),
        contextRelations: Object.fromEntries(
          packet.contextRelations.map((item) => [item.relationId, item]),
        ),
      });
      if (!saved || inventoryHash(saved.draft) !== inventoryHash(draft)) {
        const result = await handler.execute(
          new ClaimInventoryCommand(
            {
              preparationRunId: run.id,
              action: A.SAVE_AUTHORING_DRAFT,
              revision: run.claimInventoryRevision,
              draftVersion: saved?.draftVersion ?? 0,
              draft,
            },
            "fixture-save",
          ),
        );
        if (result.outcome !== O.PASSED)
          throw new Error(JSON.stringify(result));
      }
    }
    await new ValidateComplianceRuleSetHandler(service, loader).execute(
      new ValidateComplianceRuleSetCommand(
        {
          preparationRunId: run.id,
          packet: complianceRuleSetPacketSchema.parse(packet),
        },
        "fixture-validate",
      ),
    );
  }
  return { ...body, packet };
}
