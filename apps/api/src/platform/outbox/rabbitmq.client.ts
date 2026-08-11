import * as amqp from "amqplib";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

export type RabbitMqMessageHeaders = Record<string, string>;

@Injectable()
export class RabbitMqClient implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqClient.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private connecting: Promise<amqp.Channel> | null = null;

  constructor(private readonly url: string) {}

  async ensureConnected(): Promise<void> {
    await this.getChannel();
  }

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

  private async getChannel(): Promise<amqp.Channel> {
    if (this.channel) {
      return this.channel;
    }

    if (!this.connecting) {
      this.connecting = this.connect();
    }

    return this.connecting;
  }

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
      this.connection = connection;
      this.channel = channel;

      return channel;
    } catch (error) {
      this.resetConnectionState();
      throw error;
    }
  }

  private resetConnectionState(): void {
    this.channel = null;
    this.connection = null;
    this.connecting = null;
  }
}
