import { describe, expect, it, jest } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import {
  resolveBitbucketCliExecutablePath,
  SUPPORTED_BITBUCKET_CLI_VERSION,
  assertBitbucketCliRuntime,
} from "./bitbucket-cli-runtime.validator.js";

describe("Bitbucket CLI runtime validation", () => {
  it("resolves bb from PATH to an absolute executable path", () => {
    expect(
      resolveBitbucketCliExecutablePath("", {
        discover: () => process.execPath,
      }),
    ).toBe(process.execPath);
  });

  it("preserves an explicit executable override", () => {
    expect(resolveBitbucketCliExecutablePath("/opt/bb/bin/bb")).toBe(
      "/opt/bb/bin/bb",
    );
  });

  it("fails clearly when bb is not discoverable", () => {
    expect(() =>
      resolveBitbucketCliExecutablePath("", {
        discover: () => {
          throw new Error("not found");
        },
      }),
    ).toThrow(GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable);
  });

  it("validates the supported bb runtime", () => {
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `bb version ${SUPPORTED_BITBUCKET_CLI_VERSION} (test)\n`,
    }));
    expect(() =>
      assertBitbucketCliRuntime(process.execPath, { spawn }),
    ).not.toThrow();
    expect(spawn).toHaveBeenCalled();
  });

  it("accepts a root-relative executable with an explicit workspace cwd", () => {
    const access = jest.fn();
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `bb version ${SUPPORTED_BITBUCKET_CLI_VERSION} (test)\n`,
    }));

    expect(() =>
      assertBitbucketCliRuntime("./.cache/lcsp-cli/bitbucket-cli/bin/bb", {
        access,
        cwd: "/workspace/LCSP",
        spawn,
      }),
    ).not.toThrow();
    expect(access).toHaveBeenCalledWith(
      "/workspace/LCSP/.cache/lcsp-cli/bitbucket-cli/bin/bb",
      1,
    );
  });

  it("rejects a missing executable", () => {
    expect(() => assertBitbucketCliRuntime("bb")).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  });
});
