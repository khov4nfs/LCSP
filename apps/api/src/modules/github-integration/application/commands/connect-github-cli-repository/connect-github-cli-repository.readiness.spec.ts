import { describe, expect, it } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { RepositoryProviderUnavailableError } from "../../../infrastructure/repository-provider.registry.js";
import { ConnectGitHubCliRepositoryCommand } from "./connect-github-cli-repository.command.js";
import { ConnectGitHubCliRepositoryHandler } from "./connect-github-cli-repository.handler.js";

describe("ConnectGitHubCliRepositoryHandler provider readiness", () => {
  it.each([CREDENTIAL_PROVIDERS.bitbucket, CREDENTIAL_PROVIDERS.azureDevOps])(
    "blocks the legacy direct connection endpoint for disabled provider %s",
    async (provider) => {
      const handler = new ConnectGitHubCliRepositoryHandler(
        { get: () => ({}) } as never,
        {} as never,
        {} as never,
        {} as never,
        {
          get: () => {
            throw new RepositoryProviderUnavailableError();
          },
        },
      );

      let rejection: unknown;
      try {
        await handler.execute(
          new ConnectGitHubCliRepositoryCommand(
            "user-1",
            AUTH_USER_ROLES.customer,
            "session-1",
            "synthetic-provider-token-long-enough",
            "workspace/repository",
            "assessment-1",
            undefined,
            "correlation-1",
            provider,
          ),
        );
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(HttpException);
      expect((rejection as HttpException).getStatus()).toBe(503);
    },
  );
});
