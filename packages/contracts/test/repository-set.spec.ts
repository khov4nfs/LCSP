import { readFileSync } from "node:fs";
import {
  ASSESSMENT_REPOSITORY_LIMITS,
  REPOSITORY_SET_ERROR_CODES,
  computeRepositorySetDigest,
  deriveRepositoryKey,
  repositoryKeySchema,
  repositorySetSchema,
  type RepositoryPin,
} from "../src/assessment-domain/repository-set.ts";

const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/repository-set-digest.json", import.meta.url),
    "utf-8",
  ),
) as {
  digestVectors: Array<{
    name: string;
    pins: Parameters<typeof computeRepositorySetDigest>[0];
    digest: string;
  }>;
  keyVectors: Array<{ fullName: string; existing: string[]; key: string }>;
};

function pin(overrides: Partial<RepositoryPin>): RepositoryPin {
  return {
    repositoryKey: "web",
    ordinal: 0,
    connectionId: "conn-1",
    repositoryId: "repo-1",
    repositoryFullName: "acme/web",
    repositorySnapshotId: "snap-a",
    repositoryScanJobId: "job-a",
    repositoryCommit: "a".repeat(40),
    sourcePathPrefix: null,
    ...overrides,
  };
}

describe("repository set contract", () => {
  it.each(vectors.digestVectors)("matches shared digest vector $name", (v) => {
    expect(computeRepositorySetDigest(v.pins)).toBe(v.digest);
  });

  it("is independent of input order but sensitive to ordinals, commits and scopes", () => {
    const [a, b] = [
      pin({}),
      pin({ repositoryKey: "api", ordinal: 1, repositorySnapshotId: "snap-b" }),
    ];
    expect(computeRepositorySetDigest([b, a])).toBe(
      computeRepositorySetDigest([a, b]),
    );
    expect(computeRepositorySetDigest([{ ...a, repositoryCommit: "b".repeat(40) }, b])).not.toBe(
      computeRepositorySetDigest([a, b]),
    );
    expect(computeRepositorySetDigest([{ ...a, sourcePathPrefix: "src" }, b])).not.toBe(
      computeRepositorySetDigest([a, b]),
    );
  });

  it("rejects an empty set", () => {
    expect(() => computeRepositorySetDigest([])).toThrow();
  });

  it.each(vectors.keyVectors)("derives key for $fullName", (v) => {
    const key = deriveRepositoryKey(v.fullName, v.existing);
    expect(key).toBe(v.key);
    expect(repositoryKeySchema.safeParse(key).success).toBe(true);
  });

  it("accepts a valid set and rejects duplicates, bad ordinals and stale digests", () => {
    const pins = [
      pin({}),
      pin({ repositoryKey: "api", ordinal: 1, repositorySnapshotId: "snap-b" }),
    ];
    const valid = {
      repositorySetDigest: computeRepositorySetDigest(pins),
      repositories: pins,
    };
    expect(repositorySetSchema.safeParse(valid).success).toBe(true);

    const duplicate = [pins[0], { ...pins[1], repositoryKey: "web" }];
    const dup = repositorySetSchema.safeParse({
      repositorySetDigest: computeRepositorySetDigest(duplicate),
      repositories: duplicate,
    });
    expect(dup.success).toBe(false);

    const stale = repositorySetSchema.safeParse({
      ...valid,
      repositorySetDigest: `sha256:${"0".repeat(64)}`,
    });
    expect(stale.success).toBe(false);
    expect(JSON.stringify(stale.error?.issues)).toContain(
      REPOSITORY_SET_ERROR_CODES.digestStale,
    );
  });

  it("enforces the repository limit", () => {
    const pins = Array.from(
      { length: ASSESSMENT_REPOSITORY_LIMITS.maxRepositories + 1 },
      (_, i) =>
        pin({
          repositoryKey: `r${i}`,
          ordinal: i,
          repositorySnapshotId: `snap-${i}`,
        }),
    );
    expect(
      repositorySetSchema.safeParse({
        repositorySetDigest: computeRepositorySetDigest(pins),
        repositories: pins,
      }).success,
    ).toBe(false);
  });
});
