import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_STATUS_CODES,
  isAssessmentRepositorySetupState,
  needsRepositorySetupResume,
  type AssessmentRepositorySetupState,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";
import type { AssessmentRepositorySetup } from "@lcsp/contracts/assessment-domain";
import {
  connectAssessmentRepository,
  getRepositorySetupState,
  startRepositoryAnalysis,
} from "../src/lib/api/repository-analysis-client";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-10-01T00:00:00.000Z";
const originalCommit = "a".repeat(40);
const connection = {
  connectionId: "connection-1",
  provider: CREDENTIAL_PROVIDERS.github,
  repositoryId: "repo-1",
  repositoryFullName: "acme/payments",
  defaultBranch: "main",
  status: REPOSITORY_CONNECTION_STATUSES.active,
};
const snapshot = {
  id: "snapshot-1", assessmentId, connectionId: connection.connectionId,
  provider: connection.provider, repositoryFullName: connection.repositoryFullName,
  branch: connection.defaultBranch, commitSha: originalCommit, createdAt: timestamp,
};
const input = { connectionId: connection.connectionId, branch: connection.defaultBranch };

function state(overrides: Record<string, unknown> = {}): AssessmentRepositorySetupState {
  return structuredClone({
    assessmentId, assessmentStatus: ASSESSMENT_STATUS_CODES.wizardInProgress,
    connection, snapshot, scanJob: null, ...overrides,
  });
}
function makeJob(status: NonNullable<AssessmentRepositorySetup["scanJob"]>["status"] = REPOSITORY_SCAN_JOB_STATUSES.queued): NonNullable<AssessmentRepositorySetup["scanJob"]> {
  return { id: "scan-1", assessmentId, snapshotId: snapshot.id, status,
    attemptCount: 0, blockedReason: null, updatedAt: timestamp };
}
function setup(overrides: Partial<AssessmentRepositorySetup> = {}): AssessmentRepositorySetup {
  return structuredClone({
    assessmentId, lifecycle: { state: ASSESSMENT_LIFECYCLE_STATES.PREPARING, assessmentRevision: 1 },
    connection, snapshot, scanJob: null, ...overrides,
  });
}
function response(data: unknown): Response {
  return Response.json({ ok: true, data });
}

type RequestRecord = { path: string; method: string; body: Record<string, unknown> };
function server(t: TestContext, initial: AssessmentRepositorySetup) {
  const api = {
    state: structuredClone(initial),
    requests: [] as RequestRecord[],
    failures: new Set<string>(),
    branchHead: originalCommit,
    completionMismatch: false,
  };
  function maybeLoseResponse(stage: string) {
    if (api.failures.delete(stage)) throw new TypeError("simulated response loss");
  }
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url), "https://lcsp.test").pathname;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    api.requests.push({ path, method, body });
    assert.notEqual(method, "DELETE", "recovery must never delete a persisted Assessment");
    assert.ok(!path.endsWith("/scan-jobs"), "the client never starts a scan; the server owns it");
    if (method === "GET" && path.endsWith("/repository-setup")) return response(api.state);
    if (path.endsWith("/repository-connection")) {
      api.state.connection = structuredClone(connection);
      maybeLoseResponse("connection-response");
      return response(connection);
    }
    if (path.endsWith("/snapshots")) {
      api.state.snapshot = { ...snapshot, commitSha: api.branchHead };
      maybeLoseResponse("snapshot-response");
      return response({ snapshot_id: snapshot.id, commit_sha: api.branchHead });
    }
    if (path.endsWith("/repository-setup/complete")) {
      if (api.failures.delete("complete-before-commit")) {
        return Response.json({ ok: false, problem: { code: "TEST_COMPLETE_UNAVAILABLE" } }, { status: 503 });
      }
      // Server-owned: completion starts the Root and queues the scan atomically.
      api.state.lifecycle = { state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE, assessmentRevision: 2 };
      api.state.scanJob = makeJob();
      maybeLoseResponse("completion-response");
      return response({
        assessment_id: assessmentId,
        repository_connection_id: connection.connectionId,
        snapshot_id: api.completionMismatch ? "different-snapshot" : api.state.snapshot?.id,
        commit_sha: api.state.snapshot?.commitSha,
      });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  return api;
}
function writes(api: ReturnType<typeof server>) {
  return api.requests.filter((request) => request.method !== "GET");
}

