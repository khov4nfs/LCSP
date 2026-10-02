import { RabbitMqClient } from "../../src/platform/outbox/rabbitmq.client.js";

/** No-op broker used by every test that boots AppModule: the outbox publisher and consumers always run, so nothing may reach a real RabbitMQ. */
export const RABBITMQ_STUB = {
  ensureConnected: () => Promise.resolve(),
  publish: () => Promise.resolve(),
  consume: () => Promise.resolve(),
  onModuleDestroy: () => Promise.resolve(),
};

/** Replaces the RabbitMqClient methods for the whole e2e worker (see jest-e2e.ts setupFiles). */
export function stubRabbitMqClientGlobally(): void {
  Object.assign(RabbitMqClient.prototype, RABBITMQ_STUB);
}
