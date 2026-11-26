import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import type {
  AssessmentRepositorySetup,
  AssessmentRepositorySetupEntry,
} from "@lcsp/contracts/assessment-domain";
import {
  removeAssessmentRepository,
  startRepositoryAnalysis,
} from "../src/lib/api/repository-analysis-client";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-10-01T00:00:00.000Z";

const connection = (id: string, fullName: string) => ({
  connectionId: id,
  provider: CREDENTIAL_PROVIDERS.github,
  repositoryId: `repo-${id}`,
  repositoryFullName: fullName,
  defaultBranch: "main",
  status: REPOSITORY_CONNECTION_STATUSES.active,
});
const web = connection("c-web", "acme/web");
const api = connection("c-api", "acme/api");

function snapshotOf(
  id: string,
  owner: ReturnType<typeof connection>,
  sourcePathPrefix: string | null = null,
  commit = "a",
) {
  return {
    id,
    assessmentId,
    connectionId: owner.connectionId,
    provider: owner.provider,
    repositoryFullName: owner.repositoryFullName,
    branch: "main",
    commitSha: commit.repeat(40),
    sourcePathPrefix,
    createdAt: timestamp,
  };
}
const entry = (
  owner: ReturnType<typeof connection>,
  snapshot: ReturnType<typeof snapshotOf> | null,
): AssessmentRepositorySetupEntry => ({
  repositoryKey: null,
  connection: owner,
  snapshot,
  scanJob: null,
});
const input = (
  owner: ReturnType<typeof connection>,
  sourcePathPrefix: string | null = null,
) => ({
  connectionId: owner.connectionId,
  branch: "main",
  sourcePathPrefix,
});

function setup(
  repositories: AssessmentRepositorySetupEntry[],
  state: string = ASSESSMENT_LIFECYCLE_STATES.PREPARING,
): AssessmentRepositorySetup {
  const [primary] = repositories;
  return {
    assessmentId,
    lifecycle: { state, assessmentRevision: 1 } as never,
    connection: primary?.connection ?? null,
    snapshot: primary?.snapshot ?? null,
    scanJob: null,
    repositories,
    repositorySetDigest: null,
    repositoryLimit: 5,
    setupCompleted: state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
  };
}

type Write = { path: string; method: string; body: Record<string, unknown> };

function server(
  t: TestContext,
  initial: AssessmentRepositorySetup,
  options: { completionDropsLast?: boolean } = {},
) {
  const state = structuredClone(initial);
  const writes: Write[] = [];
  let counter = 0;
  const connections = new Map(
    [web, api].map((item) => [item.connectionId, item]),
  );
  t.mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url), "https://lcsp.test").pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const ok = (data: unknown) => Response.json({ ok: true, data });
      if (method === "GET" && path.endsWith("/repository-setup")) {
        return ok(state);
      }
      writes.push({ path, method, body });
      if (path.endsWith("/snapshots")) {
        const owner = connections.get(String(body.connection_id))!;
        counter += 1;
        const created = snapshotOf(
          `snap-${counter}`,
          owner,
          (body.source_path_prefix as string | null) ?? null,
          String(counter),
        );
        state.repositories.push(entry(owner, created));
        state.snapshot ??= created;
        return ok({ snapshot_id: created.id, commit_sha: created.commitSha });
      }
      if (path.endsWith("/repository-setup/complete")) {
        const ids = body.snapshotIds as string[];
        state.lifecycle = {
          state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          assessmentRevision: 2,
        } as never;
        state.setupCompleted = true;
        const pinned = state.repositories.filter((item) =>
          ids.includes(item.snapshot?.id ?? ""),
        );
        const reported = options.completionDropsLast
          ? pinned.slice(0, -1)
          : pinned;
        const primary = pinned[0]!;
        return ok({
          assessment_id: assessmentId,
          repository_connection_id: primary.connection.connectionId,
          snapshot_id: primary.snapshot!.id,
          commit_sha: primary.snapshot!.commitSha,
          repository_set_digest: `sha256:${"b".repeat(64)}`,
          repositories: reported.map((item, index) => ({
            repository_key: `repo-${index}`,
            connection_id: item.connection.connectionId,
            snapshot_id: item.snapshot!.id,
            commit_sha: item.snapshot!.commitSha,
          })),
        });
      }
      if (method === "DELETE") {
        return ok({
          assessment_id: assessmentId,
          snapshot_id: path.split("/").at(-1),
          connection_id: web.connectionId,
          connection_revoked: true,
        });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
  );
  return { state, writes };
}

