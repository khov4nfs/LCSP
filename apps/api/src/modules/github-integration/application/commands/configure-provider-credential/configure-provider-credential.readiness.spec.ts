import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { RepositoryProviderUnavailableError } from "../../../infrastructure/repository-provider.registry.js";
import { ConfigureProviderCredentialCommand } from "./configure-provider-credential.command.js";
import { ConfigureProviderCredentialHandler } from "./configure-provider-credential.handler.js";

describe("ConfigureProviderCredentialHandler provider readiness", () => {
  it.each([CREDENTIAL_PROVIDERS.bitbucket, CREDENTIAL_PROVIDERS.azureDevOps])(
    "blocks direct credential configuration for disabled provider %s",
    async (provider) => {
      const execute = jest.fn();
      const handler = new ConfigureProviderCredentialHandler(
        { get: () => ({}) } as never,
        { execute } as never,
        {
          get: () => {
            throw new RepositoryProviderUnavailableError();
          },
        },
      );

      let rejection: unknown;
      try {
        await handler.execute(
          new ConfigureProviderCredentialCommand(
            "user-1",
            AUTH_USER_ROLES.customer,
            "session-1",
            provider,
            "synthetic-provider-token-long-enough",
            "correlation-1",
          ),
        );
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(HttpException);
      expect((rejection as HttpException).getStatus()).toBe(503);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
