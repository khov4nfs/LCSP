import { describe, expect, it, jest } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import {
  resolveAzureDevOpsCliExecutablePath,
  assertAzureDevOpsCliRuntime,
} from "./azure-devops-cli-runtime.validator.js";

describe("Azure DevOps CLI runtime validation", () => {
  it("resolves az from PATH to an absolute executable path", () => {
    expect(
      resolveAzureDevOpsCliExecutablePath("", {
        discover: () => process.execPath,
      }),
    ).toBe(process.execPath);
  });

  it("preserves an explicit executable override", () => {
    expect(resolveAzureDevOpsCliExecutablePath("/opt/az/bin/az")).toBe(
      "/opt/az/bin/az",
    );
  });

  it("fails clearly when az is not discoverable", () => {
    expect(() =>
      resolveAzureDevOpsCliExecutablePath("", {
        discover: () => {
          throw new Error("not found");
        },
      }),
    ).toThrow(GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable);
  });

  it("validates the supported az runtime", () => {
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `azure-cli 2.60.0 (test)\n`,
    }));
    expect(() =>
      assertAzureDevOpsCliRuntime(process.execPath, { spawn }),
    ).not.toThrow();
    expect(spawn).toHaveBeenCalled();
  });

  it("accepts a root-relative executable with an explicit workspace cwd", () => {
    const access = jest.fn();
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: `azure-cli 2.60.0 (test)\n`,
    }));

    expect(() =>
      assertAzureDevOpsCliRuntime("./.cache/lcsp-cli/azure-devops-cli/bin/az", {
        access,
        cwd: "/workspace/LCSP",
        spawn,
      }),
    ).not.toThrow();
    expect(access).toHaveBeenCalledWith(
      "/workspace/LCSP/.cache/lcsp-cli/azure-devops-cli/bin/az",
      1,
    );
  });

  it("rejects a missing executable", () => {
    expect(() => assertAzureDevOpsCliRuntime("az")).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  });
});
