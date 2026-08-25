import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { CLASSIFICATION_GUARDRAIL_STATUSES } from "@lcsp/contracts/scan";
import { CommandBus } from "@nestjs/cqrs";
import { Test, type TestingModule } from "@nestjs/testing";

import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import type { AcceptClassificationDto } from "../../application/contracts/classification/classification-result-callback.contract.js";
import type { ClassificationResultCallbackResponseDto } from "../../application/contracts/classification/classification-result-callback.contract.js";
import { ClassificationController } from "./classification.controller.js";

describe("ClassificationController", () => {
  let controller: ClassificationController;
  let mockExecuteCommand: jest.Mock<
    (args: unknown) => Promise<ClassificationResultCallbackResponseDto>
  >;

  const mockClassificationPayload: AcceptClassificationDto = {
    technical_evidence_report_id: "ter-123",
    assessment_id: "asm-123",
    schema_version: "1.0.0",
    classification_data: {
      risk_level: "HIGH",
    },
    guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  };

  beforeEach(async () => {
    mockExecuteCommand = jest
      .fn<(args: unknown) => Promise<ClassificationResultCallbackResponseDto>>()
      .mockResolvedValue({
        accepted: true,
        classification_result_id: "classification-123",
        guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
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

  it("dispatches AcceptClassificationCommand when result-callback endpoint is called", async () => {
    const result = await controller.acceptClassificationResult(
      mockClassificationPayload,
      "corr-cls-123",
    );

    expect(result).toEqual({
      ok: true,
      data: {
        accepted: true,
        classification_result_id: "classification-123",
        guardrail_status: CLASSIFICATION_GUARDRAIL_STATUSES.passed,
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
