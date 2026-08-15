import * as amqp from "amqplib";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

export type RabbitMqMessageHeaders = Record<string, string>;

/**
 * Manages a reusable RabbitMQ connection/channel and publishes persistent JSON event messages.
 */
@Injectable()
export class RabbitMqClient implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqClient.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private connecting: Promise<amqp.Channel> | null = null;
  private readonly exchangeType = "topic";

  /**
   * Creates the RabbitMQ client for a configured broker URL.
   *
   * @param url - AMQP connection URL used when opening the broker connection.
   */
  constructor(private readonly url: string) {}

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
   * @param exchange - RabbitMQ exchange name.
   * @param routingKey - Topic routing key for the event.
   * @param payload - Structured event payload serialized as JSON.
   * @param headers - Optional string headers propagated with the message.
   * @returns A promise that resolves after the message is accepted into the channel buffer.
   * @throws When RabbitMQ applies channel backpressure and rejects the publish buffer write.
   */
  async publish(
    exchange: string,
    routingKey: string,
    payload: Record<string, unknown>,
    headers?: RabbitMqMessageHeaders,
  ): Promise<void> {
    const channel = await this.getChannel();
    const content = Buffer.from(JSON.stringify(payload));
    const accepted = channel.publish(exchange, routingKey, content, {
      contentType: "application/json",
      persistent: true,
      ...(headers ? { headers } : {}),
    });

    if (!accepted) {
      throw new Error(
        `RabbitMQ channel backpressure: publish buffer full for exchange="${exchange}"`,
      );
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
  private async getChannel(): Promise<amqp.Channel> {
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
  private async connect(): Promise<amqp.Channel> {
    try {
      const connection = await amqp.connect(this.url);

      connection.on("error", (error: Error) => {
        this.logger.error(`RabbitMQ connection error: ${error.message}`);
        this.resetConnectionState();
      });
      connection.on("close", () => {
        this.resetConnectionState();
      });

      const channel = await connection.createChannel();
      await channel.assertExchange(
        this.resolveExchangeName(),
        this.exchangeType,
        {
          durable: true,
        },
      );
      this.connection = connection;
      this.channel = channel;

      return channel;
    } catch (error) {
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
   * @returns Exchange name from the environment, or the default LCSP event exchange.
   */
  private resolveExchangeName(): string {
    return process.env.RABBITMQ_EXCHANGE ?? "lcsp.events";
  }
}
