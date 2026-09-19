import { jest } from "@jest/globals";
import {
  BILLING_RECONCILIATION_EVENT_TYPES,
  BILLING_RECONCILIATION_QUEUE_NAMES,
} from "@lcsp/contracts/billing";

import { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { CommandBus } from "@nestjs/cqrs";
import { ReconcileAcceptedSePayWebhookCommand } from "../../application/commands/reconcile-accepted-sepay-webhook/reconcile-accepted-sepay-webhook.command.js";
import { SePayReconciliationConsumer } from "./sepay-reconciliation-consumer.js";

describe("SePayReconciliationConsumer", () => {
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
    const execute = jest.fn(() => Promise.resolve(null));
    const consumer = new SePayReconciliationConsumer(
      { consume } as unknown as RabbitMqClient,
      { execute } as unknown as CommandBus,
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
    expect(execute).toHaveBeenCalledWith(
      new ReconcileAcceptedSePayWebhookCommand("event-1"),
    );
  });

  it("rejects a work item without an event id", async () => {
    let handler:
      ((payload: Record<string, unknown>) => Promise<void>) | undefined;
    const consumer = new SePayReconciliationConsumer(
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
      { execute: jest.fn() } as unknown as CommandBus,
      { get: () => true } as never,
    );

    consumer.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(handler?.({})).rejects.toThrow(
      "SEPAY_RECONCILIATION_EVENT_ID_INVALID",
    );
  });
});
