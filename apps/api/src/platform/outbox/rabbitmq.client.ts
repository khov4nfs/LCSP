import * as amqp from "amqplib";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { emitDevUnsafeTrace } from "../logging/dev-unsafe-trace.js";

export type RabbitMqMessageHeaders = Record<string, string>;

export function requiresRoutableDelivery(routingKey: string): boolean {
  return routingKey.startsWith("command.") || routingKey.startsWith("cron.");
}
export type RabbitMqConsumerInput = {
  queue: string;
  routingKey: string;
  handler(payload: Record<string, unknown>): Promise<void>;
};

/**
 * Manages a reusable RabbitMQ connection/channel and publishes persistent JSON event messages.
 */
@Injectable()
export class RabbitMqClient implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqClient.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private connecting: Promise<amqp.ConfirmChannel> | null = null;
  private readonly returnedMessageIds = new Set<string>();
  private readonly exchangeType = "topic";

  /**
   * Creates the RabbitMQ client for a configured broker URL and optional topic exchange name.
   *
   * Rationale: Allows ConfigService-driven exchange configuration via Nest DI without
   * relying on spontaneous process.env reads, enabling multi-tenant isolation and hermetic testing.
   * Mechanism: Stores the optional exchangeName in the instance for lazy channel assertion.
   * Invariants: Preserves backwards compatibility for existing call sites with a default fallback.
   *
   * @param url - AMQP connection URL used when opening the broker connection.
   * @param exchangeName - Optional topic exchange name resolved from AppConfig.
   */
  constructor(
    private readonly url: string,
    private readonly exchangeName?: string,
  ) {}

  /**
   * Ensures that a usable RabbitMQ channel has been established.
   *
   * @returns A promise that resolves once the channel is ready.
   */
  async ensureConnected(): Promise<void> {
    await this.getChannel();
  }

  /**
   * Publishes a persistent JSON message to a topic exchange.
   *
   * In unsafe development trace mode the exact broker URL, exchange, routing key,
   * headers, payload, serialized body, and publish-buffer result are emitted before
   * any downstream worker sees the message.
   *
   * @param exchange - RabbitMQ exchange name.
   * @param routingKey - Topic routing key for the event.
   * @param payload - Structured event payload serialized as JSON.
   * @param headers - Optional string headers propagated with the message.
   * @returns A promise that resolves after RabbitMQ confirms the publication.
   * @throws When RabbitMQ rejects/cannot confirm, or a delivery-critical route is unroutable.
   */
  async publish(
    exchange: string,
    routingKey: string,
    payload: Record<string, unknown>,
    headers?: RabbitMqMessageHeaders,
  ): Promise<void> {
    const channel = await this.getChannel();
    const content = Buffer.from(JSON.stringify(payload));
    const messageId = randomUUID();
    const mandatory = requiresRoutableDelivery(routingKey);

    emitDevUnsafeTrace("DEV_API_AMQP_PUBLISH_REQUEST_RAW", {
      brokerUrl: this.url,
      exchange,
      routingKey,
      headers,
      payload,
      serializedBody: content.toString("utf8"),
      byteLength: content.byteLength,
      mandatory,
    });

    let confirmPublish!: () => void;
    let rejectPublish!: (error: Error) => void;
    const confirmed = new Promise<void>((resolve, reject) => {
      confirmPublish = resolve;
      rejectPublish = reject;
    });
    const accepted = channel.publish(
      exchange,
      routingKey,
      content,
      {
        contentType: "application/json",
        persistent: true,
        mandatory,
        messageId,
        ...(headers ? { headers } : {}),
      },
      (error: unknown) => {
        if (error) {
          rejectPublish(
            error instanceof Error
              ? error
              : new Error("RabbitMQ publish was not confirmed"),
          );
          return;
        }
        confirmPublish();
      },
    );

    emitDevUnsafeTrace("DEV_API_AMQP_PUBLISH_RESULT_RAW", {
      brokerUrl: this.url,
      exchange,
      routingKey,
      headers,
      payload,
      accepted,
      mandatory,
    });

    if (!accepted) {
      throw new Error(
        `RabbitMQ channel backpressure: publish buffer full for exchange="${exchange}"`,
      );
    }
    await confirmed;
    if (mandatory && this.returnedMessageIds.delete(messageId)) {
      throw new Error(
        `RabbitMQ unroutable publication for exchange="${exchange}" routingKey="${routingKey}"`,
      );
    }
  }

  /**
   * Binds a durable work queue and acknowledges only after its handler commits.
   * Handler failures are requeued; domain-level idempotency remains mandatory.
   */
  async consume(input: RabbitMqConsumerInput): Promise<void> {
    const channel = await this.getChannel();
    const exchange = this.resolveExchangeName();
    await channel.assertQueue(input.queue, { durable: true });
    await channel.bindQueue(input.queue, exchange, input.routingKey);
    await channel.prefetch(1);
    await channel.consume(
      input.queue,
      (message) => {
        if (!message) return;
        void this.handleConsumedMessage(channel, message, input);
      },
      { noAck: false },
    );
  }

  /**
   * Dispatches an incoming AMQP message to the registered handler with poison-pill protection.
   *
   * Rationale (Why): Prevents infinite requeue loops (poison pills) that saturate CPU and block
   * queues when messages are malformed or repeatedly fail processing.
   * Mechanism (How):
   * 1. Validates JSON parsing and payload object structure. Malformed messages are nacked with
   *    `requeue: false` immediately, directing them to Dead Letter Queue (DLQ) or discard.
   * 2. If handler execution fails, evaluates `message.fields.redelivered`. If already redelivered,
   *    nacks with `requeue: false` to terminate the poison pill loop; if first attempt, allows one
   *    transient retry with `requeue: true`.
   * Invariants (What): Malformed payloads are never requeued; delivery attempts are bounded.
   */
  private async handleConsumedMessage(
    channel: amqp.Channel,
    message: amqp.ConsumeMessage,
    input: RabbitMqConsumerInput,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("RABBITMQ_CONSUMER_PAYLOAD_INVALID");
      }
    } catch (parseError) {
      // Rationale (Why): Malformed JSON or non-object payloads are non-transient defects.
      // Requeuing them causes an immediate infinite busy-loop spinning at 100% CPU.
      // Mechanism (How): Nack with requeue: false to route to DLQ or discard.
      // Invariants (What): Invalid payloads are terminated without requeuing.
      this.logger.error(
        `RabbitMQ consumer malformed payload queue=${input.queue}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      await input.handler(parsed as Record<string, unknown>);
      channel.ack(message);
    } catch (error) {
      // Rationale (Why): Guard against poison pill crashes in downstream handler logic.
      // Mechanism (How): Check message.fields.redelivered. If true, nack with requeue: false.
      // If false (first attempt), allow one transient retry with requeue: true.
      // Invariants (What): Prevents repeated infinite loop on redelivered messages.
      const isRedelivered = message.fields.redelivered === true;
      this.logger.error(
        `RabbitMQ consumer failed queue=${input.queue} redelivered=${isRedelivered}: ${error instanceof Error ? error.message : String(error)}`,
      );
      channel.nack(message, false, !isRedelivered);
    }
  }

  /**
   * Closes the cached channel and connection during Nest module shutdown.
   *
   * @returns A promise that resolves after best-effort cleanup completes.
   */
  async onModuleDestroy(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    this.connecting = null;

    try {
      await channel?.close();
    } catch {
      // Best-effort cleanup — the connection is going away regardless.
    }

    try {
      await connection?.close();
    } catch {
      // Best-effort cleanup — the connection is going away regardless.
    }
  }

  /**
   * Returns the active channel or shares a single in-flight connection attempt among callers.
   *
   * @returns Active or newly established RabbitMQ channel.
   */
  private async getChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) {
      return this.channel;
    }

    if (!this.connecting) {
      this.connecting = this.connect();
    }

    return this.connecting;
  }

  /**
   * Opens the RabbitMQ connection, creates a channel, and asserts the configured topic exchange.
   *
   * @returns Newly created RabbitMQ channel.
   */
  private async connect(): Promise<amqp.ConfirmChannel> {
    try {
      emitDevUnsafeTrace("DEV_API_AMQP_CONNECT_RAW", {
        brokerUrl: this.url,
        exchange: this.resolveExchangeName(),
        exchangeType: this.exchangeType,
      });
      const connection = await amqp.connect(this.url);

      connection.on("error", (error: Error) => {
        emitDevUnsafeTrace("DEV_API_AMQP_CONNECTION_ERROR_RAW", {
          brokerUrl: this.url,
          error,
        });
        this.logger.error(`RabbitMQ connection error: ${error.message}`);
        this.resetConnectionState();
      });
      connection.on("close", () => {
        emitDevUnsafeTrace("DEV_API_AMQP_CONNECTION_CLOSED_RAW", {
          brokerUrl: this.url,
        });
        this.resetConnectionState();
      });

      const channel = await connection.createConfirmChannel();
      channel.on("return", (message: amqp.Message) => {
        const returnedMessageId: unknown = message.properties.messageId;
        if (typeof returnedMessageId === "string" && returnedMessageId) {
          this.returnedMessageIds.add(returnedMessageId);
        }
      });
      await channel.assertExchange(
        this.resolveExchangeName(),
        this.exchangeType,
        {
          durable: true,
        },
      );
      this.connection = connection;
      this.channel = channel;

      emitDevUnsafeTrace("DEV_API_AMQP_CONNECTED_RAW", {
        brokerUrl: this.url,
        exchange: this.resolveExchangeName(),
        exchangeType: this.exchangeType,
      });
      return channel;
    } catch (error) {
      emitDevUnsafeTrace("DEV_API_AMQP_CONNECT_ERROR_RAW", {
        brokerUrl: this.url,
        error,
      });
      this.resetConnectionState();
      throw error;
    }
  }

  /**
   * Clears all cached connection state so a future operation can reconnect cleanly.
   */
  private resetConnectionState(): void {
    this.channel = null;
    this.connection = null;
    this.connecting = null;
  }

  /**
   * Resolves the exchange name used when asserting the publisher channel.
   *
   * Rationale: Prioritizes explicit runtime configuration injected via constructor over
   * spontaneous process.env access, ensuring hermetic test environments and tenant isolation.
   * Mechanism: Checks instance exchangeName property first, then process.env, finally "lcsp.events".
   *
   * @returns Exchange name from runtime configuration, environment, or the default LCSP event exchange.
   */
  private resolveExchangeName(): string {
    return this.exchangeName || process.env.RABBITMQ_EXCHANGE || "lcsp.events";
  }
}
