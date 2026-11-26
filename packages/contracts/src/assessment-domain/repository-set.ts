import { createHash } from "node:crypto";
import { z } from "zod";
import { repositorySourcePathPrefixSchema } from "../github-integration/source-scope.ts";

/**
 * Limits for the immutable repository set pinned to one Assessment.
 * The default may later be overridden by the capability policy, never by clients.
 */
export const ASSESSMENT_REPOSITORY_LIMITS = {
  maxRepositories: 5,
  maxKeyLength: 40,
} as const;

/**
 * Business purpose: Resolve how many repositories one Assessment may pin right now, so operators can
 * keep the product at a single repository until every runtime stage understands a repository set.
 * Business rules:
 * - The contract maximum is a hard ceiling that configuration can only lower, never raise.
 * - A missing or malformed setting means the contract maximum; zero or negative values mean one repository.
 * Execution flow:
 * 1. Parse the raw setting as an integer.
 * 2. Clamp it between one and the contract maximum.
 * Failure cases:
 * - None; invalid input falls back to the maximum.
 * Side effects:
 * - Pure calculation.
 */
export function resolveRepositoryLimit(raw: string | null | undefined): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return ASSESSMENT_REPOSITORY_LIMITS.maxRepositories;
  return Math.min(
    ASSESSMENT_REPOSITORY_LIMITS.maxRepositories,
    Math.max(1, parsed),
  );
}

/** Error codes raised by repository-set validation, shared by API, web and worker. */
export const REPOSITORY_SET_ERROR_CODES = {
  limitExceeded: "REPOSITORY_SET_LIMIT_EXCEEDED",
  duplicate: "REPOSITORY_SET_DUPLICATE",
  immutable: "REPOSITORY_SET_IMMUTABLE",
  keyUnknown: "REPOSITORY_KEY_UNKNOWN",
  digestStale: "REPOSITORY_SET_DIGEST_STALE",
} as const;

export type RepositorySetErrorCode =
  (typeof REPOSITORY_SET_ERROR_CODES)[keyof typeof REPOSITORY_SET_ERROR_CODES];

/** Fallback slug when a repository name yields no usable characters. */
export const REPOSITORY_KEY_FALLBACK = "repo";

const REPOSITORY_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/iu;

export const repositoryKeySchema = z
  .string()
  .max(ASSESSMENT_REPOSITORY_LIMITS.maxKeyLength)
  .regex(REPOSITORY_KEY_PATTERN);
export type RepositoryKey = z.infer<typeof repositoryKeySchema>;

export const repositorySetDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u);
export type RepositorySetDigest = z.infer<typeof repositorySetDigestSchema>;

/** One immutable repository snapshot pinned to an Assessment. */
export const repositoryPinSchema = z.strictObject({
  repositoryKey: repositoryKeySchema,
  ordinal: z.number().int().min(0),
  connectionId: z.string().min(1),
  repositoryId: z.string().min(1),
  repositoryFullName: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryScanJobId: z.string().min(1),
  repositoryCommit: z.string().regex(COMMIT_SHA_PATTERN),
  sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
});
export type RepositoryPin = z.infer<typeof repositoryPinSchema>;

export const repositorySetSchema = z
  .strictObject({
    repositorySetDigest: repositorySetDigestSchema,
    repositories: z
      .array(repositoryPinSchema)
      .min(1)
      .max(ASSESSMENT_REPOSITORY_LIMITS.maxRepositories),
  })
  .superRefine((value, context) => {
    const keys = new Set<string>();
    const snapshots = new Set<string>();
    value.repositories.forEach((pin, index) => {
      if (pin.ordinal !== index) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index, "ordinal"],
          message: REPOSITORY_SET_ERROR_CODES.duplicate,
        });
      }
      if (keys.has(pin.repositoryKey) || snapshots.has(pin.repositorySnapshotId)) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index],
          message: REPOSITORY_SET_ERROR_CODES.duplicate,
        });
      }
      keys.add(pin.repositoryKey);
      snapshots.add(pin.repositorySnapshotId);
    });
    if (value.repositorySetDigest !== computeRepositorySetDigest(value.repositories)) {
      context.addIssue({
        code: "custom",
        path: ["repositorySetDigest"],
        message: REPOSITORY_SET_ERROR_CODES.digestStale,
      });
    }
  });
export type RepositorySet = z.infer<typeof repositorySetSchema>;

/**
 * Business purpose: Give an Assessment one stable proof that its complete set of pinned
 * repository snapshots has not changed, replacing per-repository snapshot/commit comparisons.
 *
 * Business rules:
 * - The digest covers key, snapshot, lower-cased commit and source scope of every pin, in ordinal order.
 * - Pins are identified by repositoryKey, so reordering ordinals changes the digest on purpose.
 * - The canonical form is shared byte-for-byte with the Python worker; see the shared test vectors.
 *
 * Execution flow:
 * 1. Order pins by ordinal.
 * 2. Serialize `[key, snapshotId, commit, prefix]` tuples as compact JSON.
 * 3. Return the prefixed SHA-256 digest.
 *
 * Failure cases:
 * - An empty pin list throws; an Assessment without repositories has no digest.
 *
 * Side effects:
 * - Pure calculation without cache, persistence, or authorization changes.
 */
export function computeRepositorySetDigest(
  pins: ReadonlyArray<
    Pick<
      RepositoryPin,
      | "repositoryKey"
      | "ordinal"
      | "repositorySnapshotId"
      | "repositoryCommit"
      | "sourcePathPrefix"
    >
  >,
): RepositorySetDigest {
  if (pins.length === 0) {
    throw new Error("repository set digest requires at least one pin");
  }
  const canonical = JSON.stringify(
    [...pins]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((pin) => [
        pin.repositoryKey,
        pin.repositorySnapshotId,
        pin.repositoryCommit.toLowerCase(),
        pin.sourcePathPrefix,
      ]),
  );
  return `sha256:${createHash("sha256").update(canonical, "utf-8").digest("hex")}`;
}

/**
 * Business purpose: Produce the short, stable coordinate that labels one repository inside an
 * Assessment (sandbox directory, evidence coordinate, UI badge).
 *
 * Business rules:
 * - Keys derive from the repository name (last path segment), are lower-case ASCII slugs and
 *   unique per Assessment; the same repository pinned twice (monorepo scopes) gets `-2`, `-3`, ...
 * - A key never exceeds the contract maximum length and never starts with a hyphen.
 *
 * Execution flow:
 * 1. Slugify the last segment of the full name, falling back to a generic slug.
 * 2. Append the smallest numeric suffix that avoids every existing key, truncating the base to fit.
 *
 * Failure cases:
 * - None; the function always returns a valid key.
 *
 * Side effects:
 * - Pure calculation without persistence.
 */
export function deriveRepositoryKey(
  repositoryFullName: string,
  existingKeys: Iterable<string>,
): RepositoryKey {
  const taken = new Set(existingKeys);
  const lastSegment = repositoryFullName.split("/").filter(Boolean).pop() ?? "";
  const slug = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const base = (slug || REPOSITORY_KEY_FALLBACK).slice(
    0,
    ASSESSMENT_REPOSITORY_LIMITS.maxKeyLength,
  ).replace(/-+$/u, "") || REPOSITORY_KEY_FALLBACK;
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base
      .slice(0, ASSESSMENT_REPOSITORY_LIMITS.maxKeyLength - tail.length)
      .replace(/-+$/u, "")}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}
