/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, type TestingModule } from "@nestjs/testing";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  UnprocessableEntityException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { DraftLegalRuleHandler } from "./draft-legal-rule.handler.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { CitationLocatorValidatorService } from "../../services/citation-locator-validator.service.js";
import { DraftLegalRuleCommand } from "./draft-legal-rule.command.js";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

describe("DraftLegalRuleHandler", () => {
  let handler: DraftLegalRuleHandler;
  let prisma: jest.Mocked<PrismaService>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let validator: jest.Mocked<CitationLocatorValidatorService>;

  beforeEach(async () => {
    prisma = {
      legalRuleCatalogVersion: {
        findUnique: jest.fn<any>(),
      },
      $transaction: jest.fn<any>((cb: any) => cb(prisma)),
      legalRule: {
        create: jest.fn<any>(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    auditWriter = {
      write: jest.fn(),
      writeInTx: jest.fn(),
    } as unknown as jest.Mocked<AuditWriterService>;

    validator = {
      validateAll: jest.fn(),
    } as unknown as jest.Mocked<CitationLocatorValidatorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DraftLegalRuleHandler,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditWriterService, useValue: auditWriter },
        { provide: CitationLocatorValidatorService, useValue: validator },
      ],
    }).compile();

    handler = module.get<DraftLegalRuleHandler>(DraftLegalRuleHandler);
  });

  const createCommand = () => {
    return new DraftLegalRuleCommand(
      "LR-001",
      "FamilyA",
      { fact1: true },
      null,
      null,
      "BLOCK_ON_UNKNOWN",
      [{ legalCorpusVersionId: "v1", documentId: "d1", locator: "loc1" }],
      "user123",
      "version-uuid",
      "corr-id",
    );
  };

  it("T01: Draft with all citation locators resolving to ACTIVE chunks -> 201, DRAFT (T08: Audit written)", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);

    validator.validateAll.mockResolvedValue(undefined);

    (prisma.legalRule.create as any).mockResolvedValue({
      id: "new-rule-id",
    } as any);

    const result = await handler.execute(command);

    expect(result).toEqual({
      id: "new-rule-id",
      legalRuleId: "LR-001",
      status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
    });

    expect(validator.validateAll).toHaveBeenCalledWith(
      command.citationLocatorRefs,
    );
    expect(prisma.legalRule.create).toHaveBeenCalled();
    expect(auditWriter.writeInTx).toHaveBeenCalled();
  });

  it("T02: Draft with a REPEALED locator -> 422", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);

    validator.validateAll.mockRejectedValue(
      new UnprocessableEntityException(LEGAL_RULE_ERROR_CODES.citationRepealed),
    );

    await expect(handler.execute(command)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("T03: Draft with unresolvable locator -> 422", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);

    validator.validateAll.mockRejectedValue(
      new UnprocessableEntityException(
        LEGAL_RULE_ERROR_CODES.citationUnresolved,
      ),
    );

    await expect(handler.execute(command)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it("Should throw ConflictException if version is already APPROVED", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      ),
    } as any);

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  it("Should throw NotFoundException if version not found", async () => {
    const command = createCommand();

    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue(
      null as any,
    );

    await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
  });

  it.todo(
    "T07: Corpus version referenced by a rule is later superseded, cited locator becomes REPEALED -> Rule flagged for mandatory re-review (Pending cross-module Event Handler)",
  );

  it("T08: Audit event recorded for draft", async () => {
    const command = createCommand();
    (prisma.legalRuleCatalogVersion.findUnique as any).mockResolvedValue({
      id: "version-uuid",
      status: toPrismaLegalRuleLifecycleStatus(
        LEGAL_RULE_LIFECYCLE_STATUSES.draft,
      ),
    } as any);
    validator.validateAll.mockResolvedValue(undefined);
    (prisma.legalRule.create as any).mockResolvedValue({
      id: "new-rule-id",
    } as any);

    await handler.execute(command);
    expect(auditWriter.writeInTx).toHaveBeenCalled();
  });
});
