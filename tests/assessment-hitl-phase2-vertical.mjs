// Run after contracts/API build: LCSP_TEST_PG_PORT=<owned-loopback-postgres> node tests/assessment-hitl-phase2-vertical.mjs
// Creates unique API/checkpoint databases, never drops existing databases; API port is dynamically allocated.
// PrismaService enforces UTC per connection; the server may have a non-UTC default.
// Needs populated deepagents/.venv. Set TMPDIR to a workspace-local directory under restrictive process sandboxes.
// Deliberately partial known-answer continuations must fail rather than claim a fabricated completed report.
// Real migrated PostgreSQL, built API and native PostgresSaver. SCRIPTED model: mechanics only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
  BLOCKER_REASONS,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  RULE_AUDIT_SCOPE_MODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_ERROR_CODES,
  ROOT_CAPACITY_ID,
} from "@lcsp/contracts/assessment-domain";
import {
  contentHash,
  root,
  runPython,
  startStack,
  workerKey,
} from "./support/compliance-rule-set-stack.mjs";

// This gate creates a unique database and never resets a retained run.
const suffix = randomUUID().replaceAll("-", "");
const database = "lcsp360_final_hitl_phase2_" + suffix;
const checkpointDatabase = "lcsp_assessment_phase2_" + suffix;
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const apiPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const stack = await startStack({
  database,
  checkpointDatabase,
  apiPort,
  createOnlyDatabase: true,
  operationTimeoutMs: 60000,
});
const {
  q,
  base,
  post,
  stop,
  seedLegalSource,
  activateLegalSource,
  checkpointDatabaseUrl,
} = stack;
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const http = async (
  method,
  route,
  body,
  token,
  worker = false,
  lease = undefined,
) => {
  const claim = route.match(/^\/internal\/assessment-runtime\/([^/]+)\/claim$/);
  if (claim && worker) body = await stack.admission.prepare(claim[1], body, { manual: true });
  const res = await fetch(`${base}${route}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(worker ? { "x-worker-api-key": workerKey } : {}),
      ...(lease ? { "x-assessment-lease": lease } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 500) console.error(stack.logs.join("").slice(-8000));
  if (res.ok && route.endsWith("/finish")) await stack.admission.finishManual(route.split("/")[3]);
  return { status: res.status, body: await res.json() };
};
const dir = mkdtempSync(path.join(tmpdir(), "lcsp-assessment-hitl-"));
writeFileSync(
  path.join(dir, "README.md"),
  "Notification owner is maintained outside the repository.\n",
);
const script = path.join(root, "deepagents/tests/vertical/hitl_phase2_root.py");
// Explicit synthetic admission belongs only to these provider-free contract fixtures.
// It does not certify native host telemetry or capacity for a paid pilot.
const run = async (id, mode, requestId = "") => {
  const prepared = await stack.admission.prepare(id);
  try {
    return await runPython(script, [base, workerKey, id, dir, mode, requestId], {
      timeoutMs: 60000,
      env: {
        LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl,
        LCSP_TEST_ROOT_RUNTIME_RUN_ID: prepared.runtimeRunId,
        LCSP_TEST_ROOT_INCARNATION_ID: prepared.runtimeIncarnationId,
      },
    });
  } catch (error) {
    if (!/exited 73/.test(error.message)) console.error(stack.logs.join("").slice(-8000));
    throw error;
  } finally {
    // runPython settles only after the owned child exits, including deliberate exit 73.
    await stack.admission.release(prepared.runtimeRunId);
  }
};
const state = async (id) =>
  (
    await q(
      `SELECT a."lifecycleState" AS als, a."blockerReason" AS blocker, a."blockerReference" AS reference, r."executionState" AS aes, r."threadId" AS thread, r."checkpointId" AS checkpoint, r."currentExecutionId" AS execution, c."caseRevision" AS revision FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id JOIN "AssessmentCase" c ON c."assessmentId"=a.id WHERE a.id=$1`,
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
  const sourceBytes = Buffer.from(
    locators.map((locator) => `content ${locator}`).join("\n") + "\n",
    "utf8",
  );
  const lines = sourceBytes.toString("utf8").split("\n");
  const hashes = Object.fromEntries(
    locators.map((locator, index) => [locator, contentHash(lines[index])]),
  );
  const legalSource = await seedLegalSource({
    name: "assessment-hitl",
    status: "ACTIVE",
    documentId: "SYNTHETIC-NOTICE-INSTRUMENT",
    sourceBytes,
    sourceSha256: contentHash(sourceBytes),
    chunks: locators.map((locator, index) => ({
      locator,
      content: lines[index],
      contentSha256: hashes[locator],
    })),
  });
  const seed = path.join(dir, "seed.json");
  writeFileSync(seed, JSON.stringify({ hashes }));
  const prep = await activateLegalSource(legalSource);
  eq(prep.runs.length, 1, "one Legal Source -> one automatic preparation");
  const prepared = await runPython(
    path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
    [base, workerKey, prep.preparationRunId, seed, "valid"],
    { timeoutMs: 60000 },
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
  const owner = await customer("assessment-owner@acme.test"),
    other = await customer("assessment-other@acme.test");
  const create = async (name, sourcePathPrefix = null, auditMode = ASSESSMENT_AUDIT_MODES.LEGACY_FULL) => {
    const created = await http("POST", "/assessments", { name }, owner.token);
    eq(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.assessment_id ?? created.body.data.id,
      connection = randomUUID(),
      snapshot = randomUUID();
    await q(
      `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,'assessment',$4,'repo','acme/repo','main','{}')`,
      [connection, id, owner.id, `repo-${id}`],
    );
    await q(
      `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId","sourcePathPrefix") VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}',$6,$7)`,
      [
        snapshot,
        id,
        connection,
        `repo-${id}`,
        "c".repeat(40),
        owner.id,
        sourcePathPrefix,
      ],
    );
    await q('UPDATE "AssessmentCase" SET "auditMode"=$2 WHERE "assessmentId"=$1', [id, auditMode]);
    const setup = await http(
      "POST",
      `/assessments/${id}/repository-setup/complete`,
      undefined,
      owner.token,
    );
    eq(setup.status, 201, JSON.stringify(setup.body));
    if (auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED) {
      const catalog = await http("GET", `/assessments/${id}/rules?offset=0&limit=100`, undefined, owner.token);
      eq(catalog.status, 200, JSON.stringify(catalog.body));
      const pins = catalog.body.data;
      eq(pins.auditMode, ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED);
      eq(pins.nextOffset, null, "This small synthetic fixture fits one page");
      const selected = pins.rules.find((row) => row.assessmentRuleId === "ER-RET");
      ok(selected, "selected fixture rule exists");
      const audit = await http("POST", `/assessments/${id}/rule-audits`, {
        idempotencyKey: randomUUID(),
        expectedAuditRevision: pins.auditRevision,
        ruleSetVersionId: pins.ruleSetVersionId,
        ruleSetDigest: pins.ruleSetDigest,
        repositorySnapshotId: pins.repositorySnapshotId,
        repositoryCommit: pins.repositoryCommit,
        scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
        rules: [{
          assessmentRuleId: selected.assessmentRuleId,
          assessmentRuleVersion: selected.assessmentRuleVersion,
        }],
      }, owner.token);
      eq(audit.status, 201, JSON.stringify(audit.body));
      eq(audit.body.data.requested, 1);
    }
    return id;
  };

  const requestFor = async (id) => {
    const result = await list(id, owner.token);
    eq(result.status, 200);
    eq(
      result.body.data.requests.length,
      1,
      "one durable question, including after review",
    );
    return result.body.data.requests[0];
  };
  const inspect = async (id) =>
    (
      await q(
        `
    SELECT (SELECT count(*)::int FROM "AssessmentCaseFact" WHERE "assessmentId"=$1) facts,
      (SELECT count(*)::int FROM "AssessmentEvidence" WHERE "assessmentId"=$1 AND type='HUMAN_ANSWER') answers,
      (SELECT count(*)::int FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1) decisions,
      (SELECT count(*)::int FROM "AssessmentArtifact" WHERE "assessmentId"=$1) artifacts`,
        [id],
      )
    ).rows[0];
  const unknownAnswer = async (id, request, key) => {
    const body = {
      expectedCaseRevision: 0,
      expectedRequestRevision: request.requestRevision,
      idempotencyKey: key,
      doesNotKnow: true,
    };
    const response = await answer(id, request.requestId, owner.token, body);
    eq(response.status, 200, JSON.stringify(response.body));
    eq(
      [
        response.body.data.status,
        response.body.data.caseRevision,
        response.body.data.resumed,
      ],
      [HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN, 0, true],
      "UNKNOWN schedules review without resolving",
    );
    eq((await state(id)).als, ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN);
    eq(await inspect(id), { facts: 0, answers: 0, decisions: 0, artifacts: 0 });
    const updated = await requestFor(id);
    eq(
      updated.answers.at(-1).checkpointId,
      request.checkpointId,
      "UNKNOWN audit is bound to the checkpoint the customer answered",
    );
    eq(updated.answers.at(-1).doesNotKnow, true);
    const replay = await answer(id, request.requestId, owner.token, body);
    eq(replay.status, 200);
    eq(replay.body.data.replayed, true);
    return response.body.data;
  };
  const knownAnswer = async (id, request, key) => {
    const response = await answer(id, request.requestId, owner.token, {
      expectedCaseRevision: 0,
      expectedRequestRevision: request.requestRevision,
      idempotencyKey: key,
      doesNotKnow: false,
      answer:
        "Recovered archive confirms Customer Operations owns notifications.",
    });
    eq(response.status, 200, JSON.stringify(response.body));
    eq(
      [
        response.body.data.status,
        response.body.data.caseRevision,
        response.body.data.resumed,
      ],
      [HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED, 1, true],
    );
    eq(await inspect(id), { facts: 1, answers: 1, decisions: 0, artifacts: 0 });
    return response.body.data;
  };

  // Material Unknown plus accepted source evidence may become a durable BLOCKED dependency.
  const blockedId = await create(
    "Phase2 unknown reviewed against accepted evidence",
  );
  const first = await run(blockedId, "ask-block");
  eq(first.sourceRoot.commitSha, "c".repeat(40));
  ok(first.sourceRoot.coverage.coverageLimited);
  eq(first.sourceRoot.outsideScopeExcluded, true);
  eq(first.sourceRoot.sourceWriteDenied, true);
  eq(
    first.sourceRoot.coverage.skippedEntries.map((row) => row.path),
    [".lcsp/injected.txt"],
  );
  eq(
    first.result.state,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    JSON.stringify(first),
  );
  const firstState = await state(blockedId);
  let request = await requestFor(blockedId);
  eq(request.checkpointId, firstState.checkpoint);
  await assert.rejects(
    q(
      'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$1 WHERE "requestId"=$2',
      [randomUUID(), request.requestId],
    ),
    /immutable|checkpoint|review/i,
  );
  checks++;
  eq(
    (await requestFor(blockedId)).checkpointId,
    firstState.checkpoint,
    "direct unreviewed DB rebind remains rejected",
  );
  await unknownAnswer(blockedId, request, "phase2-blocked-unknown");
  const blocked = await run(blockedId, "block", request.requestId);
  eq(
    blocked.result.state,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    JSON.stringify(blocked),
  );
  ok(
    blocked.pid !== first.pid,
    "review reconstructs graph in a replacement worker",
  );
  eq(blocked.claim.humanAnswerReviewRequired, true);
  eq(blocked.claim.resumeCheckpointId, firstState.checkpoint);
  const blockedState = await state(blockedId);
  eq(
    [blockedState.als, blockedState.aes, blockedState.blocker],
    [
      ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
      AGENT_EXECUTION_STATES.INTERRUPTED,
      BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE,
    ],
  );
  eq(blockedState.thread, firstState.thread);
  ok(
    blockedState.checkpoint !== firstState.checkpoint,
    "review commits a new native checkpoint",
  );
  eq(blockedState.reference, { humanResolutionRequestId: request.requestId });
  request = await requestFor(blockedId);
  eq(request.checkpointId, blockedState.checkpoint);
  eq(await inspect(blockedId), {
    facts: 0,
    answers: 0,
    decisions: 0,
    artifacts: 0,
  });
  await knownAnswer(blockedId, request, "phase2-blocked-known");
  const recovered = await run(blockedId, "known", request.requestId);
  ok(recovered.pid !== blocked.pid);
  eq(recovered.result.threadId, firstState.thread);
  eq(recovered.context.facts.length, 1);
  eq((await requestFor(blockedId)).requestId, request.requestId);
  eq((await state(blockedId)).blocker, null);

  console.log(
    JSON.stringify({
      scenario: "UNKNOWN_ACCEPTED_EVIDENCE_BLOCKED_KNOWN_RECOVERY",
      result: "PASS",
      checks,
    }),
  );

  // Unknown alone never proves permanent unavailability and cannot authorize another review.
  const waitId = await create("Phase2 unknown without unavailability support");
  const waiting = await run(waitId, "ask");
  const waitingState = await state(waitId);
  request = await requestFor(waitId);
  await unknownAnswer(waitId, request, "phase2-rewait-unknown");
  const rewaited = await run(waitId, "wait", request.requestId);
  eq(
    rewaited.result.state,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    JSON.stringify(rewaited),
  );
  eq(rewaited.claim.humanAnswerReviewRequired, true);
  const rewaitState = await state(waitId);
  eq(
    [rewaitState.als, rewaitState.blocker],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN, null],
  );
  ok(
    rewaitState.checkpoint !== waitingState.checkpoint,
    "new wait consumes the old UNKNOWN checkpoint binding",
  );
  eq(rewaitState.thread, waiting.result.threadId);
  eq(await inspect(waitId), {
    facts: 0,
    answers: 0,
    decisions: 0,
    artifacts: 0,
  });
  const unrequested = await http(
    "POST",
    `/internal/assessment-runtime/${waitId}/claim`,
    undefined,
    undefined,
    true,
  );
  eq(
    unrequested.status,
    409,
    "checkpoint-bound UNKNOWN cannot spin on a newly checkpointed wait",
  );
  request = await requestFor(waitId);
  eq(request.checkpointId, rewaitState.checkpoint);
  await knownAnswer(waitId, request, "phase2-rewait-known");
  const continued = await run(waitId, "known", request.requestId);
  eq(continued.result.threadId, waiting.result.threadId);
  eq(continued.context.facts.length, 1);

  console.log(
    JSON.stringify({
      scenario: "UNKNOWN_UNSUPPORTED_NATIVE_REWAIT_KNOWN_RECOVERY",
      result: "PASS",
      checks,
    }),
  );

  // One operational fact can anchor two rules without merging their coverage or decisions.
  const sharedId = await create(
    "Phase2 one customer fact supports two explicit rule dependencies",
  );
  const shared = await run(sharedId, "shared");
  eq(
    shared.result.state,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    JSON.stringify(shared),
  );
  request = await requestFor(sharedId);
  eq(request.dependencies.map((d) => d.assessmentRuleId).sort(), [
    "ER-RET",
    "ER-XREF",
  ]);
  const beforeCoverage = (
    await q(
      'SELECT "assessmentRuleId","resolutionState","decisionRevision","currentDecisionId" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"',
      [sharedId],
    )
  ).rows;
  eq(
    beforeCoverage
      .filter((c) => ["ER-RET", "ER-XREF"].includes(c.assessmentRuleId))
      .map((c) => c.resolutionState),
    [
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
      DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
    ],
  );
  const sharedKnown = await knownAnswer(
    sharedId,
    request,
    "phase2-shared-known",
  );
  const resumedShared = await run(sharedId, "known", request.requestId);
  eq(resumedShared.result.threadId, shared.result.threadId);
  eq(
    resumedShared.context.facts.map((f) => f.factId),
    [sharedKnown.factId],
  );
  eq((await requestFor(sharedId)).requestId, request.requestId);
  const afterCoverage = (
    await q(
      'SELECT "assessmentRuleId","resolutionState","decisionRevision","currentDecisionId" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"',
      [sharedId],
    )
  ).rows;
  eq(afterCoverage.length, beforeCoverage.length);
  ok(
    afterCoverage.every(
      (c) => c.decisionRevision === 0 && c.currentDecisionId === null,
    ),
    "shared answer never fabricates rule decisions",
  );
  ok(
    afterCoverage
      .filter((c) => ["ER-RET", "ER-XREF"].includes(c.assessmentRuleId))
      .every(
        (c) => c.resolutionState === DECISION_RESOLUTION_STATES.INVESTIGATING,
      ),
    "each dependent rule independently returns to investigation",
  );
  console.log(
    JSON.stringify({
      scenario: "SHARED_TWO_RULES_ONE_FACT",
      result: "PASS",
      checks,
    }),
  );

  for (const mode of ["wait", "block"]) {
    const crashId = await create(
      "Phase2 crash after review " + mode + " checkpoint",
    );
    const initial = await run(crashId, mode === "block" ? "ask-block" : "ask");
    const original = await state(crashId);
    const pendingRequest = await requestFor(crashId);
    await unknownAnswer(
      crashId,
      pendingRequest,
      "phase2-crash-unknown-" + mode,
    );
    await assert.rejects(
      run(crashId, mode + "-crash", pendingRequest.requestId),
      /exited 73/,
    );
    checks++;
    const crashed = await state(crashId);
    eq(crashed.aes, AGENT_EXECUTION_STATES.RUNNING);
    eq(
      crashed.checkpoint,
      original.checkpoint,
      "API finish has not committed the review descendant",
    );
    await q(
      `UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=now()-interval '1 second' WHERE "assessmentId"=$1`,
      [crashId],
    );
    const settled = await run(crashId, "recover", pendingRequest.requestId);
    eq(
      settled.result.state,
      AGENT_EXECUTION_STATES.INTERRUPTED,
      JSON.stringify(settled),
    );
    eq(settled.result.threadId, initial.result.threadId);
    eq(
      settled.result.executionId,
      crashed.execution,
      "lease recovery retains the interrupted review execution",
    );
    eq(settled.claim.recoveredExecution, true);
    eq(settled.claim.humanAnswerReviewCheckpointId, original.checkpoint);
    eq(
      settled.modelTurns,
      0,
      "descendant native wait settlement invokes no model",
    );
    ok(settled.result.checkpointId !== original.checkpoint);
    const settledState = await state(crashId);
    eq(
      settledState.als,
      mode === "block"
        ? ASSESSMENT_LIFECYCLE_STATES.BLOCKED
        : ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
    );
    eq((await requestFor(crashId)).checkpointId, settledState.checkpoint);
    eq(await inspect(crashId), {
      facts: 0,
      answers: 0,
      decisions: 0,
      artifacts: 0,
    });
    console.log(
      JSON.stringify({
        scenario: "CRASH_BEFORE_FINISH_" + mode.toUpperCase(),
        result: "PASS",
        checks,
      }),
    );
  }
  const failedId = await create(
    "Phase2 graceful failure after review checkpoint advances",
  );
  const beforeFailure = await run(failedId, "ask-block");
  const beforeFailureState = await state(failedId);
  request = await requestFor(failedId);
  await unknownAnswer(failedId, request, "phase2-graceful-failed-unknown");
  const failedReview = await run(failedId, "review-fail", request.requestId);
  eq(
    [failedReview.result.state, failedReview.result.errorType],
    [AGENT_EXECUTION_STATES.FAILED, "RuntimeError"],
  );
  eq(failedReview.catalogReadComplete, true);
  eq(
    [...failedReview.catalogRuleIds].sort(),
    ["ER-DEF", "ER-RET", "ER-XREF"],
    "review observed the complete legacy fixture catalog",
  );
  eq(
    failedReview.catalogReads.map(({ tool, arguments: args }) => ({ tool, args })),
    [
      { tool: "get_assessment_context", args: {} },
      { tool: "get_pinned_rule_set", args: { offset: 0, limit: 1 } },
      { tool: "get_pinned_rule_set", args: { offset: 1, limit: 1 } },
      { tool: "get_pinned_rule_set", args: { offset: 2, limit: 1 } },
    ],
    "every bounded native read completed before the scripted failure",
  );
  eq(failedReview.scriptedFailure, "phase2_review_model_failure");
  eq(
    failedReview.modelTurns,
    failedReview.catalogReads.length + 1,
    "one failing model turn follows the observed context and catalog reads",
  );
  eq(
    failedReview.remainingSteps,
    2,
    "the throwing step remains queued and the terminal script never executes",
  );
  const failedState = await state(failedId);
  eq(
    [failedState.als, failedState.aes],
    [
      ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
      AGENT_EXECUTION_STATES.FAILED,
    ],
  );
  ok(
    failedState.checkpoint !== beforeFailureState.checkpoint,
    "failed review retains its advanced native checkpoint",
  );
  eq(failedState.checkpoint, failedReview.result.checkpointId);
  eq(await inspect(failedId), {
    facts: 0,
    answers: 0,
    decisions: 0,
    artifacts: 0,
  });
  // A consumed review command cannot authorize another physical execution.
  const consumedReviewCommand = (
    await q(
      `SELECT o.id, o.payload, demand."admittedRunId", demand."completedAt"
       FROM "OutboxMessage" o
       JOIN "AssessmentRootAdmissionRequest" demand ON demand."commandId"=o.id
       WHERE o."aggregateId"=$1 AND o."eventType"=$2
       ORDER BY o."createdAt" DESC, o.id DESC LIMIT 1`,
      [failedId, ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED],
    )
  ).rows[0];
  ok(consumedReviewCommand?.completedAt, "failed review consumed its original demand");
  eq(
    consumedReviewCommand.payload.idempotencyKey,
    `human-review:${failedId}:${beforeFailureState.checkpoint}`,
  );
  const fixtureCapacityOwner = (
    await q(
      `SELECT "hostId", "incarnationId" FROM "AssessmentRootCapacity" WHERE id=$1`,
      [ROOT_CAPACITY_ID],
    )
  ).rows[0];
  ok(fixtureCapacityOwner?.hostId && fixtureCapacityOwner?.incarnationId);
  const consumedReplayRunId = randomUUID();
  const consumedReservation = await http(
    "POST",
    "/internal/assessment-root-capacity/reserve",
    {
      ...fixtureCapacityOwner,
      assessmentId: failedId,
      runId: consumedReplayRunId,
      commandKey: consumedReviewCommand.payload.idempotencyKey,
    },
    undefined,
    true,
  );
  eq(consumedReservation.status, 200, JSON.stringify(consumedReservation.body));
  eq(
    [consumedReservation.body.data.admitted, consumedReservation.body.data.obsolete],
    [false, true],
    "the exact consumed command is obsolete for a valid registered native identity",
  );
  const consumedReplay = await http(
    "POST",
    `/internal/assessment-runtime/${failedId}/claim`,
    {
      runtimeRunId: consumedReplayRunId,
      runtimeIncarnationId: fixtureCapacityOwner.incarnationId,
    },
    undefined,
    true,
  );
  eq(consumedReplay.status, 429, "consumed-demand replay cannot reserve a new Root");
  eq(consumedReplay.body.problem.code, ROOT_CAPACITY_ERROR_CODES.unavailable);
  eq(await state(failedId), failedState, "rejected replay preserves failed checkpoint state");

  // Provider-free transport recovery only. The existing owner Continue and audit
  // retry routes do not support LEGACY_FULL + FAILED + WAITING_FOR_HUMAN.
  // Supply a NEW synthetic command in this create-only disposable fixture, using
  // the established direct-root fixture transport pattern. Never reopen the
  // consumed demand or alter workflow, answer, checkpoint or execution state.
  const failedReviewRetryKey = `fixture-root-retry:${randomUUID()}`;
  await q(
    `INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",payload,status,attempts,"createdAt")
     VALUES ($1,'ASSESSMENT',$2,$3,$4::jsonb,'PENDING',0,now() AT TIME ZONE 'UTC')`,
    [
      failedReviewRetryKey,
      failedId,
      ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
      JSON.stringify({ assessmentId: failedId, idempotencyKey: failedReviewRetryKey }),
    ],
  );
  const retriedReview = await run(failedId, "block", request.requestId);
  eq(
    retriedReview.result.state,
    AGENT_EXECUTION_STATES.INTERRUPTED,
    JSON.stringify(retriedReview),
  );
  eq(retriedReview.result.threadId, beforeFailure.result.threadId);
  ok(
    retriedReview.result.executionId !== failedReview.result.executionId,
    "graceful failure retries under a fresh execution",
  );
  eq(retriedReview.claim.resumeCheckpointId, failedState.checkpoint);
  eq(
    retriedReview.claim.humanAnswerReviewCheckpointId,
    beforeFailureState.checkpoint,
  );
  eq(
    retriedReview.claim.humanAnswerReviewExecutionId,
    failedReview.result.executionId,
  );
  eq(retriedReview.claim.humanAnswerReviewRequired, true);
  const retainedConsumedCommand = (
    await q(
      `SELECT o.id, o.payload, demand."admittedRunId", demand."completedAt"
       FROM "OutboxMessage" o
       JOIN "AssessmentRootAdmissionRequest" demand ON demand."commandId"=o.id
       WHERE o.id=$1`,
      [consumedReviewCommand.id],
    )
  ).rows[0];
  eq(
    retainedConsumedCommand,
    consumedReviewCommand,
    "fresh transport recovery preserves the consumed command and admission receipt",
  );
  eq((await state(failedId)).als, ASSESSMENT_LIFECYCLE_STATES.BLOCKED);
  eq((await requestFor(failedId)).requestId, request.requestId);
  eq(await inspect(failedId), {
    facts: 0,
    answers: 0,
    decisions: 0,
    artifacts: 0,
  });
  console.log(
    JSON.stringify({
      scenario: "GRACEFUL_FAILED_REVIEW_CHECKPOINT_RETRY",
      result: "PASS",
      recoveryPath: "PROVIDER_FREE_SYNTHETIC_TRANSPORT",
      ownerUiRetryForLegacyFailedWaiting: false,
      consumedDemandReplayDenied: true,
      checks,
    }),
  );
  const reuseId = await create(
    "Phase2 resolved exact fact reused for another rule",
  );
  const reusable = await run(reuseId, "ask");
  request = await requestFor(reuseId);
  const reusableFact = await knownAnswer(
    reuseId,
    request,
    "phase2-source-known",
  );
  const reused = await run(reuseId, "reuse", request.requestId);
  eq(reused.result.threadId, reusable.result.threadId);
  eq(
    reused.result.state,
    AGENT_EXECUTION_STATES.FAILED,
    "partial scripted investigation cannot claim completion",
  );
  const reusedRequest = await requestFor(reuseId);
  eq(reusedRequest.requestId, request.requestId);
  eq(reusedRequest.dependencies.map((d) => d.assessmentRuleId).sort(), [
    "ER-RET",
    "ER-XREF",
  ]);
  eq(
    reused.context.facts.map((f) => f.factId),
    [reusableFact.factId],
  );
  eq(await inspect(reuseId), {
    facts: 1,
    answers: 1,
    decisions: 0,
    artifacts: 0,
  });
  eq(
    (await state(reuseId)).revision,
    1,
    "sharing an accepted fact does not advance the case revision",
  );
  eq(
    (await state(reuseId)).als,
    ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    "resolved-source sharing creates no new wait",
  );
  const selectedId = await create(
    "Selected audit UNKNOWN checkpoint review", null, ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
  );
  const selectedFirst = await run(selectedId, "ask-block");
  eq(selectedFirst.result.state, AGENT_EXECUTION_STATES.INTERRUPTED);
  const selectedRequest = await requestFor(selectedId);
  await unknownAnswer(selectedId, selectedRequest, "phase2-selected-unknown");
  const selectedReview = await run(selectedId, "block", selectedRequest.requestId);
  eq(selectedReview.result.state, AGENT_EXECUTION_STATES.INTERRUPTED, JSON.stringify(selectedReview));
  eq(selectedReview.claim.checkpointThreadId, selectedFirst.claim.checkpointThreadId);
  eq(selectedReview.claim.checkpointThreadId, selectedReview.context.auditRequest.requestId, "Selected review retains its exact audit checkpoint");
  eq(selectedReview.context.auditRequest.selectedRuleIds, ["ER-RET"]);
  eq((await state(selectedId)).blocker, BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE);
  eq((await requestFor(selectedId)).requestId, selectedRequest.requestId);
  eq(await inspect(selectedId), { facts: 0, answers: 0, decisions: 0, artifacts: 0 });
  console.log(JSON.stringify({
    scenario: "CUSTOMER_SELECTED_UNKNOWN_REVIEW", result: "PASS", checks,
    proof: "Provider-free selected audit with explicit synthetic admission; no production capacity claim",
  }));

  // Scope is part of the immutable snapshot, independent of an agent's path text.
  const beforeScopeChecks = checks;
  const prefix = "tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot";
  const scopedId = await create("Pinned chatbot-only source scope", prefix);
  const claimedScope = await http(
    "POST",
    "/internal/assessment-runtime/" + scopedId + "/claim",
    {},
    undefined,
    true,
  );
  eq(claimedScope.status, 200, JSON.stringify(claimedScope.body));
  const scopeLease = claimedScope.body.data.leaseToken;
  const scopedCall = (method, route, body) =>
    http(
      method,
      "/internal/assessment-runtime/" + scopedId + route,
      body,
      undefined,
      true,
      scopeLease,
    );
  const scopedContext = await scopedCall("GET", "/context");
  eq(scopedContext.status, 200, JSON.stringify(scopedContext.body));
  eq(scopedContext.body.data.sourcePathPrefix, prefix);
  eq(
    scopedContext.body.data.facts,
    [],
    "scoped assessment inherits no historical facts",
  );
  eq(
    scopedContext.body.data.evidence,
    [],
    "scoped assessment inherits no historical evidence",
  );
  const sourceRequest = (relativePath) => ({
    type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
    repositoryCommit: "c".repeat(40),
    path: relativePath,
    startLine: 1,
    endLine: 1,
    excerptSha256: contentHash("fixture-scoped-source"),
  });
  const permittedSource = await scopedCall(
    "POST",
    "/evidence",
    sourceRequest(prefix + "/app.py"),
  );
  eq(permittedSource.status, 200, JSON.stringify(permittedSource.body));
  const permittedReplay = await scopedCall(
    "POST",
    "/evidence",
    sourceRequest(prefix + "/app.py"),
  );
  eq(permittedReplay.status, 200);
  eq(permittedReplay.body.data.replayed, true);
  for (const outside of [
    "tkh/Astromo/TheConstruct/src/utils/aiService.js",
    "tkh/upworkProjects/ScriptToImages/generateimages.py",
    "tkh/Game/Dig4Dinos/README.md",
    prefix + "-other/app.py",
  ]) {
    const rejected = await scopedCall(
      "POST",
      "/evidence",
      sourceRequest(outside),
    );
    eq(rejected.status, 422, JSON.stringify(rejected.body));
    eq(
      rejected.body.problem.code,
      ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
    );
  }
  for (const ambiguous of [
    prefix + "/../outside.py",
    prefix + "\\outside.py",
    prefix + "/%2e%2e/outside.py",
    prefix + "//app.py",
  ]) {
    const rejected = await scopedCall(
      "POST",
      "/evidence",
      sourceRequest(ambiguous),
    );
    eq(rejected.status, 422, "ambiguous source paths never become evidence");
  }
  const covered = {
    type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
    repositoryCommit: "c".repeat(40),
    scopes: [
      { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: prefix },
    ],
    queries: [
      { tool: "grep", query: "notice", resultCount: 1, truncated: false },
    ],
    inspectedEntryPoints: [prefix + "/app.py"],
    knownGaps: [],
    directSourceFallbacks: [
      { path: prefix + "/README.md", reason: "Verified direct source" },
    ],
  };
  const acceptedCoverage = await scopedCall("POST", "/evidence", covered);
  eq(acceptedCoverage.status, 200, JSON.stringify(acceptedCoverage.body));
  for (const invalid of [
    {
      ...covered,
      scopes: [
        { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: "." },
      ],
    },
    {
      ...covered,
      inspectedEntryPoints: ["tkh/Astromo/TheConstruct/README.md"],
    },
    {
      ...covered,
      directSourceFallbacks: [
        { path: "tkh/Game/Dig4Dinos/README.md", reason: "outside" },
      ],
    },
  ]) {
    const rejected = await scopedCall("POST", "/evidence", invalid);
    eq(rejected.status, 422, JSON.stringify(rejected.body));
    eq(
      rejected.body.problem.code,
      ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
    );
  }
  // Even an imported legacy row with a matching deterministic identity cannot bypass the scope guard through replay.
  const { deterministicUuid } = await import(
    path.join(root, "apps/api/dist/src/modules/assessment/domain/domain-ids.js")
  );
  const legacy = sourceRequest(
    "tkh/Astromo/TheConstruct/src/utils/aiService.js",
  );
  const legacyIdentity = deterministicUuid(
    scopedId +
      "|" +
      legacy.repositoryCommit +
      "|" +
      legacy.type +
      "|" +
      legacy.path +
      "|1|1|" +
      legacy.excerptSha256,
  );
  await q(
    'INSERT INTO "AssessmentEvidence"("evidenceId","assessmentId",type,"repositoryCommit","contentSha256",payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
    [
      legacyIdentity,
      scopedId,
      legacy.type,
      legacy.repositoryCommit,
      legacy.excerptSha256,
      JSON.stringify({ path: legacy.path, startLine: 1, endLine: 1 }),
    ],
  );
  const outsideReplay = await scopedCall("POST", "/evidence", legacy);
  eq(outsideReplay.status, 422);
  eq(
    outsideReplay.body.problem.code,
    ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_SOURCE_SCOPE_MISMATCH,
  );
  eq(
    (await inspect(scopedId)).facts,
    0,
    "source checks create no factual or legal conclusion",
  );
  const scopeSnapshot = (
    await q('SELECT * FROM "RepositorySnapshot" WHERE "assessmentId"=$1', [
      scopedId,
    ])
  ).rows[0];
  for (const replacement of [null, "tkh", prefix + "/nested"]) {
    await assert.rejects(
      q('UPDATE "RepositorySnapshot" SET "sourcePathPrefix"=$1 WHERE id=$2', [
        replacement,
        scopeSnapshot.id,
      ]),
      /immutable/i,
    );
    checks++;
  }
  await q('UPDATE "RepositorySnapshot" SET "sourcePathPrefix"=$1 WHERE id=$2', [
    prefix,
    scopeSnapshot.id,
  ]);
  eq(
    (
      await q(
        'SELECT "sourcePathPrefix" FROM "RepositorySnapshot" WHERE id=$1',
        [scopeSnapshot.id],
      )
    ).rows[0].sourcePathPrefix,
    prefix,
  );
  for (const invalidPrefix of [
    "",
    "../chatbot",
    "/chatbot",
    "chatbot/",
    "chatbot//src",
    "chatbot/./src",
    "chatbot\\src",
    "chatbot:%2Fsrc",
    " chatbot",
    "chatbot\n",
  ]) {
    await assert.rejects(
      q(
        'INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId","sourcePathPrefix") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
        [
          randomUUID(),
          scopedId,
          scopeSnapshot.connectionId,
          scopeSnapshot.repositoryId,
          scopeSnapshot.repositoryFullName,
          scopeSnapshot.commitSha,
          JSON.stringify(scopeSnapshot.providerMetadata),
          scopeSnapshot.actorId,
          invalidPrefix,
        ],
      ),
      /sourcePathPrefix_canonical_check/i,
    );
    checks++;
  }
  const oldWholeSnapshot = (
    await q(
      'SELECT id,"sourcePathPrefix" FROM "RepositorySnapshot" WHERE "assessmentId"=$1',
      [blockedId],
    )
  ).rows[0];
  eq(
    oldWholeSnapshot.sourcePathPrefix,
    null,
    "historical whole-repository semantics stay null",
  );
  await assert.rejects(
    q('UPDATE "RepositorySnapshot" SET "sourcePathPrefix"=$1 WHERE id=$2', [
      prefix,
      oldWholeSnapshot.id,
    ]),
    /immutable/i,
  );
  checks++;
  const finishedScope = await scopedCall("POST", "/finish", {
    state: AGENT_EXECUTION_STATES.FAILED,
  });
  eq(
    finishedScope.status,
    200,
    "bounded scope probe cannot claim a complete assessment",
  );
  const sourceScopeChecks = checks - beforeScopeChecks;
  console.log(
    JSON.stringify({
      scenario: "IMMUTABLE_SCOPED_SOURCE_AND_SEARCH_EVIDENCE",
      result: "PASS",
      checks,
      scenarioChecks: sourceScopeChecks,
    }),
  );

  console.log(
    JSON.stringify({
      gate: "PHASE2_HITL_REVIEW_SHARED_FACTS_AND_SOURCE_SCOPE",
      sourceScopeChecks,
      result: "PASS",
      checks,
      database,
      checkpointDatabase,
      proof:
        "real migrated API/PostgresSaver and separate worker processes; scripted model only",
      threads: [firstState.thread, waitingState.thread, shared.result.threadId],
    }),
  );
} finally {
  await stop();
}