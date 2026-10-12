import { jest } from "@jest/globals";
import { ConsoleLogger } from "@nestjs/common";
import type { Request } from "express";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { eraseAssessmentLogs, requestStorage } from "./logging-context.js";
import { FilePartitionedLogger } from "./file-partitioned-logger.js";

describe("assessment-private log retention", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "release-log-erasure-"));
    await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages: []");
    jest.spyOn(process, "cwd").mockReturnValue(root);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function logDirectory(user: string, assessment: string) {
    const directory = path.join(
      root,
      "tmp",
      "user_" + user,
      "assessment_" + assessment,
    );
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "run.log"),
      "synthetic private content",
    );
    return directory;
  }

  it("erases owner and early unattributed-owner logs idempotently; another assessment survives", async () => {
    const own = await logDirectory("owner", "owned");
    const early = await logDirectory("unknown_user", "owned");
    const other = await logDirectory("owner", "another");
    await eraseAssessmentLogs("owner", "owned");
    await eraseAssessmentLogs("owner", "owned");
    await expect(fs.stat(own)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(early)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(other, "run.log"), "utf8")).toBe(
      "synthetic private content",
    );
  });

  it("validates every target before erasing anything when an early-owner path is a symlink", async () => {
    const own = await logDirectory("owner", "owned");
    const other = await logDirectory("other", "another");
    await fs.symlink(
      path.dirname(other),
      path.join(root, "tmp/user_unknown_user"),
      "dir",
    );
    await expect(eraseAssessmentLogs("owner", "owned")).rejects.toThrow(
      "Invalid assessment log erasure target",
    );
    expect(await fs.readFile(path.join(own, "run.log"), "utf8")).toBe(
      "synthetic private content",
    );
    expect(await fs.readFile(path.join(other, "run.log"), "utf8")).toBe(
      "synthetic private content",
    );
  });

  it("rejects path traversal", async () => {
    await expect(eraseAssessmentLogs("../other", "owned")).rejects.toThrow(
      "Invalid assessment log ownership",
    );
  });

  it("does not persist an unattributed shared log; attributed logs remain deletable", async () => {
    jest
      .spyOn(ConsoleLogger.prototype, "log")
      .mockImplementation(() => undefined);
    const logger = new FilePartitionedLogger();
    logger.log("synthetic unattributed activity");
    await expect(fs.stat(path.join(root, "tmp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    requestStorage.run(
      {
        params: { assessmentId: "owned" },
        userId: "owner",
      } as unknown as Request,
      () => logger.log("synthetic assessment activity"),
    );
    expect(
      await fs.readFile(
        path.join(root, "tmp/user_owner/assessment_owned/run.log"),
        "utf8",
      ),
    ).toContain("synthetic assessment activity");
    await eraseAssessmentLogs("owner", "owned");
    await expect(
      fs.stat(path.join(root, "tmp/user_owner/assessment_owned")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
