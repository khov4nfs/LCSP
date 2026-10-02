import { describe, expect, it } from "@jest/globals";

import type { RepositoryProviderAdapter } from "../application/ports/github-repository-provider.port.js";
import { providerOrUnavailable } from "./repository-provider-availability.js";
import { resolveGitLabCliExecutablePath } from "./gitlab/gitlab-cli-runtime.validator.js";

describe("providerOrUnavailable", () => {
  it("returns the built adapter when the executable lookup succeeds", () => {
    const adapter = {} as RepositoryProviderAdapter;
    expect(
      providerOrUnavailable(
        () => adapter,
        () => new Error("x"),
      ),
    ).toBe(adapter);
  });

  it("registers a rejecting adapter when the PATH lookup fails", async () => {
    const provider = providerOrUnavailable(
      () => {
        resolveGitLabCliExecutablePath("", {
          discover: () => {
            throw new Error("not on PATH");
          },
        });
        return {} as RepositoryProviderAdapter;
      },
      () => new Error("client_unavailable"),
    );
    await expect(provider.validateIdentity({} as never)).rejects.toThrow(
      "client_unavailable",
    );
  });
});
