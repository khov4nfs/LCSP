import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import type { GitHubAppInstallStateRepository } from "../../ports/persistence/github-app-install-state.repository.js";
import { GitHubAppStartCommand } from "./github-app-start.command.js";
import { GitHubAppStartHandler } from "./github-app-start.handler.js";

const ALLOWED_REDIRECT_URI = "http://localhost:3000/api/github/app/callback";

function buildHandler(options?: {
  assessment?: { id: string } | null;
  repositoryConnection?: { assessmentId: string | null } | null;
}) {
  const save = jest
    .fn<GitHubAppInstallStateRepository["save"]>()
    .mockResolvedValue(undefined);
  const installStateRepository = {
    save,
    findByState: jest
      .fn<GitHubAppInstallStateRepository["findByState"]>()
      .mockResolvedValue(null),
    deleteById: jest
      .fn<GitHubAppInstallStateRepository["deleteById"]>()
      .mockResolvedValue(undefined),
  } as GitHubAppInstallStateRepository;
  const buildInstallationUrl = jest
    .fn<GitHubAppClient["buildInstallationUrl"]>()
    .mockImplementation(
      (input) =>
        `https://github.com/apps/lcsp-app/installations/new?state=${input.state}&redirect_uri=${encodeURIComponent(input.redirectUri)}`,
    );
  const githubAppClient = {
    buildInstallationUrl,
  } as unknown as GitHubAppClient;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write } as unknown as AuditWriterService;
  const configService = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === "github.allowedRedirectUris"
          ? [ALLOWED_REDIRECT_URI]
          : undefined,
      ),
  } as unknown as ConfigService;
  const findUnique = jest
    .fn<() => Promise<{ id: string } | null>>()
    .mockResolvedValue(
      options?.assessment === undefined ? null : options.assessment,
    );
  const findFirst = jest
    .fn<(args: unknown) => Promise<{ assessmentId: string | null } | null>>()
    .mockResolvedValue(
      options?.repositoryConnection === undefined
        ? null
        : options.repositoryConnection,
    );
  const prisma = {
    assessment: { findUnique },
    repositoryConnection: { findFirst },
  } as unknown as PrismaService;

  return {
    handler: new GitHubAppStartHandler(
      installStateRepository,
      githubAppClient,
      auditWriter,
      configService,
      prisma,
    ),
    save,
    write,
    buildInstallationUrl,
    findFirst,
  };
}

describe("GitHubAppStartHandler", () => {
  it("returns an installation URL for an allowlisted redirect", async () => {
    const { handler, save, buildInstallationUrl } = buildHandler();

    const result = await handler.execute(
      new GitHubAppStartCommand(
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
      ),
    );

    expect(result.installation_url).toContain(
      "https://github.com/apps/lcsp-app/installations/new",
    );
    expect(result.correlationId).toBe("corr-1");
    expect(save).toHaveBeenCalledTimes(1);
    expect(buildInstallationUrl).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("state");
  });

  it("rejects a redirect URI outside the allowlist", async () => {
    const { handler, save } = buildHandler();

    await expect(
      handler.execute(
        new GitHubAppStartCommand(
          "user-1",
          "https://evil.example/callback",
          undefined,
          "corr-1",
          "session-1",
        ),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an unresolved assessment binding", async () => {
    const { handler, save } = buildHandler({ assessment: null });

    try {
      await handler.execute(
        new GitHubAppStartCommand(
          "user-1",
          ALLOWED_REDIRECT_URI,
          "assessment-1",
          "corr-1",
          "session-1",
        ),
      );
      throw new Error("expected command to fail");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        problem: {
          code: ASSESSMENT_ERROR_CODES.notFound,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects managed installation updates outside the actor workspace", async () => {
    const { handler, save } = buildHandler({ repositoryConnection: null });

    try {
      await handler.execute(
        new GitHubAppStartCommand(
          "user-1",
          ALLOWED_REDIRECT_URI,
          undefined,
          "corr-1",
          "session-1",
          "installation-other",
        ),
      );
      throw new Error("expected command to fail");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("writes installation-start audit using canonical audit decision", async () => {
    const { handler, write, save } = buildHandler();

    await handler.execute(
      new GitHubAppStartCommand(
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
      ),
    );

    const savedState = save.mock.calls[0][0];
    const event = write.mock.calls[0][0];
    expect(event.eventType).toBe(
      GITHUB_INTEGRATION_EVENT_TYPES.appInstallStarted,
    );
    expect(event.actorId).toBe("user-1");
    expect(event.correlationId).toBe("corr-1");
    expect(event.decision).toBe(AUDIT_DECISIONS.allow);
    expect(JSON.stringify(event.payload)).not.toMatch(savedState.state);
  });
});
