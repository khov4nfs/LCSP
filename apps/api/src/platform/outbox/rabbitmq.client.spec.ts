import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { SCAN_EVENT_TYPES } from "@lcsp/contracts/scan/callback";
import { jest } from "@jest/globals";

interface FakeChannel {
  assertExchange: ReturnType<
    typeof jest.fn<
      (exchange: string, type: string, options?: unknown) => Promise<void>
    >
  >;
  publish: ReturnType<
    typeof jest.fn<
      (
        exchange: string,
        routingKey: string,
        content: Buffer,
        options: Record<string, unknown>,
        callback: (error: Error | null) => void,
      ) => boolean
    >
  >;
  on: ReturnType<
    typeof jest.fn<
      (event: string, handler: (...args: unknown[]) => void) => void
    >
  >;
  emit(event: string, ...args: unknown[]): void;
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
}

interface FakeConnection {
  createConfirmChannel: ReturnType<typeof jest.fn<() => Promise<FakeChannel>>>;
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
  on: ReturnType<
    typeof jest.fn<
      (event: string, handler: (...args: unknown[]) => void) => void
    >
  >;
  emit(event: string, ...args: unknown[]): void;
}

const connect = jest.fn<() => Promise<FakeConnection>>();

jest.unstable_mockModule("amqplib", () => ({
  connect,
}));

const { RabbitMqClient, requiresRoutableDelivery } =
  await import("./rabbitmq.client.js");
const expectedExchange = process.env.RABBITMQ_EXCHANGE ?? "lcsp.events";

function makeChannel(): FakeChannel {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    assertExchange: jest.fn<
      (exchange: string, type: string, options?: unknown) => Promise<void>
    >(() => Promise.resolve()),
    publish: jest.fn<
      (
        exchange: string,
        routingKey: string,
        content: Buffer,
        options: Record<string, unknown>,
        callback: (error: Error | null) => void,
      ) => boolean
    >((_exchange, _routingKey, _content, _options, callback) => {
      callback(null);
      return true;
    }),
    on: jest.fn<(event: string, handler: (...args: unknown[]) => void) => void>(
      (event, handler) => {
        handlers[event] ??= [];
        handlers[event].push(handler);
      },
    ),
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers[event] ?? []) {
        handler(...args);
      }
    },
    close: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

function makeConnection(channel: FakeChannel): FakeConnection {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    createConfirmChannel: jest.fn<() => Promise<FakeChannel>>(() =>
      Promise.resolve(channel),
    ),
    close: jest.fn<() => Promise<void>>(() => Promise.resolve()),
    on: jest.fn<(event: string, handler: (...args: unknown[]) => void) => void>(
      (event, handler) => {
        handlers[event] ??= [];
        handlers[event].push(handler);
      },
    ),
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers[event] ?? []) {
        handler(...args);
      }
    },
  };
}

beforeEach(() => {
  connect.mockReset();
});

