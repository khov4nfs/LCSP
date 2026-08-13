import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";
import { PBAC_DECISION } from "@lcsp/contracts/pbac";
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
  assessment?: { id: string; organizationId: string } | null;
  repositoryConnection?: { assessmentId: string | null } | null;
}) {
  const save = jest
    .fn<GitHubAppInstallStateRepository["save"]>()
    .mockResolvedValue(undefined);
  const findByState = jest
    .fn<GitHubAppInstallStateRepository["findByState"]>()
    .mockResolvedValue(null);
  const deleteById = jest
    .fn<GitHubAppInstallStateRepository["deleteById"]>()
    .mockResolvedValue(undefined);
  const installStateRepository: GitHubAppInstallStateRepository = {
    save,
    findByState,
    deleteById,
  };

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

  const get = jest
    .fn()
    .mockImplementation((key: string) =>
      key === "github.allowedRedirectUris" ? [ALLOWED_REDIRECT_URI] : undefined,
    );
  const configService = { get } as unknown as ConfigService;

  const findUnique = jest
    .fn<() => Promise<{ id: string; organizationId: string } | null>>()
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

  const handler = new GitHubAppStartHandler(
    installStateRepository,
    githubAppClient,
    auditWriter,
    configService,
    prisma,
  );

  return { handler, save, write, buildInstallationUrl, findUnique, findFirst };
}

describe("GitHubAppStartHandler", () => {
  // T01
  it("returns an installation_url with embedded state for a valid allowlisted redirect_uri", async () => {
    const { handler, save, buildInstallationUrl } = buildHandler();

    const result = await handler.execute(
      new GitHubAppStartCommand(
        "org-1",
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
  });

  // T03
  it("throws BadRequestException with INVALID_REDIRECT_URI when redirect_uri is not allowlisted", async () => {
    const { handler, save } = buildHandler();

    await expect(
      handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          "https://evil.example/callback",
          undefined,
          "corr-1",
          "session-1",
        ),
      ),
    ).rejects.toThrow(BadRequestException);

    try {
      await handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          "https://evil.example/callback",
          undefined,
          "corr-1",
          "session-1",
        ),
      );
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.invalidRedirectUri,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("throws BadRequestException with INVALID_REDIRECT_URI when redirect_uri is missing", async () => {
    const { handler, save } = buildHandler();

    await expect(
      handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          undefined,
          undefined,
          "corr-1",
          "session-1",
        ),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  // T04
  it("throws BadRequestException with ASSESSMENT_NOT_FOUND when assessment_id is not in the org", async () => {
    const { handler, save } = buildHandler({
      assessment: { id: "assessment-1", organizationId: "org-other" },
    });

    await expect(
      handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          ALLOWED_REDIRECT_URI,
          "assessment-1",
          "corr-1",
          "session-1",
        ),
      ),
    ).rejects.toThrow(BadRequestException);

    try {
      await handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          ALLOWED_REDIRECT_URI,
          "assessment-1",
          "corr-1",
          "session-1",
        ),
      );
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: ASSESSMENT_ERROR_CODES.notFound,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  // T05
  it("saves a GitHubAppInstallState with a 10-minute expiry", async () => {
    const { handler, save } = buildHandler();
    const before = Date.now();

    await handler.execute(
      new GitHubAppStartCommand(
        "org-1",
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
      ),
    );

    const savedState = save.mock.calls[0][0];
    expect(savedState.organizationId).toBe("org-1");
    expect(savedState.userId).toBe("user-1");
    expect(savedState.redirectUri).toBe(ALLOWED_REDIRECT_URI);
    const ttlMs = savedState.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  it("starts a managed installation update when installation belongs to the actor workspace", async () => {
    const { handler, save, findFirst } = buildHandler({
      repositoryConnection: { assessmentId: "assessment-1" },
      assessment: { id: "assessment-1", organizationId: "org-1" },
    });

    await handler.execute(
      new GitHubAppStartCommand(
        "org-1",
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
        "installation-1",
      ),
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        installationId: "installation-1",
        organizationId: "org-1",
        userId: "user-1",
        revokedAt: null,
      },
      select: { assessmentId: true },
    });
    expect(save.mock.calls[0][0].assessmentId).toBe("assessment-1");
  });

  it("rejects a managed installation update when installation is outside the actor workspace", async () => {
    const { handler, save } = buildHandler({ repositoryConnection: null });

    await expect(
      handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          ALLOWED_REDIRECT_URI,
          undefined,
          "corr-1",
          "session-1",
          "installation-other",
        ),
      ),
    ).rejects.toThrow(BadRequestException);

    try {
      await handler.execute(
        new GitHubAppStartCommand(
          "org-1",
          "user-1",
          ALLOWED_REDIRECT_URI,
          undefined,
          "corr-1",
          "session-1",
          "installation-other",
        ),
      );
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        ok: false,
        problem: {
          code: GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
          correlationId: "corr-1",
        },
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  // T06
  it("does not include the raw state in the returned DTO", async () => {
    const { handler } = buildHandler();

    const result = await handler.execute(
      new GitHubAppStartCommand(
        "org-1",
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
      ),
    );

    expect(result).not.toHaveProperty("state");
  });

  // T08
  it("writes a GITHUB_APP_INSTALL_STARTED audit event with no state value in the payload", async () => {
    const { handler, write, save } = buildHandler();

    await handler.execute(
      new GitHubAppStartCommand(
        "org-1",
        "user-1",
        ALLOWED_REDIRECT_URI,
        undefined,
        "corr-1",
        "session-1",
      ),
    );

    const savedState = save.mock.calls[0][0];
    expect(write).toHaveBeenCalledTimes(1);
    const event = write.mock.calls[0][0];
    expect(event.eventType).toBe(
      GITHUB_INTEGRATION_EVENT_TYPES.appInstallStarted,
    );
    expect(event.actorId).toBe("user-1");
    expect(event.organizationId).toBe("org-1");
    expect(event.correlationId).toBe("corr-1");
    expect(event.decision).toBe(PBAC_DECISION.allow);
    expect(JSON.stringify(event.payload)).not.toMatch(savedState.state);
  });
});
