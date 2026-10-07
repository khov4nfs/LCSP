// Real migrated PostgreSQL, built API and native PostgresSaver. SCRIPTED model: mechanics only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
  BLOCKER_REASONS,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/assessment-domain";
import {
  contentHash,
  root,
  runPython,
  startStack,
  workerKey,
} from "./support/legal-portfolio-stack.mjs";

const unresolvableOnly = process.argv.includes("--unresolvable-only");
const stack = await startStack({
  database: unresolvableOnly
    ? "lcsp_w4_unresolvable_vertical"
    : "lcsp_w4_vertical",
  apiPort: Number(process.env.LCSP_W4_API_PORT ?? 3414),
});
const { q, base, post, stop, seedCorpus, databaseUrl } = stack;
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const http = async (method, route, body, token, worker = false) => {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(worker ? { "x-worker-api-key": workerKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 500) console.error(stack.logs.join("").slice(-8000));
  return { status: res.status, body: await res.json() };
};
const dir = mkdtempSync(path.join(tmpdir(), "lcsp-w4-hitl-"));
writeFileSync(
  path.join(dir, "README.md"),
  "Notification owner is maintained outside the repository.\n",
);
const script = path.join(root, "deepagents/tests/vertical/hitl_root.py");
const run = (id, mode) =>
  runPython(script, [base, workerKey, id, dir, mode], {
    env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: databaseUrl.split("?")[0] },
  });
