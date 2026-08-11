import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { AcceptAIUsageFlowCommand } from "../../application/commands/accept-ai-usage-flow/accept-ai-usage-flow.command.js";
import type { AIUsageFlowCallbackRequest } from "../../application/contracts/ai-usage-flow/ai-usage-flow-callback.contract.js";

@Controller("internal/ai-usage-flow")
export class InternalAIUsageFlowController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  @Post("callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptAIUsageFlow(
    @Body() payload: AIUsageFlowCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptAIUsageFlowCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  @Get(":aiUsageFlowId")
  @UseGuards(WorkerApiKeyGuard)
  async getAIUsageFlow(@Param("aiUsageFlowId") aiUsageFlowId: string) {
    const flow = await this.prisma.aIUsageFlow.findUnique({
      where: { id: aiUsageFlowId },
      select: {
        id: true,
        technicalProfileId: true,
        assessmentId: true,
        organizationId: true,
        schemaVersion: true,
        providerVersion: true,
        claims: true,
        unknownUsages: true,
        privacyFlags: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    if (!flow) {
      throw new NotFoundException("AIUsageFlow not found");
    }

    return resultEnvelope({
      id: flow.id,
      ai_usage_flow_id: flow.id,
      technical_profile_id: flow.technicalProfileId,
      assessment_id: flow.assessmentId,
      organization_id: flow.organizationId,
      schema_version: flow.schemaVersion,
      provider_version: flow.providerVersion,
      claims: flow.claims,
      unknown_usages: flow.unknownUsages,
      privacy_flags: flow.privacyFlags,
      status: String(flow.status).toLowerCase(),
      rejection_reason: flow.rejectionReason,
      created_at: flow.createdAt.toISOString(),
    });
  }
}
