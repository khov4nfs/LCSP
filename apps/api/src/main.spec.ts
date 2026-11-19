import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockApp = {
  get: jest.fn((token: unknown) => {
    return {
      get: jest.fn((key: string) => {
        if (key === "cors") return { allowedOrigins: ["https://example.com"] };
        if (key === "port") return 4000;
        return undefined;
      }),
    };
  }),
  listen: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  use: jest.fn(),
  enableShutdownHooks: jest.fn(),
};

const mockCreate = jest.fn<() => Promise<typeof mockApp>>(() =>
  Promise.resolve(mockApp),
);

jest.unstable_mockModule("@nestjs/core", () => ({
  NestFactory: {
    create: mockCreate,
  },
}));

jest.unstable_mockModule("./app.module.js", () => ({
  AppModule: class FakeAppModule {},
}));

jest.unstable_mockModule(
  "./platform/logging/file-partitioned-logger.js",
  () => ({
    FilePartitionedLogger: class FakeLogger {},
  }),
);

jest.unstable_mockModule("./platform/http/index.js", () => ({
  applyNetworkEdgeMiddleware: jest.fn(),
  httpBodyParser: jest.fn(),
}));

const mainModule = await import("./main.js");

describe("main entrypoint bootstrap", () => {
  beforeEach(() => {
    mockApp.enableShutdownHooks.mockClear();
    mockApp.listen.mockClear();
  });

  it("exports a testable bootstrap function", () => {
    expect(typeof (mainModule as Record<string, unknown>).bootstrap).toBe(
      "function",
    );
  });

  it("enables shutdown hooks on the Nest application for graceful termination", async () => {
    const bootstrapFn = (mainModule as { bootstrap?: () => Promise<unknown> })
      .bootstrap;
    if (typeof bootstrapFn === "function") {
      await bootstrapFn();
      expect(mockApp.enableShutdownHooks).toHaveBeenCalledTimes(1);
    } else {
      expect(bootstrapFn).toBeDefined();
    }
  });
});
