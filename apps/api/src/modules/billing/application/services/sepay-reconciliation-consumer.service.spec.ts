import { jest } from "@jest/globals";
import {
  BILLING_RECONCILIATION_EVENT_TYPES,
  BILLING_RECONCILIATION_QUEUE_NAMES,
} from "@lcsp/contracts/billing";

import { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { BillingPaymentService } from "./billing-payment.service.js";
import { SePayReconciliationConsumerService } from "./sepay-reconciliation-consumer.service.js";

describe("SePayReconciliationConsumerService", () => {
  it("binds the canonical queue and reconciles only the accepted event id", async () => {
    let handler:
      ((payload: Record<string, unknown>) => Promise<void>) | undefined;
    const consume = jest.fn(
      (input: {
        handler: (payload: Record<string, unknown>) => Promise<void>;
      }) => {
        handler = input.handler;
        return Promise.resolve();
      },
    );
    const reconcileAcceptedWebhook = jest.fn(() => Promise.resolve(null));
    const consumer = new SePayReconciliationConsumerService(
      { consume } as unknown as RabbitMqClient,
      { reconcileAcceptedWebhook } as unknown as BillingPaymentService,
      { get: () => true } as never,
    );

    consumer.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: BILLING_RECONCILIATION_QUEUE_NAMES.sepayWebhookAccepted,
        routingKey: BILLING_RECONCILIATION_EVENT_TYPES.sepayWebhookAccepted,
      }),
    );
    await handler?.({ webhookEventId: "event-1" });
    expect(reconcileAcceptedWebhook).toHaveBeenCalledWith("event-1");
  });

  it("rejects a work item without an event id", async () => {
    let handler:
      ((payload: Record<string, unknown>) => Promise<void>) | undefined;
    const consumer = new SePayReconciliationConsumerService(
      {
        consume: jest.fn(
          (input: {
            handler: (payload: Record<string, unknown>) => Promise<void>;
          }) => {
            handler = input.handler;
            return Promise.resolve();
          },
        ),
      } as unknown as RabbitMqClient,
      {
        reconcileAcceptedWebhook: jest.fn(),
      } as unknown as BillingPaymentService,
      { get: () => true } as never,
    );

    consumer.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(handler?.({})).rejects.toThrow(
      "SEPAY_RECONCILIATION_EVENT_ID_INVALID",
    );
  });
});
