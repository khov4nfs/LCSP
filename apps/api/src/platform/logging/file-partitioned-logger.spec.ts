import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request } from "express";

const mockMkdirSync = jest.fn();
const mockAppendFileSync = jest.fn();

jest.unstable_mockModule("node:fs", () => ({
  default: {
    mkdirSync: mockMkdirSync,
    appendFileSync: mockAppendFileSync,
    existsSync: () => true,
  },
  mkdirSync: mockMkdirSync,
  appendFileSync: mockAppendFileSync,
  existsSync: () => true,
}));

const { FilePartitionedLogger } = await import("./file-partitioned-logger.js");
const { requestStorage } = await import("./logging-context.js");

describe("FilePartitionedLogger", () => {
  beforeEach(() => {
    mockMkdirSync.mockClear();
    mockAppendFileSync.mockClear();
  });

  it("caches created directories and avoids redundant synchronous mkdir calls", () => {
    const logger = new FilePartitionedLogger("TestContext");

    const mockRequest = {
      params: { assessmentId: "assessment_cache_test" },
      userId: "user_cache_test",
    } as unknown as Request;

    requestStorage.run(mockRequest, () => {
      logger.log("First message");
      logger.log("Second message");
      logger.warn("Warning message");
      logger.error("Error message");
    });

    // mkdirSync should only be called once for this assessment directory
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(mockAppendFileSync).toHaveBeenCalledTimes(4);
  });

  it("does not write to file if assessment context is not active", () => {
    const logger = new FilePartitionedLogger("TestContext");

    logger.log("Unpartitioned message");

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });
});
