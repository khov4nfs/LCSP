import { jest } from "@jest/globals";
import {
  emitDevUnsafeTrace,
  unsafeDevTraceEnabled,
  unsafeDevUnfilteredEnabled,
} from "./dev-unsafe-trace.js";
import { sanitizeOrchestrationLogValue } from "./orchestration-runtime-log.js";

interface TraceRecord {
  event?: string;
  api_key?: string;
  authorization?: string;
  body_size?: number;
  body_itemCount?: number;
  node_count?: number;
  method?: string;
  statusCode?: number;
  body?: string;
}

describe("dev-unsafe-trace", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("identifies when unsafe dev trace is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.NODE_ENV = "development";
    expect(unsafeDevTraceEnabled()).toBe(true);

    process.env.LCSP_DEV_UNSAFE_TRACE = "false";
    expect(unsafeDevTraceEnabled()).toBe(false);
  });

  it("identifies when unfiltered logging is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    process.env.NODE_ENV = "development";
    expect(unsafeDevUnfilteredEnabled()).toBe(true);

    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    expect(unsafeDevUnfilteredEnabled()).toBe(false);
  });

  it("preserves credentials and summarizes payloads by default", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("TEST_EVENT_RAW", {
      api_key: "secret-key-123",
      authorization: "Bearer some-token",
      body: "a".repeat(100),
      nodes: [1, 2, 3],
      method: "POST",
      statusCode: 200,
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord;

    expect(record.event).toBe("TEST_EVENT");
    expect(record.api_key).toBe("secret-key-123");
    expect(record.authorization).toBe("Bearer some-token");
    expect(record.body_size).toBe(100);
    expect(record.body_itemCount).toBeUndefined();
    expect(record.node_count).toBe(3);
    expect(record.method).toBe("POST");
    expect(record.statusCode).toBe(200);

    writeSpy.mockRestore();
  });

  it("does not redact or summarize when unfiltered is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("TEST_EVENT_RAW", {
      api_key: "secret-key-123",
      body: "hello",
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord;

    expect(record.event).toBe("TEST_EVENT_RAW");
    expect(record.api_key).toBe("secret-key-123");
    expect(record.body).toBe("hello");

    writeSpy.mockRestore();
  });

  it("does not redact orchestration log values when unfiltered is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    process.env.NODE_ENV = "development";

    expect(
      sanitizeOrchestrationLogValue({
        apiKey: "secret-key-123",
        response: { authorization: "Bearer token-123" },
      }),
    ).toEqual({
      apiKey: "secret-key-123",
      response: { authorization: "Bearer token-123" },
    });
  });

  it("logs actual body size from content-length header and dynamic limit for technical profile callback", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("DEV_API_HTTP_REQUEST_RAW", {
      originalUrl: "/internal/evidence/technical-profile-callback",
      headers: {
        "content-length": "3333740",
      },
      body: { some: "payload" },
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord & {
      body_limit?: number;
      body_truncated?: boolean;
    };

    expect(record.body_size).toBe(3333740);
    expect(record.body_limit).toBe(1048576);
    expect(record.body_truncated).toBe(true);

    writeSpy.mockRestore();
  });
});
