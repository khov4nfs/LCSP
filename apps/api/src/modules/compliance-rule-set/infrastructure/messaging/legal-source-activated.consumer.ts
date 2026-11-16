import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { LEGAL_SOURCE_EVENT_TYPES } from "@lcsp/contracts/legal-source";
import { RULE_SET_PREPARATION_QUEUE_NAMES } from "@lcsp/contracts/compliance-rule-set";
import { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";

/** Source activation supplies selectable source inputs; explicit Admin selection owns preparation. */
@Injectable()
export class LegalSourceActivatedConsumer implements OnModuleInit {
  private readonly logger = new Logger(LegalSourceActivatedConsumer.name);
  constructor(private readonly rabbitMq: RabbitMqClient) {}

  onModuleInit(): void {
    void this.rabbitMq
      .consume({
        queue: RULE_SET_PREPARATION_QUEUE_NAMES.legalSourceActivated,
        routingKey: LEGAL_SOURCE_EVENT_TYPES.legalSourceVersionActivated,
        handler: (payload) => this.handle(payload),
      })
      .catch(() =>
        this.logger.error("Legal Source activation listener unavailable"),
      );
  }

  /**
   * Business purpose: Acknowledge chunked source availability without implicitly preparing rules.
   * Business rules:
   * - Activation never authors canonical catalog rules, selects rules or dispatches model work.
   * Execution flow:
   * 1. Validate source event identity
   * 2. Record source availability for explicit Admin selection.
   * Failure cases:
   * - Malformed activation is logged and acknowledged because redelivery cannot fix it.
   * Side effects:
   * - A safe availability log only; no database writes, preparation artifacts or model calls.
   */
  async handle(payload: Record<string, unknown>): Promise<void> {
    const parsed = z
      .object({ legalSourceVersionId: z.string().uuid() })
      .safeParse(payload);
    if (!parsed.success) {
      this.logger.error(
        "Legal Source activation event has no legalSourceVersionId",
      );
      return;
    }
    this.logger.log(
      `Source ${parsed.data.legalSourceVersionId} is available for explicit Legal Rule selection`,
    );
  }
}
