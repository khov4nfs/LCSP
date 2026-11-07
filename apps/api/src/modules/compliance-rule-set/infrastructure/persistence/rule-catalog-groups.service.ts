import { createHash, randomUUID } from "node:crypto";
import { Injectable, HttpStatus } from "@nestjs/common";
import {
  Prisma,
  RuleCatalogReviewState,
  PreparationTargetActivityScope,
} from "@prisma/client";
import {
  RULE_CATALOG_REVIEW_STATES,
  type SubmitRuleCatalogGroups,
} from "@lcsp/contracts/assessment-domain";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  PREPARATION_SCOPE_STAGES,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";

const digestRows = (rows: unknown[]) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");

/** Two-person, version-pinned presentation review; never classifies legal obligations. */
@Injectable()
export class RuleCatalogGroupsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(ruleSetVersionId: string) {
    const memberships = await this.prisma.ruleCatalogGroupMembership.findMany({
      where: { ruleSetVersionId },
      orderBy: { assessmentRuleId: "asc" },
    });
    return { memberships, membershipDigest: digestRows(memberships) };
  }
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
        ];
        if (
          !actors.length ||
          row.lifecycleStage !== PREPARATION_SCOPE_STAGES[0]
        )
          this.conflict(correlationId);
        if (
          !sources.length ||
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
      if (
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
  private conflict(correlationId: string): never {
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}
