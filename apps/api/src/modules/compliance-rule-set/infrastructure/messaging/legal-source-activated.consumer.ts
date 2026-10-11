import { randomUUID } from "node:crypto";

import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_QUEUE_NAMES,
  RULE_SET_PREPARATION_SYSTEM_ACTOR,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_RULE_EVENT_TYPES } from "@lcsp/contracts/legal-rule-catalog";
import { HttpException, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { z } from "zod";

import { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { StartRuleSetPreparationCommand } from "../../application/commands/start-rule-set-preparation/start-rule-set-preparation.command.js";

const legalSourceActivatedPayloadSchema = z.looseObject({
  legalSourceVersionId: z.uuid(),
  correlationId: z.string().min(1).optional(),
});

/** Problem codes that mean "this activation will never start a preparation"; redelivery cannot fix them. */
const TERMINAL_REFUSALS = new Set<string>([
  COMPLIANCE_RULE_SET_ERROR_CODES.sourceVersionNotFound,
  COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
]);

/**
 * Messaging adapter: a validated Legal Source Version activation (a durable outbox event) becomes
 * exactly one Rule Set Preparation through the CommandBus. It owns no persistence and no policy:
 * the run identity derives from the authoritative source identity, so a replayed or concurrently
 * delivered event resolves to the same run and never reaches the paid model twice.
 */
@Injectable()
export class LegalSourceActivatedConsumer implements OnModuleInit {
  private readonly logger = new Logger(LegalSourceActivatedConsumer.name);

  constructor(
    private readonly rabbitMq: RabbitMqClient,
    private readonly commandBus: CommandBus,
  ) {}

  onModuleInit(): void {
    void this.rabbitMq
      .consume({
        queue: RULE_SET_PREPARATION_QUEUE_NAMES.legalSourceActivated,
        routingKey: LEGAL_RULE_EVENT_TYPES.corpusVersionActivated,
        handler: (payload) => this.handle(payload),
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Rule Set Preparation trigger startup failed: ${describe(error)}`,
        );
      });
  }

  async handle(payload: Record<string, unknown>): Promise<void> {
    const parsed = legalSourceActivatedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      // A malformed event can never become valid by redelivery.
      this.logger.error("Legal Source activation event has no legalSourceVersionId");
      return;
    }
    const { legalSourceVersionId, correlationId } = parsed.data;
    try {
      await this.commandBus.execute(
        new StartRuleSetPreparationCommand(
          {
            legalSourceVersionId,
            idempotencyKey: ruleSetPreparationIdempotencyKey(legalSourceVersionId),
          },
          RULE_SET_PREPARATION_SYSTEM_ACTOR,
          correlationId ?? randomUUID(),
        ),
      );
    } catch (error) {
      const code = problemCode(error);
      if (code && TERMINAL_REFUSALS.has(code)) {
        this.logger.warn(
          `Rule Set Preparation not started for legal source ${legalSourceVersionId}: ${code}`,
        );
        return;
      }
      throw error;
    }
  }
}

function problemCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  if (!body || typeof body !== "object") return null;
  const problem = (body as { problem?: { code?: unknown } }).problem;
  return typeof problem?.code === "string" ? problem.code : null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