for (const url of [
  "https://github.com/acme//payments", "https://github.com//acme/payments",
  "https://github.com/acme/payments//", "http://github.com/acme/payments",
  "https://github.com/acme/payments/tree/main", "https://github.com/acme/payments/blob/main/a.ts",
  "https://github.com/acme/payments?tab=code", "https://github.com/acme/payments#readme",
  "https://user:secret@github.com/acme/payments", "https://github.com:444/acme/payments",
  `https://github.com/acme/${"a".repeat(2050)}`,
]) {
  test(`shared URL validation rejects ${url.slice(0, 100)}`, () => {
    assert.equal(parseGitHubRepositoryUrl(url), null);
  });
}

test("shared parsers preserve supported repository URL forms", () => {
  for (const url of ["https://github.com/acme/payments", "https://github.com/acme/payments.git/", " https://github.com/acme/payments "]) {
    assert.equal(parseGitHubRepositoryUrl(url)?.repositoryFullName, "acme/payments");
  }
  assert.equal(parseGitLabRepositoryUrl("https://gitlab.com/acme/tree/team/project.git")?.repositoryFullName, "acme/tree/team/project");
  assert.equal(parseGitLabRepositoryUrl("https://gitlab.com/acme//project"), null);
  assert.equal(parseGitLabRepositoryUrl("https://gitlab.com/acme/project/-/tree/main"), null);
});

test("checkpoint validator rejects missing and mismatched persisted context", () => {
  assert.equal(isAssessmentRepositorySetupState(state()), true);
  assert.equal(isAssessmentRepositorySetupState({ assessmentId }), false);
  assert.equal(isAssessmentRepositorySetupState(state({ connection: null })), false);
  assert.equal(isAssessmentRepositorySetupState(state({ snapshot: { ...snapshot, connectionId: "other" } })), false);
  assert.equal(isAssessmentRepositorySetupState(state({ scanJob: { ...makeJob(), snapshotId: "other" } as never })), false);
  assert.equal(isAssessmentRepositorySetupState(state({ snapshot: { ...snapshot, commitSha: "invalid" } })), false);
});

for (const status of [ASSESSMENT_STATUS_CODES.wizardInProgress, ASSESSMENT_STATUS_CODES.wizardSubmitted]) {
  test(`persisted source with ${status} and no job remains resumable`, () => {
    const setupState = state({ assessmentStatus: status });
    assert.equal(needsRepositorySetupResume(setupState), true);
  });
}

test("a submitted Assessment with a scan job opens scanner", () => {
  const setupState = state({ assessmentStatus: ASSESSMENT_STATUS_CODES.wizardSubmitted, scanJob: makeJob() as never });
  assert.equal(needsRepositorySetupResume(setupState), false);
});

test("resume completes a saved snapshot and reads the server-owned scan without repinning", async (t) => {
  const api = server(t, setup());
  const result = await startRepositoryAnalysis(assessmentId, input);
  assert.deepEqual(writes(api).map((request) => request.path.split("/").slice(-2).join("/")), ["repository-setup/complete"]);
  assert.equal(result.snapshotId, snapshot.id);
  assert.equal(result.commitSha, originalCommit);
  assert.equal(result.scanJobId, "scan-1");
});

test("new setup pins only when no persisted snapshot exists", async (t) => {
  const api = server(t, setup({ snapshot: null }));
  await startRepositoryAnalysis(assessmentId, input);
  assert.equal(writes(api).filter((request) => request.path.endsWith("/snapshots")).length, 1);
  assert.equal(writes(api).length, 2);
});

test("completion retry retains snapshot and commit even if the branch head moves", async (t) => {
  const api = server(t, setup());
  api.failures.add("complete-before-commit");
  await assert.rejects(startRepositoryAnalysis(assessmentId, input));
  api.branchHead = "b".repeat(40);
  const result = await startRepositoryAnalysis(assessmentId, input);
  assert.equal(result.commitSha, originalCommit);
  assert.equal(writes(api).some((request) => request.path.endsWith("/snapshots")), false);
  assert.equal(writes(api).length, 2);
});

