import { describe, expect, it, jest } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import {
  resolveGitLabCliExecutablePath,
  SUPPORTED_GITLAB_CLI_VERSION,
  assertGitLabCliRuntime,
} from "./gitlab-cli-runtime.validator.js";

describe("GitLab CLI runtime validation", () => {
  it("resolves glab from PATH to an absolute executable path", () => {
    expect(
      resolveGitLabCliExecutablePath("", { discover: () => process.execPath }),
    ).toBe(process.execPath);
  });

  it("preserves an explicit executable override", () => {
    expect(resolveGitLabCliExecutablePath("/opt/glab/bin/glab")).toBe(
      "/opt/glab/bin/glab",
    );
  });

  it("fails clearly when glab is not discoverable", () => {
    expect(() =>
      resolveGitLabCliExecutablePath("", {
        discover: () => {
          throw new Error("not found");
        },
      }),
    ).toThrow(GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable);
  });

  it("validates the supported glab runtime", () => {
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `glab ${SUPPORTED_GITLAB_CLI_VERSION} (test)\n`,
    }));
    expect(() =>
      assertGitLabCliRuntime(process.execPath, { spawn }),
    ).not.toThrow();
    expect(spawn).toHaveBeenCalled();
  });

  it("accepts a root-relative executable with an explicit workspace cwd", () => {
    const access = jest.fn();
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `glab ${SUPPORTED_GITLAB_CLI_VERSION} (test)\n`,
    }));

    expect(() =>
      assertGitLabCliRuntime("./.cache/lcsp-cli/gitlab-cli/bin/glab", {
        access,
        cwd: "/workspace/LCSP",
        spawn,
      }),
    ).not.toThrow();
    expect(access).toHaveBeenCalledWith(
      "/workspace/LCSP/.cache/lcsp-cli/gitlab-cli/bin/glab",
      1,
    );
  });

  it("rejects a missing executable", () => {
    expect(() => assertGitLabCliRuntime("glab")).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  });
});
