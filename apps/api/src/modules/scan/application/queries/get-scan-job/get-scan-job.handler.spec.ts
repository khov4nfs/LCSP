import { describe, expect, it, jest } from "@jest/globals";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { SCAN_ERROR_CODES, SCAN_JOB_GUIDANCE } from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetScanJobHandler } from "./get-scan-job.handler.js";
import { GetScanJobQuery } from "./get-scan-job.query.js";

const CREATED_AT = new Date("2026-07-18T00:00:00.000Z");
const UPDATED_AT = new Date("2026-07-18T00:01:00.000Z");

function job(
  status: string = REPOSITORY_SCAN_JOB_STATUSES.queued,
): Record<string, unknown> {
  return {
    id: "scan-job-1",
    assessmentId: "assessment-1",
    status,
    triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
    attemptCount: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    correlationId: "job-corr-1",
  };
}

function query(
  overrides: Partial<{
    assessmentId: string;
    scanJobId: string;
    subjectRole: AuthUserRole;
    scope: string | null;
    correlationId: string;
  }> = {},
): GetScanJobQuery {
  return new GetScanJobQuery(
    overrides.assessmentId ?? "assessment-1",
    overrides.scanJobId ?? "scan-job-1",
    overrides.subjectRole ?? AUTH_USER_ROLES.customer,
    overrides.scope ?? null,
    overrides.correlationId ?? "request-corr-1",
  );
}

function buildHandler(record: Record<string, unknown> | null) {
  const findFirst = jest
    .fn<(args: unknown) => Promise<Record<string, unknown> | null>>()
    .mockResolvedValue(record);
  const handler = new GetScanJobHandler({
    repositoryScanJob: { findFirst },
  } as unknown as PrismaService);
  return { handler, findFirst };
}

describe("GetScanJobHandler", () => {
  it("T01/T06 returns a safe queued status projection", async () => {
    const { handler, findFirst } = buildHandler(job());

    const result = await handler.execute(query());

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "scan-job-1",
        assessmentId: "assessment-1",
      },
      select: {
        id: true,
        assessmentId: true,
        status: true,
        triggerSource: true,
        attemptCount: true,
        blockedReason: true,
        createdAt: true,
        updatedAt: true,
        correlationId: true,
      },
    });
    expect(result).toEqual({
      scan_job_id: "scan-job-1",
      assessment_id: "assessment-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      trigger_source: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      attempt_count: 1,
      blocked_reason: null,
      next_action: SCAN_JOB_GUIDANCE.queuedNextAction,
      created_at: CREATED_AT.toISOString(),
      updated_at: UPDATED_AT.toISOString(),
      correlationId: "job-corr-1",
    });
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining([
        "source_code",
        "file_path",
        "stack_trace",
        "raw_output",
      ]),
    );
  });

  it("T02 returns a completed job with no next action", async () => {
    const { handler } = buildHandler(
      job(REPOSITORY_SCAN_JOB_STATUSES.completed),
    );

    const result = await handler.execute(query());

    expect(result.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.completed);
    expect(result.next_action).toBeNull();
    expect(result.blocked_reason).toBeNull();
  });

  it("T03 replaces an untrusted blocked reason with approved business guidance", async () => {
    const record = {
      ...job(REPOSITORY_SCAN_JOB_STATUSES.blocked),
      blockedReason: "Exception at /private/source.py:42 with stack trace",
    };
    const { handler } = buildHandler(record);

    const result = await handler.execute(query());

    expect(result.blocked_reason).toBe(SCAN_JOB_GUIDANCE.blockedReason);
    expect(result.next_action).toBe(SCAN_JOB_GUIDANCE.blockedNextAction);
    expect(JSON.stringify(result)).not.toContain("/private/source.py");
  });

  it("T04 hides missing or cross-scope jobs with SCAN_JOB_NOT_FOUND", async () => {
    const { handler } = buildHandler(null);

    await expect(handler.execute(query())).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: SCAN_ERROR_CODES.jobNotFound,
          correlationId: "request-corr-1",
        },
      },
    });
  });

  it("hides a missing job with a scope-safe 404", async () => {
    const { handler, findFirst } = buildHandler(job());

    await expect(
      handler.execute(
        query({
          subjectRole: AUTH_USER_ROLES.admin,
          scope: "assessment-other",
        }),
      ),
    ).resolves.toMatchObject({ scan_job_id: "scan-job-1" });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns the requested scan job status", async () => {
    const { handler } = buildHandler(job());

    const result = await handler.execute(
      query({
        subjectRole: AUTH_USER_ROLES.admin,
        scope: "assessment-1",
      }),
    );

    expect(result.scan_job_id).toBe("scan-job-1");
  });

  it("uses safe retry guidance for a failed job", async () => {
    const { handler } = buildHandler(job(REPOSITORY_SCAN_JOB_STATUSES.failed));

    const result = await handler.execute(query());

    expect(result.next_action).toBe(SCAN_JOB_GUIDANCE.failedNextAction);
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(
      /\brisk\b|\bseverity\b|stack|exception|source code/,
    );
  });

  it("returns manager-safe next action for a pending mapping state", async () => {
    const { handler } = buildHandler(
      job(REPOSITORY_SCAN_JOB_STATUSES.pendingMapping),
    );

    const result = await handler.execute(query());

    expect(result.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);
    expect(result.blocked_reason).toBe(SCAN_JOB_GUIDANCE.pendingMappingReason);
    expect(result.next_action).toBe(SCAN_JOB_GUIDANCE.pendingMappingNextAction);
  });
});
