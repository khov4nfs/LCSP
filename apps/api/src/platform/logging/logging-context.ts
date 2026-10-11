import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import * as fs from "node:fs";
import * as path from "node:path";

export const requestStorage: AsyncLocalStorage<Request> =
  new AsyncLocalStorage<Request>();

export function getRepoRoot(): string {
  let currentDir = process.cwd();
  while (currentDir !== path.dirname(currentDir)) {
    if (fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return process.cwd();
}

export async function eraseAssessmentLogs(
  ownerId: string,
  assessmentId: string,
): Promise<void> {
  if (
    ![ownerId, assessmentId].every((value) =>
      /^[A-Za-z0-9_-]{1,300}$/.test(value),
    )
  )
    throw new Error("Invalid assessment log ownership");
  const targets = [...new Set([ownerId, "unknown_user"])].map((userId) =>
    path.join(
      getRepoRoot(),
      "tmp",
      "user_" + userId,
      "assessment_" + assessmentId,
    ),
  );
  for (const target of targets) {
    let current = path.resolve(target);
    while (true) {
      try {
        if ((await fs.promises.lstat(current)).isSymbolicLink())
          throw new Error("Invalid assessment log erasure target");
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          Reflect.get(error, "code") !== "ENOENT"
        )
          throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  for (const target of targets)
    await fs.promises.rm(target, { recursive: true, force: true });
}

export function getLoggingContext(): { userId: string; assessmentId: string } {
  const req = requestStorage.getStore();
  if (!req) {
    return { userId: "unknown_user", assessmentId: "unknown_assessment" };
  }

  const body = req.body as
    { assessmentId?: unknown; userId?: unknown } | undefined;
  const query = req.query as
    { assessmentId?: unknown; userId?: unknown } | undefined;
  const customReq = req as unknown as {
    userId?: unknown;
    rbacContext?: {
      userId?: unknown;
    };
  };

  // Try to find assessmentId
  let assessmentId = "";
  if (typeof req.params?.assessmentId === "string") {
    assessmentId = req.params.assessmentId;
  }
  if (!assessmentId && body && typeof body.assessmentId === "string") {
    assessmentId = body.assessmentId;
  }
  if (!assessmentId && query && typeof query.assessmentId === "string") {
    assessmentId = query.assessmentId;
  }

  if (!assessmentId && req.originalUrl) {
    const match = req.originalUrl.match(/\/assessments?\/([a-zA-Z0-9_-]+)/);
    if (match) {
      assessmentId = match[1];
    }
  }

  // Try to find userId
  let userId = "";
  if (
    customReq.rbacContext &&
    typeof customReq.rbacContext.userId === "string"
  ) {
    userId = customReq.rbacContext.userId;
  }
  if (!userId && typeof customReq.userId === "string") {
    userId = customReq.userId;
  }
  if (!userId && body && typeof body.userId === "string") {
    userId = body.userId;
  }
  if (!userId && query && typeof query.userId === "string") {
    userId = query.userId;
  }

  return {
    userId: userId || "unknown_user",
    assessmentId: assessmentId || "unknown_assessment",
  };
}
