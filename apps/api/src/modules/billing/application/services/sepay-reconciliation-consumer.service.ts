import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BILLING_RECONCILIATION_EVENT_TYPES,
  BILLING_RECONCILIATION_QUEUE_NAMES,
} from "@lcsp/contracts/billing";

import { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { BillingPaymentService } from "./billing-payment.service.js";

/** Consumes only accepted, durable reconciliation intents; never webhook HTTP requests. */
@Injectable()
export class SePayReconciliationConsumerService implements OnModuleInit {
  private readonly logger = new Logger(SePayReconciliationConsumerService.name);

  constructor(
    private readonly rabbitMq: RabbitMqClient,
    private readonly payments: BillingPaymentService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>("outbox.enabled", true)) return;
    void this.rabbitMq
      .consume({
        queue: BILLING_RECONCILIATION_QUEUE_NAMES.sepayWebhookAccepted,
        routingKey: BILLING_RECONCILIATION_EVENT_TYPES.sepayWebhookAccepted,
        handler: async (payload) => {
          const eventId = payload.webhookEventId;
          if (typeof eventId !== "string" || eventId.length === 0)
            throw new Error("SEPAY_RECONCILIATION_EVENT_ID_INVALID");
          await this.payments.reconcileAcceptedWebhook(eventId);
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `SePay reconciliation consumer startup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }
}