test("every repository is pinned once and completion names all snapshots in order", async (t) => {
  const { writes } = server(t, setup([entry(web, null), entry(api, null)]));

  const result = await startRepositoryAnalysis(assessmentId, [
    input(web),
    input(api),
  ]);

  assert.deepEqual(
    writes.map((write) => write.path.split("/").slice(-2).join("/")),
    [
      `${assessmentId}/snapshots`,
      `${assessmentId}/snapshots`,
      "repository-setup/complete",
    ],
  );
  assert.deepEqual(writes.at(-1)?.body, { snapshotIds: ["snap-1", "snap-2"] });
  assert.equal(result.snapshotId, "snap-1");
  assert.equal(result.lifecycleState, ASSESSMENT_LIFECYCLE_STATES.ACTIVE);
});

test("saved snapshots are reused so only completion is written", async (t) => {
  const { writes } = server(
    t,
    setup([
      entry(web, snapshotOf("snap-w", web)),
      entry(api, snapshotOf("snap-a", api, null, "b")),
    ]),
  );

  await startRepositoryAnalysis(assessmentId, [input(web), input(api)]);

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.body, { snapshotIds: ["snap-w", "snap-a"] });
});

test("one repository may be chosen twice with different source scopes", async (t) => {
  const { writes } = server(t, setup([entry(web, null)]));

  await startRepositoryAnalysis(assessmentId, [
    input(web, "apps/web"),
    input(web, "apps/admin"),
  ]);

  const snapshotWrites = writes.filter((write) =>
    write.path.endsWith("/snapshots"),
  );
  assert.deepEqual(
    snapshotWrites.map((write) => write.body.source_path_prefix),
    ["apps/web", "apps/admin"],
  );
  assert.deepEqual(writes.at(-1)?.body, { snapshotIds: ["snap-1", "snap-2"] });
});

test("a completion that reports a different set than requested is rejected", async (t) => {
  server(
    t,
    setup([
      entry(web, snapshotOf("snap-w", web)),
      entry(api, snapshotOf("snap-a", api, null, "b")),
    ]),
    { completionDropsLast: true },
  );

  await assert.rejects(
    startRepositoryAnalysis(assessmentId, [input(web), input(api)]),
    { message: GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch },
  );
});

test("an ACTIVE assessment resumes from its pinned set without any write", async (t) => {
  const { writes } = server(
    t,
    setup(
      [
        entry(web, snapshotOf("snap-w", web)),
        entry(api, snapshotOf("snap-a", api, null, "b")),
      ],
      ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    ),
  );

  const result = await startRepositoryAnalysis(assessmentId, [
    input(web),
    input(api),
  ]);

  assert.equal(writes.length, 0);
  assert.equal(result.lifecycleState, ASSESSMENT_LIFECYCLE_STATES.ACTIVE);
});

test("an unknown connection or an empty selection fails before any write", async (t) => {
  const { writes } = server(t, setup([entry(web, snapshotOf("snap-w", web))]));

  await assert.rejects(startRepositoryAnalysis(assessmentId, [input(api)]), {
    message: GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
  });
  await assert.rejects(startRepositoryAnalysis(assessmentId, []), {
    message: ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
  });
  assert.equal(writes.length, 0);
});

test("a new repository cannot be pinned once the assessment left PREPARING", async (t) => {
  const { writes } = server(
    t,
    setup(
      [entry(web, snapshotOf("snap-w", web)), entry(api, null)],
      ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    ),
  );

  await assert.rejects(
    startRepositoryAnalysis(assessmentId, [input(web), input(api)]),
    { message: ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid },
  );
  assert.equal(writes.length, 0);
});

test("removing a repository candidate calls the dedicated endpoint and validates the answer", async (t) => {
  const { writes } = server(t, setup([entry(web, snapshotOf("snap-w", web))]));

  const result = await removeAssessmentRepository(assessmentId, "snap-w");

  assert.equal(writes[0]?.method, "DELETE");
  assert.ok(
    writes[0]?.path.endsWith(
      `/assessments/${assessmentId}/repository-setup/repositories/snap-w`,
    ),
  );
  assert.equal(result.snapshot_id, "snap-w");
  assert.equal(result.connection_revoked, true);
});
