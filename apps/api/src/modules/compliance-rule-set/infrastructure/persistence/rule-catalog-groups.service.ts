import { createHash, randomUUID } from "node:crypto";
import { Injectable, HttpStatus } from "@nestjs/common";
import {
  Prisma,
  RuleCatalogReviewState,
  PreparationTargetActivityScope,
  ArtifactLifecycleState,
  PreparationScopeReviewState,
  LegalClaimAccountingRole,
  AgentExecutionState,
  AuthoredLocalizationState,
} from "@prisma/client";
import {
  RULE_CATALOG_REVIEW_STATES,
  type SubmitRuleCatalogGroups,
  ruleGroupingProposalSchema,
  RULE_CATALOG_TAXONOMY_VERSION,
} from "@lcsp/contracts/assessment-domain";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  PREPARATION_SCOPE_STAGES,
  preparationScopeReviewSubmitSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { requireApprovedDevelopmentScope } from "./approved-development-scope.js";
import {
  authoredFields,
  hasReviewedLocale,
} from "../../../../platform/localization/authored-localization.service.js";

/**
 * Business purpose: Bind approval requests to the exact catalog membership snapshot.
 *
 * Business rules:
 * - Labels, ordering, rule versions and review metadata are included in the digest.
 * Execution flow:
 * 1. Serialize the supplied rows deterministically and hash their JSON bytes.
 * Failure cases:
 * - Unsupported serialization fails rather than generating a guessed approval digest.
 * Side effects:
 * - None: computes a membership fingerprint.
 */
const digestRows = (rows: unknown[]) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");

/**
 * Business purpose: Persist a deterministic review proposal after successful Development-only activation.
 * Business rules:
 * - Canonical rules and source evidence determine identity; absent reviewed taxonomy evidence stays unassigned, never guessed from titles.
 * Execution flow:
 * 1. Read ordered canonical rule support, construct review-required entries and idempotently persist the pinned proposal.
 * Failure cases:
 * - Invalid source support or database failure aborts without approving membership or changing legal scope.
 * Side effects:
 * - Creates one durable proposal in the activation transaction; retries never overwrite submitted or approved membership.
 */
