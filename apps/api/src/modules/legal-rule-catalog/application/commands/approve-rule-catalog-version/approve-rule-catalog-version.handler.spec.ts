/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, type TestingModule } from "@nestjs/testing";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ApproveRuleCatalogVersionHandler } from "./approve-rule-catalog-version.handler.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { CitationLocatorValidatorService } from "../../services/citation-locator-validator.service.js";
import { ApproveRuleCatalogVersionCommand } from "./approve-rule-catalog-version.command.js";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

describe("ApproveRuleCatalogVersionHandler", () => {
  let handler: ApproveRuleCatalogVersionHandler;
  let prisma: jest.Mocked<PrismaService>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let citationLocatorValidator: jest.Mocked<CitationLocatorValidatorService>;

  beforeEach(async () => {
    prisma = {
      legalRuleCatalogVersion: {
        findUnique: jest.fn<any>(),
        update: jest.fn<any>(),
      },
      ruleApprovalRecord: {
        create: jest.fn<any>(),
      },
      legalRule: {
        findMany: jest.fn<any>().mockResolvedValue([
          {
            citationLocatorRefs: [
              {
                legalCorpusVersionId: "corpus-1",
                documentId: "doc-1",
                locator: "art-1",
              },
            ],
          },
        ]),
        updateMany: jest.fn<any>(),
      },
      $transaction: jest.fn<any>((cb: any) => cb(prisma)),
    } as unknown as jest.Mocked<PrismaService>;

    auditWriter = {
      write: jest.fn(),
      writeInTx: jest.fn(),
    } as unknown as jest.Mocked<AuditWriterService>;

    citationLocatorValidator = {
      validateAll: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CitationLocatorValidatorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApproveRuleCatalogVersionHandler,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditWriterService, useValue: auditWriter },
        {
          provide: CitationLocatorValidatorService,
          useValue: citationLocatorValidator,
        },
      ],
    }).compile();

    handler = module.get<ApproveRuleCatalogVersionHandler>(
      ApproveRuleCatalogVersionHandler,
    );
  });

  const createCommand = () => {
    return new ApproveRuleCatalogVersionCommand(
      "version-uuid",
      "Scope description",
      null,
      "user123",
      {
        subjectRole: "manager",
        selectedAction: PBAC_ACTIONS.legalRuleCatalogApprove,
        policyId: "pol1",
        policyVersion: "1.0",
      },
      "corr-id",
    );
  };

  it("T04: Approve a DRAFT version -> 200, APPROVED, immutable (T08: Audit written)", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      version: "1.0",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);

    const result = await handler.execute(command);

    expect(result).toEqual({
      id: "version-uuid",
      version: "1.0",
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      approvedAt: expect.any(String),
    });

    expect(citationLocatorValidator.validateAll).toHaveBeenCalled();
    expect(prisma.legalRuleCatalogVersion.update).toHaveBeenCalled();
    expect(prisma.ruleApprovalRecord.create).toHaveBeenCalled();
    expect(prisma.legalRule.updateMany).toHaveBeenCalled();
    expect(auditWriter.writeInTx).toHaveBeenCalled();
  });

  it("T05: Add rule to already-APPROVED version -> 409 CATALOG_VERSION_ALREADY_APPROVED", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      ),
    } as any);

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it("T06: Actor lacks legal-rule-catalog:approve -> 403 PBAC_DENIED", async () => {
    const command = createCommand();
    command.authorization.selectedAction = "some:other:action";

    await expect(handler.execute(command)).rejects.toThrow(ForbiddenException);
    expect(auditWriter.write).toHaveBeenCalled();
  });

  it("Should throw NotFoundException if version not found", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue(
      null as any,
    );

    await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
  });

  it("T08: Audit event recorded for approve", async () => {
    const command = createCommand();
    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      version: "1.0",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);

    await handler.execute(command);
    expect(auditWriter.writeInTx).toHaveBeenCalled();
  });
});
