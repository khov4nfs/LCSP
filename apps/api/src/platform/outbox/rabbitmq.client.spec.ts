import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
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
        options?: unknown,
      ) => boolean
    >
  >;
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
}

interface FakeConnection {
  createChannel: ReturnType<typeof jest.fn<() => Promise<FakeChannel>>>;
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

const { RabbitMqClient } = await import("./rabbitmq.client.js");
const expectedExchange = process.env.RABBITMQ_EXCHANGE ?? "lcsp.events";

function makeChannel(): FakeChannel {
  return {
    assertExchange: jest.fn<
      (exchange: string, type: string, options?: unknown) => Promise<void>
    >(() => Promise.resolve()),
    publish: jest.fn<
      (
        exchange: string,
        routingKey: string,
        content: Buffer,
        options?: unknown,
      ) => boolean
    >(() => true),
    close: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

function makeConnection(channel: FakeChannel): FakeConnection {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    createChannel: jest.fn<() => Promise<FakeChannel>>(() =>
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
    expect(connection.createChannel).toHaveBeenCalledTimes(1);
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
      { contentType: "application/json", persistent: true },
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
      {
        contentType: "application/json",
        persistent: true,
        headers: {
          user_id: "user-1",
          action: "scan:trigger",
        },
      },
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