for (const stage of ["snapshot-response", "completion-response"]) {
  test(`resume reconciles persisted state after losing ${stage}`, async (t) => {
    const api = server(t, setup({ snapshot: stage === "snapshot-response" ? null : snapshot }));
    api.failures.add(stage);
    await assert.rejects(startRepositoryAnalysis(assessmentId, input));
    const before = writes(api).length;
    api.branchHead = "b".repeat(40);
    const result = await startRepositoryAnalysis(assessmentId, input);
    assert.equal(result.commitSha, originalCommit);
    const retriedWrites = writes(api).slice(before);
    assert.equal(retriedWrites.some((request) => request.path.endsWith("/snapshots")), false);
    if (stage === "completion-response") assert.equal(retriedWrites.length, 0);
    if (stage === "snapshot-response") assert.equal(retriedWrites.length, 1);
  });
}

test("a setup that is no longer PREPARING and has no snapshot fails before any mutation", async (t) => {
  const api = server(t, setup({ snapshot: null, lifecycle: { state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE, assessmentRevision: 2 } }));
  await assert.rejects(startRepositoryAnalysis(assessmentId, input), { message: ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid });
  assert.equal(writes(api).length, 0);
});

test("lost connection response is recovered without deleting or connecting again", async (t) => {
  const api = server(t, setup({ connection: null, snapshot: null }));
  api.failures.add("connection-response");
  await assert.rejects(connectAssessmentRepository(assessmentId, "https://github.com/acme/payments"));
  const recovered = await connectAssessmentRepository(assessmentId, "https://github.com/acme/payments.git");
  assert.equal(recovered.connectionId, connection.connectionId);
  assert.equal(writes(api).length, 1);
});

test("an existing connection cannot be silently switched to another repository", async (t) => {
  const api = server(t, setup());
  await assert.rejects(connectAssessmentRepository(assessmentId, "https://github.com/acme/another"), { message: GITHUB_INTEGRATION_ERROR_CODES.connectionAlreadyExists });
  assert.equal(writes(api).length, 0);
});

for (const status of [REPOSITORY_SCAN_JOB_STATUSES.queued, REPOSITORY_SCAN_JOB_STATUSES.completed, REPOSITORY_SCAN_JOB_STATUSES.failed]) {
  test(`resume returns existing ${status} scan without implicitly rerunning`, async (t) => {
    const api = server(t, setup({ lifecycle: { state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE, assessmentRevision: 2 },
      scanJob: makeJob(status) }));
    const result = await startRepositoryAnalysis(assessmentId, input);
    assert.equal(result.scanStatus, status);
    assert.equal(writes(api).length, 0);
  });
}

test("concurrent client submissions share one resume operation", async (t) => {
  const api = server(t, setup());
  const first = startRepositoryAnalysis(assessmentId, input);
  const second = startRepositoryAnalysis(assessmentId, input);
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(writes(api).length, 1);
});

test("unreadable or mismatched checkpoints fail before any mutation", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init?.method ?? "GET");
    return response(setup({ assessmentId: "22222222-2222-4222-8222-222222222222" }));
  });
  await assert.rejects(getRepositorySetupState(assessmentId), { message: ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid });
  await assert.rejects(startRepositoryAnalysis(assessmentId, input));
  assert.ok(requests.every((method) => method === "GET"));
});

test("completion with a different snapshot is rejected", async (t) => {
  const api = server(t, setup());
  api.completionMismatch = true;
  await assert.rejects(startRepositoryAnalysis(assessmentId, input), { message: GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch });
});

test("setup UI has an explicit resume action and no automatic destructive cleanup", async () => {
  const source = await readFile(new URL("../src/features/assessment-flow/components/organisms/repository-setup-step.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /useDeleteAssessmentMutation|deleteAssessment\.mutateAsync/);
  assert.match(source, /pages\.assessmentFlow\.resumeSetup/);
  assert.match(source, /getRepositorySetupState/);
});
