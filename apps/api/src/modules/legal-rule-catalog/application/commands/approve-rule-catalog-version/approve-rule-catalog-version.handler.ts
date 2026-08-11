import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus } from "@nestjs/common";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  LEGAL_RULE_EVENT_TYPES,
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";

import { ApproveRuleCatalogVersionCommand } from "./approve-rule-catalog-version.command.js";
import type { ApproveRuleCatalogVersionResponse } from "../../contracts/approve-catalog-version.contract.js";
import {
  fromPrismaLegalRuleLifecycleStatus,
  toPrismaLegalRuleLifecycleStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { CitationLocatorValidatorService } from "../../services/citation-locator-validator.service.js";

@CommandHandler(ApproveRuleCatalogVersionCommand)
export class ApproveRuleCatalogVersionHandler implements ICommandHandler<
  ApproveRuleCatalogVersionCommand,
  ApproveRuleCatalogVersionResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly citationLocatorValidator: CitationLocatorValidatorService,
  ) {}

  async execute(
    command: ApproveRuleCatalogVersionCommand,
  ): Promise<ApproveRuleCatalogVersionResponse> {
    await this.assertApproveAction(command);

    const version = await this.prisma.legalRuleCatalogVersion.findUnique({
      where: { id: command.legalRuleCatalogVersionId },
    });

    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.catalogVersionNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    if (
      fromPrismaLegalRuleLifecycleStatus(version.status) !==
      LEGAL_RULE_LIFECYCLE_STATUSES.draft
    ) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.catalogVersionAlreadyApproved,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const rules = await this.prisma.legalRule.findMany({
      where: { legalRuleCatalogVersionId: command.legalRuleCatalogVersionId },
      select: { citationLocatorRefs: true },
    });
    if (rules.length === 0) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.citationUnresolved,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    for (const rule of rules) {
      await this.citationLocatorValidator.validateAll(
        rule.citationLocatorRefs as Array<{
          legalCorpusVersionId: string;
          documentId: string;
          locator: string;
        }>,
      );
    }

    const approvedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // 1. Update version to APPROVED
      await tx.legalRuleCatalogVersion.update({
        where: { id: command.legalRuleCatalogVersionId },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          approvedAt,
        },
      });

      // 2. Create RuleApprovalRecord
      await tx.ruleApprovalRecord.create({
        data: {
          legalRuleCatalogVersionId: command.legalRuleCatalogVersionId,
          approvedBy: command.approvedBy,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
          scopeDescription: command.scopeDescription,
          comments: command.comments,
          approvalDate: approvedAt,
        },
      });

      // 3. Update all rules inside this version to APPROVED
      await tx.legalRule.updateMany({
        where: { legalRuleCatalogVersionId: command.legalRuleCatalogVersionId },
        data: {
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
      });

      // 4. Audit event
      await this.auditWriter.writeInTx(
        {
          eventType: LEGAL_RULE_EVENT_TYPES.catalogVersionApproved,
          actorId: command.approvedBy,
          organizationId: null,
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
          resourceId: command.legalRuleCatalogVersionId,
          decision: AUDIT_DECISIONS.allow,
          policyId: command.authorization.policyId,
          policyVersion: command.authorization.policyVersion,
          correlationId: command.correlationId,
          payload: {
            legalRuleCatalogVersionId: command.legalRuleCatalogVersionId,
            correlationId: command.correlationId,
          },
        },
        tx,
      );
    });

    return {
      id: command.legalRuleCatalogVersionId,
      version: version.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      approvedAt: approvedAt.toISOString(),
    };
  }

  private async assertApproveAction(
    command: ApproveRuleCatalogVersionCommand,
  ): Promise<void> {
    const allowed =
      command.authorization.selectedAction ===
        PBAC_ACTIONS.legalRuleCatalogApprove &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditWriter.write({
      eventType: LEGAL_RULE_EVENT_TYPES.catalogVersionApproved,
      actorId: command.approvedBy,
      organizationId: null,
      resourceType: AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
      resourceId: command.legalRuleCatalogVersionId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.pbacDenied,
      correlationId: command.correlationId,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        action: PBAC_ACTIONS.legalRuleCatalogApprove,
        result: AUDIT_DECISIONS.deny,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}
