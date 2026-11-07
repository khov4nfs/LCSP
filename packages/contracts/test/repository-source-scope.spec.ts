import { describe, expect, it } from "@jest/globals";
import {
  isCanonicalRepositorySourcePath,
  isRepositoryPathInSourceScope,
  repositorySourcePathPrefixSchema,
} from "../src/github-integration/source-scope.ts";

describe("immutable repository source scope", () => {
  it.each([
    "",
    ".",
    "..",
    "/src/app",
    "src/app/",
    "src//app",
    "src/../app",
    "src/./app",
    "src\\app",
    "C:/src/app",
    "src%2fapp",
    " src/app",
    "src/app ",
    "src/\u0000app",
    "src/\napp",
    "src/\u007fapp",
    "x".repeat(1025),
  ])("rejects an ambiguous scope without widening it: %j", (prefix) => {
    expect(repositorySourcePathPrefixSchema.safeParse(prefix).success).toBe(false);
    expect(isRepositoryPathInSourceScope("src/app/file.ts", prefix)).toBe(false);
  });

  it.each(["src/app", "space dir/ứng dụng", "a".repeat(1024)])(
    "preserves an exact canonical directory identity: %j",
    (prefix) => {
      expect(repositorySourcePathPrefixSchema.parse(prefix)).toBe(prefix);
      expect(isRepositoryPathInSourceScope(prefix, prefix)).toBe(true);
      if (prefix.length < 1024) {
        expect(isRepositoryPathInSourceScope(prefix + "/file.ts", prefix)).toBe(true);
      }
    },
  );

  it("requires a complete directory boundary for evidence and search paths", () => {
    const prefix = "src/app";
    expect(isRepositoryPathInSourceScope("src/application/file.ts", prefix)).toBe(false);
    expect(isRepositoryPathInSourceScope("src/app-copy/file.ts", prefix)).toBe(false);
    expect(isRepositoryPathInSourceScope("src/app/file.ts", prefix)).toBe(true);
    expect(isRepositoryPathInSourceScope("src/app/../private.ts", prefix)).toBe(false);
    expect(isRepositoryPathInSourceScope(".", prefix)).toBe(false);
  });

  it("keeps whole-repository compatibility explicit and still rejects malformed paths", () => {
    expect(isRepositoryPathInSourceScope(".", null)).toBe(true);
    expect(isRepositoryPathInSourceScope("other/file.ts", null)).toBe(true);
    expect(isRepositoryPathInSourceScope("../outside.ts", null)).toBe(false);
    expect(isRepositoryPathInSourceScope("/outside.ts", null)).toBe(false);
    expect(isRepositoryPathInSourceScope("src%2Ffile.ts", null)).toBe(false);
    expect(repositorySourcePathPrefixSchema.safeParse(null).success).toBe(false);
  });

  it("does not silently normalize distinct Unicode repository names", () => {
    const composed = "src/caf\u00e9";
    const decomposed = "src/cafe\u0301";
    expect(isCanonicalRepositorySourcePath(composed)).toBe(true);
    expect(isCanonicalRepositorySourcePath(decomposed)).toBe(true);
    expect(isRepositoryPathInSourceScope(composed + "/file.ts", decomposed)).toBe(false);
    expect(repositorySourcePathPrefixSchema.parse(decomposed)).toBe(decomposed);
  });
});