describe("RabbitMqClient", () => {
  it("connects lazily and reuses the same channel across calls", async () => {
    const channel = makeChannel();
    const connection = makeConnection(channel);
    connect.mockResolvedValue(connection);

    const client = new RabbitMqClient("amqp://fake");
    await client.ensureConnected();
    await client.publish("lcsp.events", ASSESSMENT_EVENT_TYPES.createdOutbox, {
      a: 1,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);
    expect(channel.assertExchange).toHaveBeenCalledWith(
      expectedExchange,
      "topic",
      {
        durable: true,
      },
    );
  });

  it("publishes with the exact exchange, routing key, and JSON payload", async () => {
    const channel = makeChannel();
    const connection = makeConnection(channel);
    connect.mockResolvedValue(connection);

    const client = new RabbitMqClient("amqp://fake");
    await client.publish("lcsp.events", ASSESSMENT_EVENT_TYPES.createdOutbox, {
      foo: "bar",
    });

    expect(channel.publish).toHaveBeenCalledWith(
      "lcsp.events",
      ASSESSMENT_EVENT_TYPES.createdOutbox,
      Buffer.from(JSON.stringify({ foo: "bar" })),
      expect.objectContaining({
        contentType: "application/json",
        persistent: true,
        mandatory: false,
        messageId: expect.any(String) as unknown,
      }),
      expect.any(Function),
    );
  });

  it("forwards authorization headers to RabbitMQ", async () => {
    const channel = makeChannel();
    connect.mockResolvedValue(makeConnection(channel));
    const client = new RabbitMqClient("amqp://fake");

    await client.publish(
      "lcsp.events",
      ASSESSMENT_EVENT_TYPES.createdOutbox,
      { foo: "bar" },
      { user_id: "user-1", action: "scan:trigger" },
    );

    expect(channel.publish).toHaveBeenCalledWith(
      "lcsp.events",
      ASSESSMENT_EVENT_TYPES.createdOutbox,
      Buffer.from(JSON.stringify({ foo: "bar" })),
      expect.objectContaining({
        contentType: "application/json",
        persistent: true,
        mandatory: false,
        messageId: expect.any(String) as unknown,
        headers: {
          user_id: "user-1",
          action: "scan:trigger",
        },
      }),
      expect.any(Function),
    );
  });

  it("throws when the channel reports publish backpressure", async () => {
    const channel = makeChannel();
    channel.publish.mockReturnValue(false);
    const connection = makeConnection(channel);
    connect.mockResolvedValue(connection);

    const client = new RabbitMqClient("amqp://fake");

    await expect(
      client.publish("lcsp.events", ASSESSMENT_EVENT_TYPES.createdOutbox, {}),
    ).rejects.toThrow(/backpressure/i);
  });

  it("requires routing only for delivery-critical boundary messages", () => {
    expect(requiresRoutableDelivery(ASSESSMENT_EVENT_TYPES.createdOutbox)).toBe(
      false,
    );
    expect(
      requiresRoutableDelivery("event.repository-snapshot.created.v1"),
    ).toBe(false);
    expect(requiresRoutableDelivery("command.scan.requested.v1")).toBe(true);
    expect(
      requiresRoutableDelivery("command.scan.targeted-reanalysis.v1"),
    ).toBe(true);
    expect(requiresRoutableDelivery(SCAN_EVENT_TYPES.evidenceAccepted)).toBe(
      true,
    );
    expect(
      requiresRoutableDelivery("cron.legal-catalog.check-updates.v1"),
    ).toBe(true);
  });

  it("throws when RabbitMQ returns an unroutable mandatory publication", async () => {
    const channel = makeChannel();
    channel.publish.mockImplementation(
      (_exchange, routingKey, _content, options, callback) => {
        channel.emit("return", {
          fields: { routingKey },
          properties: { messageId: options.messageId },
        });
        callback(null);
        return true;
      },
    );
    connect.mockResolvedValue(makeConnection(channel));
    const client = new RabbitMqClient("amqp://fake");

    await expect(
      client.publish("lcsp.events", "command.scan.requested.v1", {}),
    ).rejects.toThrow(/unroutable/i);
  });

  it("reconnects after the connection emits close", async () => {
    const channelA = makeChannel();
    const connectionA = makeConnection(channelA);
    const channelB = makeChannel();
    const connectionB = makeConnection(channelB);
    connect
      .mockResolvedValueOnce(connectionA)
      .mockResolvedValueOnce(connectionB);

    const client = new RabbitMqClient("amqp://fake");
    await client.ensureConnected();
    connectionA.emit("close");
    await client.ensureConnected();

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("propagates connection failure to ensureConnected without caching a broken state", async () => {
    connect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = new RabbitMqClient("amqp://fake");

    await expect(client.ensureConnected()).rejects.toThrow("ECONNREFUSED");

    const connection = makeConnection(makeChannel());
    connect.mockResolvedValueOnce(connection);
    await client.ensureConnected();

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("closes the channel and connection on module destroy", async () => {
    const channel = makeChannel();
    const connection = makeConnection(channel);
    connect.mockResolvedValue(connection);

    const client = new RabbitMqClient("amqp://fake");
    await client.ensureConnected();
    await client.onModuleDestroy();

    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
