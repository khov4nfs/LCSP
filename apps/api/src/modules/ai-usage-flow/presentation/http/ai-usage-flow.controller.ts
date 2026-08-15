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

/**
 * Exposes worker-authenticated endpoints for accepting and inspecting AI usage-flow artifacts.
 */
@Controller("internal/ai-usage-flow")
export class InternalAIUsageFlowController {
  /**
   * Creates the internal controller with command dispatch and read-model persistence access.
   *
   * @param commandBus - CQRS command bus used to process worker callbacks.
   * @param prisma - Prisma service used to retrieve persisted AI usage-flow artifacts.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Accepts a sanitized AI usage-flow callback from the worker and dispatches it through the command pipeline.
   *
   * @param payload - Worker callback payload containing claims, provider metadata, and privacy assertions.
   * @param correlationId - Optional upstream correlation identifier; a UUID is generated when absent.
   * @returns The standard result envelope containing callback acceptance metadata.
   */
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

  /**
   * Retrieves a persisted AI usage-flow artifact in the worker-facing contract shape.
   *
   * @param aiUsageFlowId - AI usage-flow identifier to retrieve.
   * @returns The standard result envelope containing the persisted usage-flow artifact.
   * @throws When no AI usage-flow exists for the supplied identifier.
   */
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