const state = async (id) =>
  (
    await q(
      `SELECT a."lifecycleState" AS als, a."blockerReason" AS blocker, a."blockerReference" AS reference, r."executionState" AS aes, r."threadId" AS thread, r."checkpointId" AS checkpoint, c."caseRevision" AS revision FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id JOIN "AssessmentCase" c ON c."assessmentId"=a.id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
const list = async (id, token) =>
  http("GET", `/assessments/${id}/human-requests`, undefined, token);
const answer = (id, requestId, token, body) =>
  http(
    "POST",
    `/assessments/${id}/human-requests/${requestId}/answers`,
    body,
    token,
  );
try {
  const locators = [
    "art-1",
    "art-1::cl-1",
    "art-2",
    "art-2::cl-1",
    "art-3",
    "art-3::cl-1",
    "art-4",
    "art-4::cl-1",
    "art-4::cl-1::pt-a",
    "art-5",
    "art-5::cl-1",
    "art-5::cl-1::pt-a",
    "art-5::cl-1::pt-b",
    "art-6",
    "art-6::cl-1",
  ];
  const hashes = Object.fromEntries(
    locators.map((l) => [l, contentHash(`content ${l}`)]),
  );
  const corpus = await seedCorpus({
    name: "w4-hitl",
    status: "APPROVED",
    documentId: "SYNTHETIC-NOTICE-INSTRUMENT",
    chunks: locators.map((locator) => ({
      locator,
      content: `content ${locator}`,
      contentSha256: hashes[locator],
    })),
  });
  const seed = path.join(dir, "seed.json");
  writeFileSync(seed, JSON.stringify({ hashes }));
  const prep = await post("preparations", {
    legalCorpusVersionId: corpus,
    idempotencyKey: `w4-prep-${randomUUID()}`,
  });
  eq(prep.status, 202, JSON.stringify(prep.body));
  const prepared = await runPython(
    path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
    [base, workerKey, prep.body.data.preparationRunId, seed, "valid"],
  );
  eq(prepared.state, "SUCCEEDED", JSON.stringify(prepared));
  const { hashSecret } = await import(
    path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js")
  );
  const password = "CorrectHorseBatteryStaple!";
  const customer = async (email) => {
    const id = randomUUID();
    await q(
      `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
      [id, email, hashSecret(password)],
    );
    const result = await http("POST", "/auth/sign-in", {
      email,
      password,
      organization_id: "org-1",
    });
    eq(result.status, 200, JSON.stringify(result.body));
    return { id, token: result.body.data.session_token };
  };
  const owner = await customer("w4-owner@acme.test"),
    other = await customer("w4-other@acme.test");
  const create = async (name) => {
    const created = await http("POST", "/assessments", { name }, owner.token);
    eq(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.assessment_id ?? created.body.data.id,
      connection = randomUUID(),
      snapshot = randomUUID();
    await q(
      `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,'w4',$4,'repo','acme/repo','main','{}')`,
      [connection, id, owner.id, `repo-${id}`],
    );
    await q(
      `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}',$6)`,
      [snapshot, id, connection, `repo-${id}`, "c".repeat(40), owner.id],
    );
    const setup = await http(
      "POST",
      `/assessments/${id}/repository-setup/complete`,
      undefined,
      owner.token,
    );
    eq(setup.status, 201, JSON.stringify(setup.body));
    return id;
  };
  if (unresolvableOnly) {
    writeFileSync(
      path.join(dir, "README.md"),
      "Historical notification ownership records were permanently destroyed; no alternate records are available under this assessment contract.\n",
    );
    const E = await create("W4 permanently unobtainable human fact");
    const blocked = await run(E, "unresolvable");
    eq(
      blocked.result.state,
      AGENT_EXECUTION_STATES.INTERRUPTED,
      JSON.stringify(blocked),
    );
    eq(blocked.apiChecks, [
      ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_NOT_FOUND,
      ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE,
      ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_REVISION_STALE,
      ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_REFERENCE_INVALID,
      "REPLAYED",
      ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    ]);
    const waiting = await state(E);
    eq(
      [waiting.als, waiting.aes, waiting.blocker],
      [
        ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
        AGENT_EXECUTION_STATES.INTERRUPTED,
        BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE,
      ],
    );
    const [request] = (await list(E, owner.token)).body.data.requests;
    eq(waiting.reference, { humanResolutionRequestId: request.requestId });
    eq(request.checkpointId, waiting.checkpoint);
    eq(
      (
        await http(
          "POST",
          `/internal/assessment-runtime/${E}/claim`,
          undefined,
          undefined,
          true,
        )
      ).status,
      409,
    );
    const unknown = await answer(E, request.requestId, owner.token, {
      expectedCaseRevision: 0,
      expectedRequestRevision: 0,
      idempotencyKey: "w4-blocked-unknown",
      doesNotKnow: true,
    });
    eq(
      [unknown.status, unknown.body.data.status, unknown.body.data.resumed],
      [200, HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN, false],
    );
    eq((await state(E)).als, ASSESSMENT_LIFECYCLE_STATES.BLOCKED);
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1`,
          [E],
        )
      ).rows[0].n,
      0,
    );
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AssessmentArtifact" WHERE "assessmentId"=$1`,
          [E],
        )
      ).rows[0].n,
      0,
    );
    eq(
      (
        await q(
          `SELECT "resolutionState" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "engineeringRuleId"=$2`,
          [E, "ER-RET"],
        )
      ).rows[0].resolutionState,
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    );
    const known = await answer(E, request.requestId, owner.token, {
      expectedCaseRevision: 0,
      expectedRequestRevision: 1,
      idempotencyKey: "w4-blocked-recovered-fact",
      doesNotKnow: false,
      answer:
        "A newly recovered approved archive identifies Customer Operations as the historical owner.",
    });
    eq(
      [known.status, known.body.data.status, known.body.data.resumed],
      [200, HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED, true],
    );
    eq(
      [(await state(E)).als, (await state(E)).blocker],
      [ASSESSMENT_LIFECYCLE_STATES.ACTIVE, null],
    );
    const resumed = await run(E, "resume");
    eq(
      [resumed.result.state, resumed.result.threadId],
      [AGENT_EXECUTION_STATES.SUCCEEDED, waiting.thread],
    );
    eq((await list(E, owner.token)).body.data.requests.length, 1);
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AuditEvent" WHERE "resourceId"=$1 AND "eventType"=$2`,
          [
            E,
            ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
          ],
        )
      ).rows[0].n,
      1,
    );

    const F = await create("W4 blocked human checkpoint crash");
    await assert.rejects(run(F, "unresolvable-crash"), /exited 73/);
    checks++;
    const crashed = await state(F);
    eq(
      [crashed.als, crashed.aes],
      [ASSESSMENT_LIFECYCLE_STATES.BLOCKED, AGENT_EXECUTION_STATES.RUNNING],
    );
    await q(
      `UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=now()-interval '1 second' WHERE "assessmentId"=$1`,
      [F],
    );
    const recovered = await run(F, "resume");
    eq(
      [recovered.result.state, recovered.result.threadId],
      [AGENT_EXECUTION_STATES.INTERRUPTED, crashed.thread],
    );
    const [recoveredRequest] = (await list(F, owner.token)).body.data.requests;
    eq(
      (
        await answer(F, recoveredRequest.requestId, owner.token, {
          expectedCaseRevision: 0,
          expectedRequestRevision: 0,
          idempotencyKey: "w4-blocked-crash-answer",
          doesNotKnow: false,
          answer: "Recovered archive identifies Customer Operations.",
        })
      ).body.data.resumed,
      true,
    );
    eq((await run(F, "resume")).result.threadId, crashed.thread);
    eq((await list(F, owner.token)).body.data.requests.length, 1);
    const G = await create("W4 blocked human crash before checkpoint");
    await assert.rejects(
      run(G, "unresolvable-crash-before-checkpoint"),
      /exited 75/,
    );
    checks++;
    const beforeCheckpoint = await state(G);
    eq(
      [beforeCheckpoint.als, beforeCheckpoint.aes],
      [ASSESSMENT_LIFECYCLE_STATES.BLOCKED, AGENT_EXECUTION_STATES.RUNNING],
    );
    await q(
      `UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=now()-interval '1 second' WHERE "assessmentId"=$1`,
      [G],
    );
    const replayed = await run(G, "resume");
    eq(
      [replayed.result.state, replayed.result.threadId],
      [AGENT_EXECUTION_STATES.INTERRUPTED, beforeCheckpoint.thread],
    );
    eq((await list(G, owner.token)).body.data.requests.length, 1);
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AuditEvent" WHERE "resourceId"=$1 AND "eventType"=$2`,
          [
            G,
            ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
          ],
        )
      ).rows[0].n,
      1,
    );

    const H = await create("W4 multiple permanently unavailable facts");
    eq(
      (await run(H, "unresolvable-multiple")).result.state,
      AGENT_EXECUTION_STATES.INTERRUPTED,
    );
    const multipleState = await state(H);
    const multipleRequests = (await list(H, owner.token)).body.data.requests;
    eq(multipleRequests.length, 2);
    const firstBlockedRequest = multipleRequests.find(
      ({ requestId }) =>
        requestId === multipleState.reference.humanResolutionRequestId,
    );
    const otherBlockedRequest = multipleRequests.find(
      ({ requestId }) => requestId !== firstBlockedRequest.requestId,
    );
    const knownAnswer = (revision) => ({
      expectedCaseRevision: revision,
      expectedRequestRevision: 0,
      idempotencyKey: `w4-multiple-blocked-answer-${revision}`,
      doesNotKnow: false,
      answer:
        "Newly recovered approved archive identifies Customer Operations.",
    });
    eq(
      (
        await answer(
          H,
          firstBlockedRequest.requestId,
          owner.token,
          knownAnswer(0),
        )
      ).body.data.resumed,
      false,
    );
    eq((await state(H)).als, ASSESSMENT_LIFECYCLE_STATES.BLOCKED);
    eq(
      (
        await answer(
          H,
          otherBlockedRequest.requestId,
          owner.token,
          knownAnswer(1),
        )
      ).body.data.resumed,
      true,
    );
    eq(
      [(await run(H, "resume")).result.threadId, (await state(H)).als],
      [multipleState.thread, ASSESSMENT_LIFECYCLE_STATES.ACTIVE],
    );
    eq((await list(H, owner.token)).body.data.requests.length, 2);
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AuditEvent" WHERE "resourceId"=$1 AND "eventType"=$2`,
          [
            H,
            ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
          ],
        )
      ).rows[0].n,
      2,
    );

    const I = await create("W4 rejected unavailable claim retains native wait");
    eq(
      (await run(I, "unresolvable-rejected")).result.state,
      AGENT_EXECUTION_STATES.INTERRUPTED,
    );
    const rejectedState = await state(I);
    eq(
      [rejectedState.als, rejectedState.blocker],
      [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN, null],
    );
    ok(
      rejectedState.checkpoint,
      "rejected claim keeps the durable material question checkpointed",
    );
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AuditEvent" WHERE "resourceId"=$1 AND "eventType"=$2`,
          [
            I,
            ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_FACT_UNRESOLVABLE_REPORTED,
          ],
        )
      ).rows[0].n,
      0,
    );

    console.log(
      JSON.stringify({
        gate: "W4 unresolvable human fact mechanics",
        checks,
        result: "PASS",
        sameThread: waiting.thread,
        checkpoint: waiting.checkpoint,
        crashThread: crashed.thread,
        proof:
          "real migrated DB/API/PostgresSaver; scripted model; separate processes",
      }),
    );
  } else {
    const A = await create("W4 known and unknown answer");
    const first = await run(A, "ask");
    eq(first.result.state, "INTERRUPTED", JSON.stringify(first));
    const waiting = await state(A);
    eq([waiting.als, waiting.aes], ["WAITING_FOR_HUMAN", "INTERRUPTED"]);
    eq(waiting.checkpoint, first.result.checkpointId);
    const current = (await list(A, owner.token)).body.data;
    eq(current.requests.length, 1);
    const request = current.requests[0];
    eq(request.checkpointId, waiting.checkpoint);
    eq(request.status, "OPEN");
    eq((await list(A, other.token)).status, 404);
    const unknown = {
      expectedCaseRevision: 0,
      expectedRequestRevision: 0,
      idempotencyKey: "w4-unknown-answer",
      doesNotKnow: true,
    };
    eq((await answer(A, request.requestId, other.token, unknown)).status, 404);
    const unknownResult = await answer(
      A,
      request.requestId,
      owner.token,
      unknown,
    );
    eq(unknownResult.status, 200, JSON.stringify(unknownResult.body));
    eq(
      [
        unknownResult.body.data.status,
        unknownResult.body.data.caseRevision,
        unknownResult.body.data.resumed,
      ],
      ["OPEN", 0, false],
    );
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AssessmentCaseFact" WHERE "assessmentId"=$1`,
          [A],
        )
      ).rows[0].n,
      0,
    );
    eq((await state(A)).als, "WAITING_FOR_HUMAN");
    eq(
      (await answer(A, request.requestId, owner.token, unknown)).body.data
        .replayed,
      true,
    );
    const known = {
      expectedCaseRevision: 0,
      expectedRequestRevision: 1,
      idempotencyKey: "w4-known-answer",
      doesNotKnow: false,
      answer: "Customer operations team",
    };
    eq(
      (
        await answer(A, request.requestId, owner.token, {
          ...known,
          expectedRequestRevision: 0,
        })
      ).body.problem.code,
      "ASSESSMENT_HUMAN_REQUEST_REVISION_STALE",
    );
    const knownResult = await answer(A, request.requestId, owner.token, known);
    eq(knownResult.status, 200, JSON.stringify(knownResult.body));
    eq(
      [
        knownResult.body.data.status,
        knownResult.body.data.caseRevision,
        knownResult.body.data.resumed,
      ],
      ["RESOLVED", 1, true],
    );
    eq(
      (
        await q(
          `SELECT count(*)::int n FROM "AssessmentEvidence" WHERE "assessmentId"=$1 AND type='HUMAN_ANSWER'`,
          [A],
        )
      ).rows[0].n,
      1,
    );
    eq(
      (await answer(A, request.requestId, owner.token, known)).body.data
        .replayed,
      true,
    );
    eq(
      (
        await answer(A, request.requestId, owner.token, {
          ...known,
          answer: "Different answer",
        })
      ).body.problem.code,
      "ASSESSMENT_IDEMPOTENCY_CONFLICT",
    );
    const resumed = await run(A, "resume");
    eq(resumed.result.state, "SUCCEEDED", JSON.stringify(resumed));
    eq(resumed.result.threadId, waiting.thread);
    ok(resumed.pid !== first.pid, "new process");
    eq((await list(A, owner.token)).body.data.requests.length, 1);
    eq((await state(A)).revision, 1);
    const B = await create("W4 multiple blockers");
    const multi = await run(B, "multiple");
    eq(multi.result.state, "INTERRUPTED", JSON.stringify(multi));
    const requests = (await list(B, owner.token)).body.data.requests;
    eq(requests.length, 2);
    const body = (i) => ({
      expectedCaseRevision: i,
      expectedRequestRevision: 0,
      idempotencyKey: `w4-multiple-${i}`,
      doesNotKnow: false,
      answer: "Customer operations team",
    });
    eq(
      (await answer(B, requests[0].requestId, owner.token, body(0))).body.data
        .resumed,
      false,
    );
    eq((await state(B)).als, "WAITING_FOR_HUMAN");
    eq(
      (await answer(B, requests[1].requestId, owner.token, body(0))).body
        .problem.code,
      "ASSESSMENT_CASE_REVISION_STALE",
    );
    eq(
      (await answer(B, requests[1].requestId, owner.token, body(1))).body.data
        .resumed,
      true,
    );
    eq((await run(B, "resume")).result.state, "SUCCEEDED");
    eq((await list(B, owner.token)).body.data.requests.length, 2);
    const C = await create("W4 crash before settlement");
    await assert.rejects(run(C, "crash"), /exited 73/);
    checks++;
    const crashed = await state(C);
    eq([crashed.als, crashed.aes], ["WAITING_FOR_HUMAN", "RUNNING"]);
    await q(
      `UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=now()-interval '1 second' WHERE "assessmentId"=$1`,
      [C],
    );
    const recovered = await run(C, "resume");
    eq(recovered.result.state, "INTERRUPTED", JSON.stringify(recovered));
    eq(recovered.result.threadId, crashed.thread);
    const recoveredRequest = (await list(C, owner.token)).body.data.requests;
    eq(recoveredRequest.length, 1);
    eq(
      (await answer(C, recoveredRequest[0].requestId, owner.token, body(0)))
        .body.data.resumed,
      true,
    );
    const final = await run(C, "resume");
    eq(final.result.state, "SUCCEEDED", JSON.stringify(final));
    eq(final.result.threadId, crashed.thread);
    eq((await list(C, owner.token)).body.data.requests.length, 1);
    const D = await create("W4 crash before native checkpoint");
    await assert.rejects(run(D, "crash-before-checkpoint"), /exited 74/);
    checks++;
    const beforeCheckpoint = await state(D);
    eq(
      [beforeCheckpoint.als, beforeCheckpoint.aes],
      ["WAITING_FOR_HUMAN", "RUNNING"],
    );
    await q(
      `UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=now()-interval '1 second' WHERE "assessmentId"=$1`,
      [D],
    );
    const replayedRequest = await run(D, "ask");
    eq(
      replayedRequest.result.state,
      "INTERRUPTED",
      JSON.stringify(replayedRequest),
    );
    const afterReplay = (await list(D, owner.token)).body.data.requests;
    eq(afterReplay.length, 1);
    eq(
      (await answer(D, afterReplay[0].requestId, owner.token, body(0))).body
        .data.resumed,
      true,
    );
    eq((await run(D, "resume")).result.state, "SUCCEEDED");
    eq((await list(D, owner.token)).body.data.requests.length, 1);
    console.log(
      JSON.stringify({
        gate: "W4 HITL mechanics",
        checks,
        result: "PASS",
        sameThread: waiting.thread,
        checkpoint: waiting.checkpoint,
        crashThread: crashed.thread,
        proof:
          "real migrated DB/API/PostgresSaver; scripted model; separate processes",
      }),
    );
  }
} finally {
  await stop();
}
