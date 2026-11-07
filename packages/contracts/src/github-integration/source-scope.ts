import { z } from "zod";

export const REPOSITORY_SOURCE_PATH_MAX_LENGTH = 1024;

/**
 * Business purpose: Recognize one unambiguous repository-relative source path before pinning or accepting evidence.
 *
 * Business rules:
 * - Paths preserve exact spelling and may contain interior spaces or Unicode; no implicit trimming or decoding is allowed.
 * - Absolute paths, traversal, empty segments, alternate separators, encoded paths and control characters are rejected.
 *
 * Execution flow:
 * 1. Check the bounded string and its leading/trailing whitespace.
 * 2. Reject alternate path interpretations and noncanonical segments.
 *
 * Failure cases:
 * - Invalid or ambiguous input returns false without interpreting it as the repository root.
 *
 * Side effects:
 * - Pure validation; no filesystem, provider or persistence access.
 */
export function isCanonicalRepositorySourcePath(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= REPOSITORY_SOURCE_PATH_MAX_LENGTH &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f\\:%]/u.test(value) &&
    value
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export const repositorySourcePathPrefixSchema = z
  .string()
  .max(REPOSITORY_SOURCE_PATH_MAX_LENGTH)
  .refine(isCanonicalRepositorySourcePath, {
    message:
      "Source scope must be a canonical repository-relative directory path",
  });

/**
 * Business purpose: Keep repository evidence and search scope inside the immutable source directory selected for an assessment.
 *
 * Business rules:
 * - A null prefix preserves whole-repository scope, including the existing "." root search notation.
 * - A scoped path must equal the prefix or start with the prefix followed by a complete path separator.
 * - Malformed paths and prefixes never widen access.
 *
 * Execution flow:
 * 1. Validate the requested repository-relative path.
 * 2. Apply whole-repository compatibility or exact directory-boundary containment.
 *
 * Failure cases:
 * - A sibling prefix, traversal, malformed scope or out-of-scope path returns false.
 *
 * Side effects:
 * - Pure authorization predicate; creates no evidence or repository access.
 */
export function isRepositoryPathInSourceScope(
  path: string,
  sourcePathPrefix: string | null,
): boolean {
  if (sourcePathPrefix === null && path === ".") return true;
  if (!isCanonicalRepositorySourcePath(path)) return false;
  if (sourcePathPrefix === null) return true;
  return (
    isCanonicalRepositorySourcePath(sourcePathPrefix) &&
    (path === sourcePathPrefix || path.startsWith(sourcePathPrefix + "/"))
  );
}
