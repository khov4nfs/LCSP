import { ConsoleLogger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getLoggingContext, getRepoRoot } from "./logging-context.js";

export class FilePartitionedLogger extends ConsoleLogger {
  override log(message: unknown, ...optionalParams: unknown[]) {
    super.log(message, ...optionalParams);
    this.writeToFile("run.log", message, optionalParams);
  }

  override error(message: unknown, ...optionalParams: unknown[]) {
    super.error(message, ...optionalParams);
    this.writeToFile("run.log", message, optionalParams);
  }

  override warn(message: unknown, ...optionalParams: unknown[]) {
    super.warn(message, ...optionalParams);
    this.writeToFile("run.log", message, optionalParams);
  }

  override debug(message: unknown, ...optionalParams: unknown[]) {
    super.debug(message, ...optionalParams);
    this.writeToFile("run.log", message, optionalParams);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]) {
    super.verbose(message, ...optionalParams);
    this.writeToFile("run.log", message, optionalParams);
  }

  private writeToFile(
    filename: string,
    message: unknown,
    optionalParams: unknown[],
  ) {
    try {
      const { userId, assessmentId } = getLoggingContext();
      const repoRoot = getRepoRoot();
      const logDir = path.join(
        repoRoot,
        "tmp",
        `user_${userId}`,
        `assessment_${assessmentId}`,
      );
      fs.mkdirSync(logDir, { recursive: true });

      const context = optionalParams[optionalParams.length - 1];
      const contextStr = typeof context === "string" ? ` [${context}]` : "";
      let messageStr = "";
      if (typeof message === "string") {
        messageStr = message;
      } else if (message instanceof Error) {
        messageStr = message.stack || message.message;
      } else if (
        typeof message === "number" ||
        typeof message === "boolean" ||
        typeof message === "bigint" ||
        typeof message === "symbol"
      ) {
        messageStr = String(message);
      } else if (message !== null && message !== undefined) {
        messageStr = JSON.stringify(message);
      }

      const logLine = `[${new Date().toISOString()}] ${messageStr}${contextStr}\n`;
      fs.appendFileSync(path.join(logDir, filename), logLine, "utf8");
    } catch {
      // Ignore write errors to keep logging non-fatal
    }
  }
}