export async function materializeGroupingProposal(
  tx: Prisma.TransactionClient,
  ruleSetVersionId: string,
  ruleSetDigest: string,
) {
  const version = await tx.complianceRuleSetVersion.findUniqueOrThrow({
    where: { id: ruleSetVersionId },
    include: { preparationRun: true },
  });
  if (
    version.ruleSetDigest !== ruleSetDigest ||
    version.targetActivityScope !==
      PreparationTargetActivityScope.DEVELOPMENT_ONLY ||
    version.preparationRun.executionState === AgentExecutionState.FAILED ||
    version.lifecycleState === ArtifactLifecycleState.INVALID
  )
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      randomUUID(),
      { status: HttpStatus.CONFLICT },
    );
  const review = await tx.ruleSetPreparationScopeReview.findUnique({
    where: {
      preparationRunId_inventoryRevision: {
        preparationRunId: version.preparationRunId,
        inventoryRevision: version.preparationRun.claimInventoryRevision,
      },
    },
  });
  const approvedDecisions = new Map<
    string,
    ReturnType<
      typeof preparationScopeReviewSubmitSchema.shape.decisions.parse
    >[number]
  >();
  if (review?.state === PreparationScopeReviewState.APPROVED) {
    const projection = await requireApprovedDevelopmentScope(
      tx,
      version.preparationRunId,
      version.preparationRun.claimInventoryRevision,
      version.legalSourceVersionId,
      version.targetActivityScope,
      randomUUID(),
    );
    const retained = new Set(projection?.developmentClaimIds ?? []);
    for (const decision of preparationScopeReviewSubmitSchema.shape.decisions.parse(
      review.decisions,
    ))
      if (retained.has(decision.claimId))
        approvedDecisions.set(decision.claimId, decision);
  }
  const rules = await tx.assessmentRule.findMany({
    where: { ruleSetVersionId },
    orderBy: { assessmentRuleId: "asc" },
    include: {
      legalRequirementLinks: {
        include: {
          legalRequirement: {
            include: { provenance: true, claimBindings: true },
          },
        },
      },
    },
  });
  const entries = rules.map((rule) => {
    const requirements = rule.legalRequirementLinks.map(
      (link) => link.legalRequirement,
    );
    const propositions = requirements.flatMap((requirement) =>
      Array.isArray(requirement.operativePropositions)
        ? requirement.operativePropositions
        : [],
    );
    const actors = [
      ...new Set(
        propositions.flatMap((proposition) =>
          proposition &&
          typeof proposition === "object" &&
          !Array.isArray(proposition) &&
          typeof proposition.actor === "string"
            ? [proposition.actor]
            : [],
        ),
      ),
    ].sort();
    const operativeClaims = [
      ...new Set(
        requirements.flatMap((requirement) =>
          requirement.claimBindings
            .filter(
              (binding) =>
                binding.role === LegalClaimAccountingRole.OPERATIVE_PROPOSITION,
            )
            .map((binding) => binding.claimId),
        ),
      ),
    ];
    const reviewedGroups = operativeClaims.map(
      (claimId) => approvedDecisions.get(claimId)?.grouping,
    );
    const agreed =
      reviewedGroups.length > 0 &&
      reviewedGroups.every(
        (group) => group && group.groupId === reviewedGroups[0]?.groupId,
      )
        ? reviewedGroups[0]
        : null;
    return {
      assessmentRuleId: rule.assessmentRuleId,
      assessmentRuleVersion: rule.assessmentRuleVersion,
      concept: rule.concept,
      legalIntent: rule.legalIntent,
      actor: actors.join("; "),
      lifecycleStage: PREPARATION_SCOPE_STAGES[0],
      operativePropositions: propositions,
      sourceReferences: requirements
        .flatMap((requirement) =>
          requirement.provenance.map((source) => ({
            documentId: source.documentId,
            locator: source.locator,
          })),
        )
        .sort(
          (a, b) =>
            a.documentId.localeCompare(b.documentId) ||
            a.locator.localeCompare(b.locator),
        ),
      proposedGroupId: agreed?.groupId ?? null,
      proposedRationaleEn: agreed?.rationaleEn ?? "",
      proposedRationaleVi: agreed?.rationaleVi ?? "",
      state: RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED,
    };
  });
  const payload = ruleGroupingProposalSchema.parse({
    ruleSetVersionId,
    ruleSetDigest,
    state: RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED,
    entries,
  });
  return tx.ruleCatalogGroupingProposal.upsert({
    where: { ruleSetVersionId },
    update: {},
    create: {
      ruleSetVersionId,
      ruleSetDigest,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

/** Two-person, version-pinned presentation review; never classifies legal obligations. */
@Injectable()
export class RuleCatalogGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Find active Development-only versions awaiting complete grouping review.
   * Business rules:
   * - Only Admin callers may use this bounded operations list; canonical scope and customer selection remain unchanged.
   * Execution flow:
   * 1. Read active version pins and retain those lacking complete version-matched approved memberships.
   * Failure cases:
   * - Persistence failures reject; no draft record is exposed through the customer catalog.
   * Side effects:
   * - Reads operational grouping readiness without generating or approving memberships.
   */
  async pending() {
    const rows = await this.prisma.complianceRuleSetVersion.findMany({
      where: {
        lifecycleState: ArtifactLifecycleState.ACTIVE,
        targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
      },
      orderBy: { id: "asc" },
      take: 100,
      select: {
        id: true,
        version: true,
        ruleSetDigest: true,
        assessmentRules: {
          select: { assessmentRuleId: true, assessmentRuleVersion: true },
        },
      },
    });
    const memberships = await this.prisma.ruleCatalogGroupMembership.findMany({
      where: {
        ruleSetVersionId: { in: rows.map((row) => row.id) },
        state: RuleCatalogReviewState.APPROVED,
      },
    });
    return {
      versions: rows
        .filter(
          (row) =>
            row.assessmentRules.length > 0 &&
            row.assessmentRules.some(
              (rule) =>
                !memberships.some(
                  (member) =>
                    member.ruleSetVersionId === row.id &&
                    member.assessmentRuleId === rule.assessmentRuleId &&
                    member.assessmentRuleVersion === rule.assessmentRuleVersion,
                ),
            ),
        )
        .map((row) => ({
          ruleSetVersionId: row.id,
          version: row.version,
          ruleSetDigest: row.ruleSetDigest,
          ruleCount: row.assessmentRules.length,
          state: RULE_CATALOG_REVIEW_STATES.REVIEW_REQUIRED,
        })),
    };
  }

  /**
   * Business purpose: Recover or read the review proposal for an active Development-only Rule Set.
   * Business rules:
   * - Only active canonical pins qualify; old digests are rejected and no approval is inferred.
   * Execution flow:
   * 1. Lock the version, validate lifecycle/scope, materialize missing historical work and validate the persisted proposal.
   * Failure cases:
   * - Failed Preparation, stale versions and unsupported scope cannot generate a customer catalog.
   * Side effects:
   * - May create missing proposal work for historical active versions; never writes memberships.
   */
  async proposal(ruleSetVersionId: string, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ComplianceRuleSetVersion" WHERE "id"=${ruleSetVersionId} FOR UPDATE`,
      );
      const version = await tx.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: ruleSetVersionId },
      });
      if (
        version.lifecycleState !== ArtifactLifecycleState.ACTIVE ||
        version.targetActivityScope !==
          PreparationTargetActivityScope.DEVELOPMENT_ONLY
      )
        this.conflict(correlationId);
      const proposal = await materializeGroupingProposal(
        tx,
        ruleSetVersionId,
        version.ruleSetDigest,
      );
      if (proposal.ruleSetDigest !== version.ruleSetDigest)
        this.conflict(correlationId);
      return ruleGroupingProposalSchema.parse(proposal.payload);
    });
  }
  /**
   * Business purpose: Expose the version-bound group membership ledger for authorized administration.
   *
   * Business rules:
   * - This read does not confer taxonomy, legal or activation approval.
   * Execution flow:
   * 1. Load ordered memberships for the requested Rule Set and compute their snapshot digest.
   * Failure cases:
   * - Persistence errors propagate without inventing group assignments.
   * Side effects:
   * - Read membership records only.
   */
  async get(ruleSetVersionId: string) {
    const memberships = await this.prisma.ruleCatalogGroupMembership.findMany({
      where: { ruleSetVersionId },
      orderBy: { assessmentRuleId: "asc" },
    });
    const jobs = await this.prisma.authoredLocalizationRequest.findMany({
      where: { scopeId: ruleSetVersionId },
      orderBy: [{ translationRevision: "desc" }, { id: "asc" }],
      include: { revision: true },
    });
    const latest = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      const key = JSON.stringify([
        job.entityType,
        job.entityId,
        job.canonicalRevision,
        job.canonicalDigest,
        job.fieldPath,
        job.locale,
      ]);
      if (!latest.has(key)) latest.set(key, job);
    }
    const localization = { ready: 0, pending: 0, failed: 0 };
    for (const job of latest.values()) {
      if (hasReviewedLocale(job)) localization.ready++;
      else if (job.state === AuthoredLocalizationState.FAILED)
        localization.failed++;
      else localization.pending++;
    }
    const [canonicalRules, canonicalRequirements] = await Promise.all([
      this.prisma.assessmentRule.findMany({ where: { ruleSetVersionId } }),
      this.prisma.legalRequirement.findMany({ where: { ruleSetVersionId } }),
    ]);
    const expected = [...canonicalRules, ...canonicalRequirements].reduce(
      (sum, row) => sum + authoredFields(row).length * 2,
      0,
    );
    localization.pending += Math.max(0, expected - latest.size);
    return {
      memberships,
      membershipDigest: digestRows(memberships),
      localization,
    };
  }
  /**
   * Business purpose: Persist a complete draft grouping for a reviewed Development catalog.
   *
   * Business rules:
   * - Exact Rule Set digest, rule identities/versions, provenance and one primary group per rule are required; approved rows cannot be overwritten.
   * Execution flow:
   * 1. Lock the Rule Set, validate complete membership and source transparency, then upsert draft rows.
   * Failure cases:
   * - Stale pins, incomplete membership, inconsistent labels or unsupported provenance reject the transaction.
   * Side effects:
   * - Write draft group membership with authenticated submitter identity.
   */
  async submit(
    ruleSetVersionId: string,
    body: SubmitRuleCatalogGroups,
    actorId: string,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ComplianceRuleSetVersion" WHERE "id"=${ruleSetVersionId} FOR UPDATE`,
      );
      const version = await tx.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: ruleSetVersionId },
      });
      const rules = await tx.assessmentRule.findMany({
        where: { ruleSetVersionId },
        include: {
          legalRequirementLinks: {
            include: { legalRequirement: { include: { provenance: true } } },
          },
        },
      });
      const existing = await tx.ruleCatalogGroupMembership.findMany({
        where: { ruleSetVersionId },
      });
      if (
        version.targetActivityScope !==
          PreparationTargetActivityScope.DEVELOPMENT_ONLY ||
        version.lifecycleState !== ArtifactLifecycleState.ACTIVE ||
        version.ruleSetDigest !== body.ruleSetDigest ||
        existing.some((row) => row.state === RuleCatalogReviewState.APPROVED)
      )
        this.conflict(correlationId);
      const requested = new Map(
        body.memberships.map((row) => [row.assessmentRuleId, row]),
      );
      if (
        requested.size !== body.memberships.length ||
        requested.size !== rules.length ||
        new Set(body.memberships.map((row) => row.taxonomyVersion)).size !== 1
      )
        this.conflict(correlationId);
      const groupLabels = new Map<string, string>();
      for (const rule of rules) {
        const row = requested.get(rule.assessmentRuleId);
        if (!row || row.assessmentRuleVersion !== rule.assessmentRuleVersion)
          this.conflict(correlationId);
        if (row.taxonomyVersion !== RULE_CATALOG_TAXONOMY_VERSION)
          this.conflict(correlationId);
        const label = JSON.stringify([
          row.nameEn,
          row.nameVi,
          row.descriptionEn,
          row.descriptionVi,
        ]);
        if (
          groupLabels.has(row.groupId) &&
          groupLabels.get(row.groupId) !== label
        )
          this.conflict(correlationId);
        groupLabels.set(row.groupId, label);
        const sources = rule.legalRequirementLinks.flatMap((link) =>
          link.legalRequirement.provenance.map((source) => ({
            documentId: source.documentId,
            locator: source.locator,
          })),
        );
        const actors = [
          ...new Set(
            rule.legalRequirementLinks.flatMap((link) =>
              Array.isArray(link.legalRequirement.operativePropositions)
                ? link.legalRequirement.operativePropositions.flatMap(
                    (proposition) =>
                      proposition &&
                      typeof proposition === "object" &&
                      !Array.isArray(proposition) &&
                      typeof proposition.actor === "string"
                        ? [proposition.actor]
                        : [],
                  )
                : [],
            ),
          ),
        ].sort();
        if (
          !actors.length ||
          row.actor !== actors.join("; ") ||
          row.lifecycleStage !== PREPARATION_SCOPE_STAGES[0]
        )
          this.conflict(correlationId);
        if (
          !sources.length ||
          !row.sourceReferences.length ||
          sources.some(
            (source) =>
              !row.sourceReferences.some(
                (submitted) =>
                  submitted.documentId === source.documentId &&
                  submitted.locator === source.locator,
              ),
          ) ||
          row.sourceReferences.some(
            (source) =>
              !sources.some(
                (actual) =>
                  actual.documentId === source.documentId &&
                  actual.locator === source.locator,
              ),
          )
        )
          this.conflict(correlationId);
        await tx.ruleCatalogGroupMembership.upsert({
          where: {
            ruleSetVersionId_assessmentRuleId: {
              ruleSetVersionId,
              assessmentRuleId: rule.assessmentRuleId,
            },
          },
          create: {
            id: randomUUID(),
            ruleSetVersionId,
            ...row,
            actor: actors.join("; "),
            sourceReferences: sources,
            submittedBy: actorId,
          },
          update: {
            ...row,
            actor: actors.join("; "),
            sourceReferences: sources,
            submittedBy: actorId,
            state: RuleCatalogReviewState.DRAFT,
            approvedBy: null,
            approvedAt: null,
          },
        });
      }
      const memberships = await tx.ruleCatalogGroupMembership.findMany({
        where: { ruleSetVersionId },
        orderBy: { assessmentRuleId: "asc" },
      });
      return {
        memberships,
        membershipDigest: digestRows(memberships),
        state: RULE_CATALOG_REVIEW_STATES.DRAFT,
      };
    });
  }
  /**
   * Business purpose: Record independent approval of an exact grouping snapshot.
   *
   * Business rules:
   * - Approver must differ from submitter; all current rules need version-matched draft membership and the digest must match.
   * Execution flow:
   * 1. Lock the version, verify the complete submitted snapshot and mark its rows approved by the authenticated reviewer.
   * Failure cases:
   * - Self-approval, stale digests or incomplete/different-version rows reject approval.
   * Side effects:
   * - Persist reviewer identity and approval timestamp without altering legal scope.
   */
  async approve(
    ruleSetVersionId: string,
    expectedDigest: string,
    reviewerId: string,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ComplianceRuleSetVersion" WHERE "id"=${ruleSetVersionId} FOR UPDATE`,
      );
      const memberships = await tx.ruleCatalogGroupMembership.findMany({
        where: { ruleSetVersionId },
        orderBy: { assessmentRuleId: "asc" },
      });
      const count = await tx.assessmentRule.count({
        where: { ruleSetVersionId },
      });
      const version = await tx.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: ruleSetVersionId },
      });
      const rules = await tx.assessmentRule.findMany({
        where: { ruleSetVersionId },
        select: { assessmentRuleId: true, assessmentRuleVersion: true },
      });
      if (
        version.lifecycleState !== ArtifactLifecycleState.ACTIVE ||
        version.targetActivityScope !==
          PreparationTargetActivityScope.DEVELOPMENT_ONLY ||
        rules.some(
          (rule) =>
            !memberships.some(
              (row) =>
                row.assessmentRuleId === rule.assessmentRuleId &&
                row.assessmentRuleVersion === rule.assessmentRuleVersion,
            ),
        ) ||
        !count ||
        count !== memberships.length ||
        digestRows(memberships) !== expectedDigest ||
        memberships.some(
          (row) =>
            row.submittedBy === reviewerId ||
            row.state !== RuleCatalogReviewState.DRAFT,
        )
      )
        this.conflict(correlationId);
      await tx.ruleCatalogGroupMembership.updateMany({
        where: { ruleSetVersionId, state: RuleCatalogReviewState.DRAFT },
        data: {
          state: RuleCatalogReviewState.APPROVED,
          approvedBy: reviewerId,
          approvedAt: new Date(),
        },
      });
      return { state: RULE_CATALOG_REVIEW_STATES.APPROVED };
    });
  }
  /**
   * Business purpose: Return the canonical domain conflict for invalid catalog governance.
   *
   * Business rules:
   * - A grouping conflict must not masquerade as successful approval or scope expansion.
   * Execution flow:
   * 1. Construct the shared problem exception with the request correlation ID.
   * Failure cases:
   * - Always throws the domain conflict to abort the operation.
   * Side effects:
   * - None: produces an error without changing membership.
   */
  private conflict(correlationId: string): never {
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}
