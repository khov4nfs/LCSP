import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import {
  resolveBitbucketCliExecutablePath,
  SUPPORTED_BITBUCKET_CLI_VERSION,
  assertBitbucketCliRuntime,
} from "./bitbucket-cli-runtime.validator.js";

type BitbucketCliRuntimeDependencies = NonNullable<
  Parameters<typeof assertBitbucketCliRuntime>[1]
>;
type BitbucketCliSpawn = NonNullable<BitbucketCliRuntimeDependencies["spawn"]>;

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
    const spawn = jest.fn<BitbucketCliSpawn>(() => ({
      status: 0,
      stdout: `bb version ${SUPPORTED_BITBUCKET_CLI_VERSION} (test)\n`,
    }));
    expect(() =>
      assertBitbucketCliRuntime(process.execPath, { spawn }),
    ).not.toThrow();
    expect(spawn).toHaveBeenCalled();
  });

  it("uses the Windows command shell for a managed .cmd wrapper", () => {
    const spawn = jest.fn<BitbucketCliSpawn>(() => ({
      status: 0,
      stdout: `bb version ${SUPPORTED_BITBUCKET_CLI_VERSION} (test)\n`,
    }));
    const directory = mkdtempSync(join(tmpdir(), "lcsp-bb-"));
    const executablePath = join(directory, "bb.cmd");
    writeFileSync(executablePath, "@echo off\n", "utf8");
    writeFileSync(join(directory, "bb.mjs"), "", "utf8");

    try {
      expect(() =>
        assertBitbucketCliRuntime(executablePath, { spawn }),
      ).not.toThrow();

      expect(spawn).toHaveBeenLastCalledWith(
        process.platform === "win32" ? process.execPath : executablePath,
        process.platform === "win32"
          ? [join(directory, "bb.mjs"), "--version"]
          : ["--version"],
        expect.objectContaining({ shell: false }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a relative or missing executable", () => {
    expect(() => assertBitbucketCliRuntime("bb")).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  });
});
