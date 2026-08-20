import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
} from "@lcsp/contracts/scan";
import { CommandBus } from "@nestjs/cqrs";
import { Test, type TestingModule } from "@nestjs/testing";

import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import type { AcceptClassificationDto } from "../../application/contracts/classification/classification-result-callback.contract.js";
import type {
  AcceptLegalRuleMatchDto,
  LegalRuleMatchCallbackResponseDto,
} from "../../application/contracts/classification/legal-rule-match-callback.contract.js";
import { ClassificationController } from "./classification.controller.js";

describe("ClassificationController", () => {
  let controller: ClassificationController;
  let mockExecuteCommand: jest.Mock<
    (args: unknown) => Promise<LegalRuleMatchCallbackResponseDto>
  >;

  const mockMatchPayload: AcceptLegalRuleMatchDto = {
    verified_profile_id: "vp-1",
    assessment_id: "asm-1",
    corpus_version_id: "v1.0.0",
    legal_rule_catalog_version_id: "v1.0.0",
    schema_version: "1.0.0",
    citation_allowlist: ["chunk-1"],
    overall_coverage_status: "COMPLETE_CITATION",
    matches: [
      {
        match_id: "m-1",
        rule_id: "r-1",
        legal_rule_catalog_version_id: "v1.0.0",
        article_ref: "Art 1",
        clause_ref: "Cl 1",
        match_type: "PRIMARY_MATCH",
        citation_chunk_ids: ["chunk-1"],
        confidence: 0.9,
        coverage_status: "COMPLETE_CITATION",
        usage_claim_ref: "uc-1",
      },
    ],
  };

  const mockClassificationPayload: AcceptClassificationDto = {
    technical_evidence_report_id: "ter-123",
    legal_rule_match_id: "lrm-123",
    verified_profile_id: "vp-123",
    assessment_id: "asm-123",
    schema_version: "1.0.0",
    classification_data: {
      risk_level: "HIGH",
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  };

  beforeEach(async () => {
    mockExecuteCommand = jest
      .fn<(args: unknown) => Promise<LegalRuleMatchCallbackResponseDto>>()
      .mockResolvedValue({
        accepted: true,
        legal_rule_match_id: "lrm-123",
        guardrail_status: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
        correlationId: "corr-123",
      });

    const commandBus = {
      execute: mockExecuteCommand,
    } as unknown as jest.Mocked<CommandBus>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClassificationController],
      providers: [
        {
          provide: CommandBus,
          useValue: commandBus,
        },
      ],
    })
      .overrideGuard(WorkerApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClassificationController>(ClassificationController);
  });

  it("dispatches AcceptLegalRuleMatchCommand when endpoint is called", async () => {
    const result = await controller.acceptLegalRuleMatch(
      mockMatchPayload,
      "corr-123",
    );

    expect(result).toEqual({
      ok: true,
      data: {
        accepted: true,
        legal_rule_match_id: "lrm-123",
        guardrail_status: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
        correlationId: "corr-123",
      },
    });

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: mockMatchPayload,
        correlationId: "corr-123",
      }),
    );
  });

  it("dispatches AcceptClassificationCommand when result-callback endpoint is called", async () => {
    const result = await controller.acceptClassificationResult(
      mockClassificationPayload,
      "corr-cls-123",
    );

    expect(result).toEqual({
      ok: true,
      data: {
        accepted: true,
        legal_rule_match_id: "lrm-123",
        guardrail_status: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
        correlationId: "corr-123",
      },
    });

    expect(mockExecuteCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: mockClassificationPayload,
        correlationId: "corr-cls-123",
      }),
    );
  });
});
