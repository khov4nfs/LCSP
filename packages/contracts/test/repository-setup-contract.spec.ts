import {
  assessmentRepositorySetupSchema,
  completeAssessmentRepositorySetupBodySchema,
  completeAssessmentRepositorySetupRequestSchema,
  completeAssessmentRepositorySetupResultSchema,
  removeAssessmentRepositoryResultSchema,
} from "../src/assessment-domain/schemas.ts";
import {
  ASSESSMENT_REPOSITORY_LIMITS,
  resolveRepositoryLimit,
} from "../src/assessment-domain/repository-set.ts";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const commit = "a".repeat(40);

describe("resolveRepositoryLimit", () => {
  it("defaults to the contract maximum and only ever lowers it", () => {
    const max = ASSESSMENT_REPOSITORY_LIMITS.maxRepositories;
    expect(resolveRepositoryLimit(undefined)).toBe(max);
    expect(resolveRepositoryLimit(null)).toBe(max);
    expect(resolveRepositoryLimit("")).toBe(max);
    expect(resolveRepositoryLimit("not-a-number")).toBe(max);
    expect(resolveRepositoryLimit("2")).toBe(2);
    expect(resolveRepositoryLimit(" 3 ")).toBe(3);
    expect(resolveRepositoryLimit("999")).toBe(max);
  });

  it("never drops below one repository", () => {
    expect(resolveRepositoryLimit("0")).toBe(1);
    expect(resolveRepositoryLimit("-4")).toBe(1);
  });
});

describe("repository setup contracts", () => {
  it("reads an answer from an older API (no repository list) with safe defaults", () => {
    const parsed = assessmentRepositorySetupSchema.parse({
      assessmentId,
      lifecycle: null,
      connection: null,
      snapshot: null,
      scanJob: null,
    });
    expect(parsed.repositories).toEqual([]);
    expect(parsed.repositorySetDigest).toBeNull();
    expect(parsed.repositoryLimit).toBe(1);
    expect(parsed.setupCompleted).toBe(false);
  });

  it("rejects a repository limit above the contract maximum", () => {
    expect(
      assessmentRepositorySetupSchema.safeParse({
        assessmentId,
        lifecycle: null,
        connection: null,
        snapshot: null,
        scanJob: null,
        repositoryLimit: ASSESSMENT_REPOSITORY_LIMITS.maxRepositories + 1,
      }).success,
    ).toBe(false);
  });

  it("limits the snapshots a completion may name to one through the maximum, with no unknown fields", () => {
    const schema = completeAssessmentRepositorySetupRequestSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ snapshotIds: ["s1"] }).success).toBe(true);
    expect(schema.safeParse({ snapshotIds: [] }).success).toBe(false);
    expect(
      schema.safeParse({
        snapshotIds: Array.from(
          { length: ASSESSMENT_REPOSITORY_LIMITS.maxRepositories + 1 },
          (_, index) => `s${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ snapshotIds: ["s1"], extra: 1 }).success).toBe(
      false,
    );
  });

  it("reads a missing body as no explicit snapshot list on the wire", () => {
    const wire = completeAssessmentRepositorySetupBodySchema;
    expect(wire.parse(null)).toEqual({});
    expect(wire.parse(undefined)).toEqual({});
    expect(wire.parse({ snapshotIds: ["s1"] })).toEqual({ snapshotIds: ["s1"] });
    expect(wire.safeParse({ snapshotIds: [] }).success).toBe(false);
  });

  it("keeps the single-repository completion answer valid and carries the pinned set when present", () => {
    const legacy = completeAssessmentRepositorySetupResultSchema.parse({
      assessment_id: assessmentId,
      repository_connection_id: "conn-1",
      snapshot_id: "snap-1",
      commit_sha: commit,
    });
    expect(legacy.repositories).toEqual([]);

    const set = completeAssessmentRepositorySetupResultSchema.parse({
      assessment_id: assessmentId,
      repository_connection_id: "conn-1",
      snapshot_id: "snap-1",
      commit_sha: commit,
      repository_set_digest: `sha256:${"b".repeat(64)}`,
      repositories: [
        {
          repository_key: "web",
          connection_id: "conn-1",
          snapshot_id: "snap-1",
          commit_sha: commit,
        },
      ],
    });
    expect(set.repositories[0]?.repository_key).toBe("web");
    expect(
      completeAssessmentRepositorySetupResultSchema.safeParse({
        ...set,
        repositories: [{ ...set.repositories[0], repository_key: "Bad Key" }],
      }).success,
    ).toBe(false);
  });

  it("describes a removal by its snapshot, connection and whether the connection was revoked", () => {
    expect(
      removeAssessmentRepositoryResultSchema.safeParse({
        assessment_id: assessmentId,
        snapshot_id: "snap-1",
        connection_id: "conn-1",
        connection_revoked: true,
      }).success,
    ).toBe(true);
    expect(
      removeAssessmentRepositoryResultSchema.safeParse({
        assessment_id: assessmentId,
        snapshot_id: "snap-1",
        connection_id: "conn-1",
      }).success,
    ).toBe(false);
  });
});
