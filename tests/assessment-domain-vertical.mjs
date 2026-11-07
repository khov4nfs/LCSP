// Run: node --experimental-strip-types tests/assessment-domain-vertical.mjs (needs a built API: pnpm --dir apps/api run build)
// ASSESSMENT vertical on REAL components: a fresh migrated PostgreSQL database (loopback test container,
// default 55441), the REAL built API over HTTP (customer sign-in, assessment creation, repository
// setup completion, worker tool plane) and the REAL Python Assessment Root graph + governed tools +
// native task() researcher. Only the model is scripted: this proves plumbing, authority, isolation,
// pins, atomicity and concurrency - NOT reasoning quality.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_COMPLETION_BLOCKER_CODES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  RULE_AUDIT_PROGRESS_STATES,
  RULE_AUDIT_SCOPE_MODES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  answerAssessmentHumanRequestSchema,
  assessmentHumanRequestsResultSchema,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";

import {
  contentHash,
  root,
  runPython as runPythonUnbounded,
  startStack,
  workerKey,
} from "./support/compliance-rule-set-stack.mjs";
import { runAdaptiveCapacityLoad } from "./support/adaptive-capacity-load.mjs";
import { runAdaptiveCapacityFaults } from "./support/adaptive-capacity-faults.mjs";

const requireApi = createRequire(path.join(root, "apps/api/package.json"));
const {
  ArtifactLifecycleState,
  AssessmentArtifactKind,
} = requireApi("@prisma/client");
const { PDFParse } = requireApi("pdf-parse");

const PYTHON_PHASE_DEADLINE_MS = 10 * 60 * 1000;
const HTTP_PHASE_DEADLINE_MS = 60 * 1000;
const PDF_PHASE_DEADLINE_MS = 3 * 60 * 1000;
let activePhase = "SCRIPT_SETUP";
const logPhase = (phase, state, detail = "") => {
  if (state === "START") activePhase = phase;
  console.log(
    `[ASSESSMENT_VERTICAL] ${state} ${phase}${detail ? ` ${detail}` : ""}`,
  );
};
const runPython = (script, args, options = {}) => {
  const phase = path.basename(script);
  const timeoutMs = options.timeoutMs ?? PYTHON_PHASE_DEADLINE_MS;
  const ownedProcessGroup =
    options.ownedProcessGroup ?? process.platform !== "win32";
  logPhase(`PYTHON_SUBPROCESS_WAIT:${phase}`, "START", `deadlineMs=${timeoutMs}`);
  return runPythonUnbounded(script, args, {
    ...options,
    timeoutMs,
    ownedProcessGroup,
  })
    .then((result) => {
      logPhase(`PYTHON_SUBPROCESS_WAIT:${phase}`, "COMPLETE");
      return result;
    })
    .catch((error) => {
      logPhase(`PYTHON_SUBPROCESS_WAIT:${phase}`, "FAILED", `error=${error.name}`);
      throw error;
    });
};
async function fetchWithDeadline(
  phase,
  url,
  options = {},
  timeoutMs = HTTP_PHASE_DEADLINE_MS,
) {
  logPhase(`HTTP_REQUEST_WAIT:${phase}`, "START", `deadlineMs=${timeoutMs}`);
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(timeoutMs),
    });
    logPhase(`HTTP_REQUEST_WAIT:${phase}`, "COMPLETE", `status=${response.status}`);
    return response;
  } catch (error) {
    logPhase(`HTTP_REQUEST_WAIT:${phase}`, "FAILED", `error=${error.name}`);
    throw error;
  }
}

const database = process.env.LCSP_ASSESSMENT_TEST_DATABASE ?? "lcsp_assessment_vertical";
assert.match(database, /^lcsp_assessment_[a-z0-9_]+$/);
const apiPort = Number(process.env.LCSP_ASSESSMENT_TEST_API_PORT ?? 3413);
const artifactStoragePath = mkdtempSync(
  path.join(tmpdir(), "lcsp-assessment-artifacts-"),
);
const previousArtifactStoragePath = process.env.LCSP_ARTIFACT_STORAGE_PATH;
process.env.LCSP_ARTIFACT_STORAGE_PATH = artifactStoragePath;
const previousAgentServerUrl = process.env.LCSP_AGENT_SERVER_URL;
process.env.LCSP_AGENT_SERVER_URL = `http://127.0.0.1:${Number(process.env.LCSP_TEST_AGENT_SERVER_PORT ?? 3417)}`;
let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message ?? "actual value differs from expected value");
  checks += 1;
};

const LOCATORS = [
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
const DOC = "SYNTHETIC-NOTICE-INSTRUMENT";
const contentFor = (locator, variant) =>
  `content ${locator}${variant === "b" && locator === "art-5::cl-1" ? " v2" : ""}`;
const twentyRulePacket = () => {
  const reference = (locator) => ({
    documentId: DOC,
    locator,
    contentSha256: contentHash(contentFor(locator, "a")),
  });
  const rows = Array.from({ length: 20 }, (_, index) => {
    const ordinal = index + 1;
    const ruleId =
      ordinal === 3
        ? "ER-RET"
        : ordinal === 9
          ? "ER-XREF"
          : `ER-R${String(ordinal).padStart(2, "0")}`;
    const legalRequirementId =
      ordinal === 3
        ? "LR-RET"
        : ordinal === 9
          ? "LR-XREF"
          : `LR-R${String(ordinal).padStart(2, "0")}`;
    const locator = LOCATORS[(ordinal - 1) % LOCATORS.length];
    const refs = [reference(locator)];
    return {
      legalRequirement: {
        legalRequirementId,
        title: `Synthetic requirement ${ordinal}`,
        proposition: `Requirement ${ordinal} governs the synthetic service.`,
        applicabilityConditions: ["Applies to the service that stores notices."],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: refs,
        coverage: {
          state: "COVERED_BY_ASSESSMENT_RULES",
          nonAssessableReason: null,
        },
      },
      assessmentRule: {
        assessmentRuleId: ruleId,
        legalRequirementIds: [legalRequirementId],
        concept: `Synthetic control ${ordinal}`,
        legalIntent: "Ensure the legal intent is met.",
        applicabilityGuidance: "Applies when the described condition holds.",
        criteria: [{ criterionId: "C-1", statement: "The control exists." }],
        investigationGoals: ["find the control"],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: [],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        requiredEvidence: ["control implementation"],
        supportingEvidence: [],
        negativeEvidence: [],
        unresolvedConditions: [],
        sourceRefs: refs,
      },
    };
  });
  return {
    legalRequirements: rows.map((row) => row.legalRequirement),
    assessmentRules: rows.map((row) => row.assessmentRule),
    contextRelations: [],
  };
};
const COMMIT = "c".repeat(40);

const { q, base, post, stop, seedLegalSource, activateLegalSource, databaseUrl, checkpointDatabaseUrl, admission, server, apiEnv } = await startStack({
  database,
  apiPort,
  checkpointDatabase: process.env.LCSP_TEST_CHECKPOINT_DATABASE,
  operationTimeoutMs: 2 * 60 * 1000,
});
const { hashSecret } = await import(
  pathToFileURL(
    path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js"),
  ).href,
);
const { canonicalJson } = await import(
  pathToFileURL(
    path.join(root, "apps/api/dist/src/modules/assessment/domain/domain-ids.js"),
  ).href,
);

/** HTTP helper for non-rule set routes. */
async function http(method, route, { body, token, worker, lease } = {}) {
  const claim = route.match(/^\/internal\/assessment-runtime\/([^/]+)\/claim$/);
  if (claim && worker !== false) body = await admission.prepare(claim[1], body, { manual: true });
  const response = await fetchWithDeadline(
    `${method} ${route.split("?")[0]}`,
    `${base}${route}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(worker === false ? {} : { "x-worker-api-key": workerKey }),
        ...(lease ? { "x-assessment-lease": lease } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (response.ok && route.endsWith("/finish")) await admission.finishManual(route.split("/")[3]);
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}
const runtime = (assessmentId, route, opts) =>
  http(
    opts?.method ?? "POST",
    `/internal/assessment-runtime/${assessmentId}/${route}`,
    opts,
  );
const customerHttp = (method, route, token, body) =>
  http(method, route, { body, token, worker: false });

try {
  logPhase("DATABASE_AND_API_READY", "COMPLETE");
  // ---- compliance rule set P1 (legalSource A) through the real COMPLIANCE_RULE_SET path ---------------------------------
  logPhase("RULE_SET_P1", "START");
  const seedLegalSourceVersion = (name, variant, status) => {
    const sourceBytes = Buffer.from(LOCATORS.map((locator) => contentFor(locator, variant)).join("\n") + "\n", "utf8");
    const lines = sourceBytes.toString("utf8").split("\n");
    return seedLegalSource({
      name,
      status,
      documentId: DOC,
      sourceBytes,
      sourceSha256: contentHash(sourceBytes),
      chunks: LOCATORS.map((locator, index) => {
        const content = lines[index];
        return { locator, content, contentSha256: contentHash(content) };
      }),
    });
  };
  const legalSourceA = await seedLegalSourceVersion("assessment-a", "a", "ACTIVE");
  const legalSourceB = await seedLegalSourceVersion("assessment-b", "b", "ACTIVE");
  const seedDir = mkdtempSync(path.join(tmpdir(), "lcsp-assessment-vertical-"));
  const seedFile = path.join(seedDir, "seed.json");
  const prepareRuleSet = async (legalSourceId, packet) => {
    writeFileSync(
      seedFile,
      JSON.stringify({
        hashes: Object.fromEntries(
          LOCATORS.map((l) => [l, contentHash(contentFor(l, "a"))]),
        ),
        ...(packet ? { packet } : {}),
      }),
    );
    // The activation event (delivered to the real consumer) starts the one automatic run.
    const started = await activateLegalSource(legalSourceId);
    eq(started.runs.length, 1, "one Legal Source -> one automatic preparation");
    const result = await runPython(
      path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
      [base, workerKey, started.preparationRunId, seedFile, "valid"],
    );
    eq(result.state, "SUCCEEDED", JSON.stringify(result));
    return result.submission.ruleSetVersionId;
  };
  const ruleSet1 = await prepareRuleSet(legalSourceA);
  const ruleCount = (
    await q(
      `SELECT count(*)::int AS n FROM "AssessmentRule" WHERE "ruleSetVersionId"=$1`,
      [ruleSet1],
    )
  ).rows[0].n;
  eq(ruleCount, 3);

  // ---- customers, assessments, repository snapshots --------------------------------------------
  const password = "CorrectHorseBatteryStaple!";
  const customer = async (email) => {
    const id = randomUUID();
    await q(
      `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
      [id, email, hashSecret(password)],
    );
    const signIn = await http("POST", "/auth/sign-in", {
      body: { email, password, organization_id: "org-1" },
      worker: false,
    });
    eq(signIn.status, 200, JSON.stringify(signIn.body));
    return { id, token: signIn.body.data.session_token };
  };
  const owner = await customer("assessment-owner@acme.test");

  const repoDir = mkdtempSync(path.join(tmpdir(), "lcsp-assessment-repo-"));
  mkdirSync(path.join(repoDir, "src"));
  writeFileSync(
    path.join(repoDir, "src/retention.py"),
    "a = 1\nb = 2\nkeep_days = 7\nc = 4\n",
  );

  const newAssessment = async (name, actor = owner) => {
    const created = await customerHttp("POST", "/assessments", actor.token, {
      name,
    });
    eq(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.assessment_id ?? created.body.data.id;
    const connection = randomUUID();
    const snapshot = randomUUID();
    await q(
      `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions)
       VALUES ($1,$2,$3,'inst-assessment',$4,'repo','acme/repo','main','{}'::jsonb)`,
      [connection, id, actor.id, `repo-${id}`],
    );
    await q(
      `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId")
       VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}'::jsonb,$6)`,
      [snapshot, id, connection, `repo-${id}`, COMMIT, actor.id],
    );
    return { id, snapshot };
  };
  const lifecycle = async (id) =>
    (
      await q(
        `SELECT "lifecycleState","lifecycleRevision" FROM "Assessment" WHERE id=$1`,
        [id],
      )
    ).rows[0];

  if (process.env.LCSP_TEST_CAPACITY_FAULTS === "1") {
    await runAdaptiveCapacityFaults({
      stack: { q, base, databaseUrl, checkpointDatabaseUrl, server, apiEnv },
      createAssessment: newAssessment,
      owner,
      otherOwner: await customer("fault-other@acme.test"),
      repoDir,
    });
  } else if (process.env.LCSP_TEST_CAPACITY_LOAD === "1") {
    await runAdaptiveCapacityLoad({ stack: { q, base, databaseUrl, checkpointDatabaseUrl },
      createAssessment: newAssessment, owner, otherOwner: await customer("capacity-other@acme.test"), repoDir });
  } else {
  const A = await newAssessment("ASSESSMENT vertical A");
  // creation: canonical lifecycle PREPARING, one server thread, the then-ACTIVE rule set pinned, no repo pin yet
  eq((await lifecycle(A.id)).lifecycleState, "PREPARING");
  const created = (
    await q(
      `SELECT c."ruleSetVersionId" AS "ruleSet", c."repositorySnapshotId" AS snapshot, r."threadId" AS thread FROM "AssessmentCase" c JOIN "AssessmentRuntime" r USING("assessmentId") WHERE c."assessmentId"=$1`,
      [A.id],
    )
  ).rows[0];
  eq([created.ruleSet, created.snapshot], [ruleSet1, null]);
  const threadA = created.thread;

  // an assessment cannot reason before it is prepared
  eq((await runtime(A.id, "claim")).body.problem.code, "ASSESSMENT_NOT_ACTIVE");

  // repository setup pins the snapshot and activates without selecting or covering rules
  const setup = await customerHttp(
    "POST",
    `/assessments/${A.id}/repository-setup/complete`,
    owner.token,
  );
  eq(setup.status, 201, JSON.stringify(setup.body));
  eq((await lifecycle(A.id)).lifecycleState, "ACTIVE");
  const pinned = (
    await q(
      `SELECT "repositorySnapshotId" AS snapshot, "repositoryCommit" AS commit, "repositoryScanJobId" AS job FROM "AssessmentCase" WHERE "assessmentId"=$1`,
      [A.id],
    )
  ).rows[0];
  eq([pinned.snapshot, pinned.commit], [A.snapshot, COMMIT]);
  eq(
    (
      await q(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE "resolutionState"='PENDING')::int AS pending FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0],
    { n: 0, pending: 0 },
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"='command.assessment.root.requested.v1'`,
        [A.id],
      )
    ).rows[0].n,
    0,
  );
  const setupAgain = await customerHttp(
    "POST",
    `/assessments/${A.id}/repository-setup/complete`,
    owner.token,
  );
  ok(setupAgain.status < 300, "idempotent setup completion");
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"='command.assessment.root.requested.v1'`,
        [A.id],
      )
    ).rows[0].n,
    0,
  );

  // This legacy vertical journey explicitly opts into the full pinned Rule Set before Root runs.
  const catalogResponse = await customerHttp(
    "GET",
    `/assessments/${A.id}/rules?offset=0&limit=100`,
    owner.token,
  );
  eq(catalogResponse.status, 200, JSON.stringify(catalogResponse.body));
  const catalog = catalogResponse.body.data;
  eq(catalog.total, ruleCount);
  const audit = await customerHttp(
    "POST",
    `/assessments/${A.id}/rule-audits`,
    owner.token,
    {
      idempotencyKey: randomUUID(),
      expectedAuditRevision: catalog.auditRevision,
      ruleSetVersionId: catalog.ruleSetVersionId,
      ruleSetDigest: catalog.ruleSetDigest,
      repositorySnapshotId: catalog.repositorySnapshotId,
      repositoryCommit: catalog.repositoryCommit,
      scopeMode: RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET,
      rules: [],
    },
  );
  eq(audit.status, 201, JSON.stringify(audit.body));
  eq(audit.body.data.requested, ruleCount);
  eq(
    (
      await q(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE "resolutionState"='PENDING')::int AS pending FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0],
    { n: ruleCount, pending: ruleCount },
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"='command.assessment.root.requested.v1'`,
        [A.id],
      )
    ).rows[0].n,
    1,
  );

  // tool plane rejects missing/foreign credentials
  eq(
    (await runtime(A.id, "context", { method: "GET", worker: false })).status,
    401,
  );
  eq(
    (await runtime(A.id, "context", { method: "GET" })).body.problem.code,
    "ASSESSMENT_EXECUTION_LEASE_INVALID",
  );

  // ---- the REAL Root on assessment A -------------------------------------------------------------
  logPhase("ASSESSMENT_ROOT_INITIAL", "START");
  const script = path.join(root, "deepagents/tests/vertical/scripted_root.py");
  const rootOptions = {
    env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl },
  };
  const first = await runPython(script, [
    base,
    workerKey,
    A.id,
    repoDir,
    "full",
  ], rootOptions);
  // This partial-work fixture deliberately exhausts its offline model before finalization.
  // A normal response cannot falsely settle unfinished domain work as SUCCEEDED.
  eq(first.result.state, AGENT_EXECUTION_STATES.FAILED, JSON.stringify(first));
  eq(first.result.errorType, "AssertionError", JSON.stringify(first));
  ok(first.result.checkpointId, "failed native work retains its checkpoint");
  eq(first.remainingSteps, 0);
  eq(first.captured.catalogPages.map((page) => page.assessmentRules.length), [1, 1, 1],
    "the scripted Root follows every bounded catalog page");
  ok(first.captured.boundedReads.some((read) => read.tool === "get_assessment_rule_detail"),
    "the oversized rule is read through real native detail calls before deciding");
  eq(first.result.threadId, threadA);
  eq(first.captured.graphConfig, {
    threadId: audit.body.data.requestId,
    checkpointNamespace: "",
  }, "selected Root uses a request-isolated native root thread");
  // the validator rejected the bad attempt with mechanical codes and the Root corrected itself
  eq(first.captured.rejected.ok, false);
  eq(first.captured.rejected.code, "ASSESSMENT_DECISION_VALIDATION_FAILED", JSON.stringify({ rejected: first.captured.rejected, context: first.captured.context }));
  for (const failure of [
    "UNKNOWN_LEGAL_CONTEXT:LR-NOT-LINKED",
    ...first.captured.rule_set.assessmentRules.find((r) => r.assessmentRuleId === "ER-RET").criterionIds.map((id) => `CRITERIA_INCOMPLETE:${id}`),
    "UNKNOWN_CRITERION:C-9",
  ]) {
    ok(
      first.captured.rejected.failures.includes(failure),
      `validator reported ${failure}`,
    );
  }
  eq(
    [
      first.captured.decision_ret.ok,
      first.captured.decision_ret.decisionRevision,
    ],
    [true, 1],
    JSON.stringify(first.captured.decision_ret),
  );

  // every pinned rule is covered by exactly one accepted decision
  const coverage = (
    await q(
      `SELECT "assessmentRuleId" AS rule, "resolutionState" AS state, "decisionRevision" AS rev FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 ORDER BY 1`,
      [A.id],
    )
  ).rows;
  eq(coverage, [
    { rule: "ER-DEF", state: "RESOLVED", rev: 1 },
    { rule: "ER-RET", state: "RESOLVED", rev: 1 },
    { rule: "ER-XREF", state: "RESOLVED", rev: 1 },
  ]);
  const decisions = (
    await q(
      `SELECT "assessmentRuleId" AS rule, applicability, compliance, state, "ruleSetVersionId" AS "ruleSet", "repositoryCommit" AS commit FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 ORDER BY 1`,
      [A.id],
    )
  ).rows;
  eq(
    decisions.map((d) => [d.rule, d.applicability, d.compliance, d.state]),
    [
      ["ER-DEF", "NOT_APPLICABLE", null, "ACCEPTED"],
      ["ER-RET", "APPLICABLE", "COMPLIANT", "ACCEPTED"],
      ["ER-XREF", "APPLICABLE", "NON_COMPLIANT", "ACCEPTED"],
    ],
  );
  ok(
    decisions.every((d) => d.ruleSet === ruleSet1 && d.commit === COMMIT),
    "decisions carry the immutable pins",
  );
  // evidence is server-minted, pinned, typed (source + search coverage subtype in ONE ledger)
  const evidence = (
    await q(
      `SELECT type, state, "repositoryCommit" AS commit FROM "AssessmentEvidence" WHERE "assessmentId"=$1 ORDER BY type`,
      [A.id],
    )
  ).rows;
  eq(evidence, [
    { type: "REPOSITORY_SOURCE", state: "ACCEPTED", commit: COMMIT },
    { type: "SEARCH_COVERAGE", state: "ACCEPTED", commit: COMMIT },
  ]);
  const facts = (
    await q(
      `SELECT kind, authority, "caseRevision" AS rev FROM "AssessmentCaseFact" WHERE "assessmentId"=$1`,
      [A.id],
    )
  ).rows;
  eq(facts, [{ kind: "USE_CASE", authority: "EVIDENCE_CITED", rev: 1 }]);

  // ---- events: one ordered stream, one thread, researcher lineage -------------------------------
  logPhase("ROOT_EVENT_AND_RESEARCHER_CHECKS", "START");
  const events = (
    await q(
      `SELECT sequence, "eventType" AS type, "actorType" AS actor, "threadId" AS thread, "executionId" AS exec, "parentExecutionId" AS parent, "taskId" AS task FROM "AssessmentEvent" WHERE "assessmentId"=$1 ORDER BY sequence`,
      [A.id],
    )
  ).rows;
  eq(
    events.map((e) => e.sequence),
    events.map((_, i) => i + 1),
    "gap-free monotonic sequence",
  );
  eq([...new Set(events.map((e) => e.thread))], [threadA]);
  const rootExecution = first.result.executionId;
  const children = events.filter((e) => e.actor === "SUBAGENT");
  eq(children.length, 2);
  ok(
    children.every(
      (e) => e.parent === rootExecution && e.exec !== rootExecution && e.task,
    ),
    "task events descend from the Root execution",
  );
  eq(events.filter((e) => e.type === "DECISION_ACCEPTED").length, 3);
  eq(events.filter((e) => e.type === "EVIDENCE_ACCEPTED").length, 2);
  const executionStates = events.filter(
    (e) => e.type === "EXECUTION_STATE_CHANGED",
  ).length;
  eq(executionStates, 2); // QUEUED->RUNNING, RUNNING->FAILED (offline model exhausted)
  eq(
    (
      await q(
        `SELECT "executionState" AS s, "leaseToken" AS lease FROM "AssessmentRuntime" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0],
    { s: AGENT_EXECUTION_STATES.FAILED, lease: null },
  );

  // ---- restart: retain native state on the SAME thread and reload server authority -----------
  logPhase("ASSESSMENT_ROOT_RESUME", "START");
  const failedCheckpoint = (await q(
    `SELECT "checkpointId" AS checkpoint FROM "AssessmentRuntime" WHERE "assessmentId"=$1`,
    [A.id],
  )).rows[0].checkpoint;
  eq(failedCheckpoint, first.result.checkpointId, "API binds the failed native checkpoint");
  const second = await runPython(script, [
    base,
    workerKey,
    A.id,
    repoDir,
    "resume",
  ], rootOptions);
  eq(
    second.result.state,
    AGENT_EXECUTION_STATES.FAILED,
    JSON.stringify(second),
  );
  eq(second.result.errorType, "AssertionError", JSON.stringify(second));
  ok(second.result.checkpointId !== failedCheckpoint, "same-thread retry advances the native checkpoint");
  eq(second.result.threadId, threadA);
  eq(second.captured.graphConfig, {
    threadId: audit.body.data.requestId,
    checkpointNamespace: "",
  }, "failed selected work retries on its own native root thread");
  ok(
    second.result.executionId !== rootExecution,
    "retry uses a new execution ID",
  );
  const resumed = second.captured.context;
  ok(!Object.hasOwn(resumed, "coverage"), "the governed context remains a compact summary");
  eq(resumed.coverageSummary.totalRuleCount, 3);
  eq(resumed.coverageSummary.resolutionCounts, { RESOLVED: 3 });
  eq(second.captured.coveragePages.map((page) => [page.offset, page.nextOffset]),
    [[0, 1], [1, 2], [2, null]], "restart reads every snapshot-bound coverage page");
  ok(second.captured.coveragePages.every((page) =>
    page.snapshotToken === resumed.coverageSummary.snapshotToken &&
    page.caseRevision === resumed.caseRevision),
  "restart coverage retains the fresh context snapshot and case revision");
  eq(
    second.captured.coverage.map((c) => [c.assessmentRuleId, c.resolutionState]),
    [
      ["ER-DEF", "RESOLVED"],
      ["ER-RET", "RESOLVED"],
      ["ER-XREF", "RESOLVED"],
    ],
  );
  eq(
    [resumed.contextCollections.counts.facts, resumed.contextCollections.counts.evidence],
    [1, 2],
    "restart retains fact/evidence counts through bounded context collections",
  );
  ok(
    !Object.hasOwn(resumed, "facts") && !Object.hasOwn(resumed, "evidence"),
    "restart does not reintroduce unbounded facts/evidence into model-facing context",
  );
  eq(resumed.pins.ruleSetVersionId, ruleSet1);
  eq(
    (
      await q(
        `SELECT count(DISTINCT "threadId")::int AS n FROM "AssessmentEvent" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0].n,
    1,
  );
  eq(
    (
      await q(
        `SELECT "threadId" AS t FROM "AssessmentRuntime" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0].t,
    threadA,
  );
  const legacyReport = await customerHttp(
    "POST",
    `/assessments/${A.id}/documents/final-report`,
    owner.token,
  );
  eq(
    legacyReport.status,
    404,
    "retired V1 report route cannot bypass the canonical artifact path",
  );

  // ---- selected batches: one rule result is visible, then a fresh request adds another ----------
  logPhase("SELECTED_RULE_BATCHES", "START");
  const legalSourceTwenty = await seedLegalSourceVersion(
    "assessment-twenty-rule",
    "a",
    "ACTIVE",
  );
  const ruleSetTwenty = await prepareRuleSet(
    legalSourceTwenty,
    twentyRulePacket(),
  );
  const pinnedRuleCountTwenty = (
    await q(
      `SELECT count(*)::int AS n FROM "AssessmentRule" WHERE "ruleSetVersionId"=$1`,
      [ruleSetTwenty],
    )
  ).rows[0].n;
  eq(pinnedRuleCountTwenty, 20, "the selected fixture pins twenty rules");
  const selectedAssessment = await newAssessment(
    "Selected rule 3 followed by rule 9 from twenty pinned rules",
  );
  const selectedSetup = await customerHttp(
    "POST",
    `/assessments/${selectedAssessment.id}/repository-setup/complete`,
    owner.token,
  );
  eq(selectedSetup.status, 201, JSON.stringify(selectedSetup.body));
  const selectedCatalog = await customerHttp(
    "GET",
    `/assessments/${selectedAssessment.id}/rules?offset=0&limit=100`,
    owner.token,
  );
  eq(selectedCatalog.status, 200, JSON.stringify(selectedCatalog.body));
  const submitSelected = async (catalog, ruleId) => {
    const rule = catalog.body.data.rules.find(
      (candidate) => candidate.assessmentRuleId === ruleId,
    );
    ok(rule, `fixture contains ${ruleId}`);
    return customerHttp(
      "POST",
      `/assessments/${selectedAssessment.id}/rule-audits`,
      owner.token,
      {
        idempotencyKey: randomUUID(),
        expectedAuditRevision: catalog.body.data.auditRevision,
        ruleSetVersionId: catalog.body.data.ruleSetVersionId,
        ruleSetDigest: catalog.body.data.ruleSetDigest,
        repositorySnapshotId: catalog.body.data.repositorySnapshotId,
        repositoryCommit: catalog.body.data.repositoryCommit,
        scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
        rules: [
          {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
          },
        ],
      },
    );
  };
  const firstSelected = await submitSelected(selectedCatalog, "ER-RET");
  eq(firstSelected.status, 201, JSON.stringify(firstSelected.body));
  eq(firstSelected.body.data.requested, 1);
  const ruleThreeRun = await runPython(
    script,
    [base, workerKey, selectedAssessment.id, repoDir, "selected"],
    {
      env: {
        LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl,
        ASSESSMENT_SELECTED_RULE_ID: "ER-RET",
      },
    },
  );
  eq(ruleThreeRun.result.state, AGENT_EXECUTION_STATES.SUCCEEDED, JSON.stringify(ruleThreeRun));
  eq(ruleThreeRun.captured.graphConfig, {
    threadId: firstSelected.body.data.requestId,
    checkpointNamespace: "",
  });
  eq(ruleThreeRun.captured.selected_decision.ok, true);
  eq(ruleThreeRun.captured.rule_set.assessmentRules.map((rule) => rule.assessmentRuleId), ["ER-RET"],
    "bounded catalog reads preserve the first request's exact selection");
  const afterRuleThree = await customerHttp(
    "GET",
    `/assessments/${selectedAssessment.id}/rules?offset=0&limit=100`,
    owner.token,
  );
  eq(
    [
      afterRuleThree.body.data.rules.find((rule) => rule.assessmentRuleId === "ER-RET")?.progress,
      afterRuleThree.body.data.rules.find((rule) => rule.assessmentRuleId === "ER-XREF")?.progress,
      afterRuleThree.body.data.rules.filter((rule) => rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY).length,
      afterRuleThree.body.data.rules.filter((rule) => rule.progress === RULE_AUDIT_PROGRESS_STATES.NOT_SELECTED).length,
    ],
    [
      RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
      RULE_AUDIT_PROGRESS_STATES.NOT_SELECTED,
      1,
      19,
    ],
    "ER-RET's result is visible while ER-XREF and the other eighteen rules wait",
  );
  const secondSelected = await submitSelected(afterRuleThree, "ER-XREF");
  eq(secondSelected.status, 201, JSON.stringify(secondSelected.body));
  eq(secondSelected.body.data.requested, 1);
  const ruleNineRun = await runPython(
    script,
    [base, workerKey, selectedAssessment.id, repoDir, "selected"],
    {
      env: {
        LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl,
        ASSESSMENT_SELECTED_RULE_ID: "ER-XREF",
      },
    },
  );
  eq(ruleNineRun.result.state, AGENT_EXECUTION_STATES.SUCCEEDED, JSON.stringify(ruleNineRun));
  eq(ruleNineRun.captured.graphConfig, {
    threadId: secondSelected.body.data.requestId,
    checkpointNamespace: "",
  });
  eq(ruleNineRun.captured.rule_set.assessmentRules.map((rule) => rule.assessmentRuleId), ["ER-XREF"],
    "bounded catalog reads preserve the second request's exact selection");
  ok(
    ruleNineRun.captured.graphConfig.threadId !== ruleThreeRun.captured.graphConfig.threadId,
    "a second batch starts with an isolated native Root checkpoint thread",
  );
  const afterRuleNine = await customerHttp(
    "GET",
    `/assessments/${selectedAssessment.id}/rules?offset=0&limit=100`,
    owner.token,
  );
  eq(
    [
      afterRuleNine.body.data.rules.find((rule) => rule.assessmentRuleId === "ER-RET")?.progress,
      afterRuleNine.body.data.rules.find((rule) => rule.assessmentRuleId === "ER-XREF")?.progress,
      afterRuleNine.body.data.rules.filter((rule) => rule.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY).length,
      afterRuleNine.body.data.rules.filter((rule) => rule.progress === RULE_AUDIT_PROGRESS_STATES.NOT_SELECTED).length,
    ],
    [
      RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
      RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
      2,
      18,
    ],
    "the second request preserves ER-RET while adding ER-XREF among twenty pinned rules",
  );
  const selectedHistory = (
    await q(
      `SELECT "assessmentRuleId" AS rule, "auditRequestId" AS request, state FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"`,
      [selectedAssessment.id],
    )
  ).rows;
  eq(selectedHistory, [
    { rule: "ER-RET", request: firstSelected.body.data.requestId, state: "ACCEPTED" },
    { rule: "ER-XREF", request: secondSelected.body.data.requestId, state: "ACCEPTED" },
  ]);

  for (const run of [first, second, ruleThreeRun, ruleNineRun]) {
    const boundedLegalReads = run.captured.boundedReads.filter((read) =>
      ["get_pinned_rule_set", "get_assessment_rule", "get_assessment_rule_detail"].includes(read.tool));
    ok(boundedLegalReads.every((read) => read.replyBytes <= 4096),
      "every observed catalog/rule/detail reply retains its complete serialized byte bound");
  }

  // ---- isolation: B has its own thread, namespace and lease; A's data is invisible to it ---------
  logPhase("ASSESSMENT_ISOLATION", "START");
  const B = await newAssessment("ASSESSMENT vertical B");
  await q(
    `UPDATE "AssessmentCase" SET "auditMode"='LEGACY_FULL' WHERE "assessmentId"=$1`,
    [B.id],
  );
  eq(
    (
      await customerHttp(
        "POST",
        `/assessments/${B.id}/repository-setup/complete`,
        owner.token,
      )
    ).status,
    201,
  );
  const threadB = (
    await q(
      `SELECT "threadId" AS t FROM "AssessmentRuntime" WHERE "assessmentId"=$1`,
      [B.id],
    )
  ).rows[0].t;
  ok(threadB !== threadA, "disjoint threads");
  // concurrent claims: exactly one wins the lease
  const claims = await Promise.all([
    runtime(B.id, "claim"),
    runtime(B.id, "claim"),
  ]);
  eq(claims.map((c) => c.status).sort(), [200, 409], JSON.stringify(claims));
  const winner = claims.find((c) => c.status === 200).body.data;
  eq(winner.threadId, threadB);
  eq(
    claims.find((c) => c.status === 409).body.problem.code,
    "ASSESSMENT_EXECUTION_LEASE_HELD",
  );
  const ctxB = await runtime(B.id, "context", {
    method: "GET",
    lease: winner.leaseToken,
  });
  eq(ctxB.status, 200);
  eq([ctxB.body.data.facts.length, ctxB.body.data.evidence.length], [0, 0]);
  eq(
    ctxB.body.data.coverage.every((c) => c.resolutionState === "PENDING"),
    true,
  );
  const blockedFinalization = await runtime(B.id, "finalization", {
    lease: winner.leaseToken,
    body: {},
  });
  eq(blockedFinalization.status, 200);
  eq(
    blockedFinalization.body.data.lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
  );
  ok(
    blockedFinalization.body.data.blockers.some(
      (blocker) =>
        blocker.code ===
        ASSESSMENT_COMPLETION_BLOCKER_CODES.DECISION_UNRESOLVED,
    ),
    "pending required rules block finalization",
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
        [B.id, AssessmentArtifactKind.FINAL_REPORT],
      )
    ).rows[0].n,
    0,
    "blocked finalization does not publish a final artifact",
  );
  // B's lease cannot be used on A and vice versa
  eq(
    (
      await runtime(A.id, "context", {
        method: "GET",
        lease: winner.leaseToken,
      })
    ).body.problem.code,
    "ASSESSMENT_EXECUTION_LEASE_INVALID",
  );
  const evidenceOfA = (
    await q(
      `SELECT "evidenceId" AS id FROM "AssessmentEvidence" WHERE "assessmentId"=$1 LIMIT 1`,
      [A.id],
    )
  ).rows[0].id;
  const crossFact = await runtime(B.id, "facts", {
    lease: winner.leaseToken,
    body: {
      expectedCaseRevision: 0,
      kind: "FACT",
      statement: "borrowed",
      evidenceIds: [evidenceOfA],
    },
  });
  eq(crossFact.body.problem.code, "ASSESSMENT_EVIDENCE_REFERENCE_INVALID");

  // a researcher (task descendant) has no lease and cannot spoof lineage or mutate domain state
  eq(
    (await runtime(B.id, "decisions", { body: {} })).body.problem.code,
    "ASSESSMENT_EXECUTION_LEASE_INVALID",
  );
  const spoof = (extra) =>
    runtime(B.id, "activity", {
      lease: winner.leaseToken,
      body: {
        actorType: "SUBAGENT",
        kind: "TASK",
        labelKey: "assessment.activity.taskStarted",
        executionId: randomUUID(),
        ...extra,
      },
    });
  eq(
    (await spoof({ parentExecutionId: randomUUID(), taskId: "t" })).body.problem
      .code,
    "ASSESSMENT_EXECUTION_LEASE_INVALID",
  );
  eq(
    (await spoof({ parentExecutionId: winner.executionId })).body.problem.code,
    "ASSESSMENT_EXECUTION_LEASE_INVALID",
  ); // no taskId
  eq(
    (await spoof({ parentExecutionId: winner.executionId, taskId: "t" }))
      .status,
    200,
  );
  // an agent can never mint an evidence ID or choose a pin: forged fields are rejected by the strict schema
  const forged = await runtime(B.id, "evidence", {
    lease: winner.leaseToken,
    body: {
      type: "REPOSITORY_SOURCE",
      evidenceId: randomUUID(),
      repositoryCommit: COMMIT,
      path: "src/x.py",
      startLine: 1,
      endLine: 1,
      excerptSha256: contentHash("x"),
    },
  });
  eq(forged.body.problem.code, "ASSESSMENT_DOMAIN_REQUEST_INVALID");
  const wrongCommit = await runtime(B.id, "evidence", {
    lease: winner.leaseToken,
    body: {
      type: "REPOSITORY_SOURCE",
      repositoryCommit: "d".repeat(40),
      path: "src/x.py",
      startLine: 1,
      endLine: 1,
      excerptSha256: contentHash("x"),
    },
  });
  eq(wrongCommit.body.problem.code, "ASSESSMENT_EVIDENCE_PIN_MISMATCH");
  const staleCoverage = await runtime(B.id, "evidence", {
    lease: winner.leaseToken,
    body: {
      type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
      repositoryCommit: "d".repeat(40),
      scopes: [
        { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: "src" },
      ],
      queries: [],
      inspectedEntryPoints: [],
      knownGaps: [],
      directSourceFallbacks: [],
    },
  });
  eq(
    staleCoverage.body.problem.code,
    ASSESSMENT_DOMAIN_ERROR_CODES.EVIDENCE_PIN_MISMATCH,
    "stale SEARCH_COVERAGE is rejected before evidence persistence",
  );
  eq(
    (
      await runtime(B.id, "finish", {
        lease: winner.leaseToken,
        body: { state: "CANCELLED" },
      })
    ).status,
    200,
  );

  // ---- legal basis supersession: A keeps its pin, a NEW assessment pins the new ACTIVE rule set -
  logPhase("LEGAL_SOURCE_SUPERSESSION", "START");
  const ruleSet2 = await prepareRuleSet(legalSourceB);
  ok(ruleSet2 !== ruleSet1, "new ruleSet");
  const C = await newAssessment("ASSESSMENT vertical C");
  eq(
    (
      await q(
        `SELECT "ruleSetVersionId" AS p FROM "AssessmentCase" WHERE "assessmentId"=$1`,
        [C.id],
      )
    ).rows[0].p,
    ruleSet2,
  );
  eq(
    (
      await q(
        `SELECT "ruleSetVersionId" AS p FROM "AssessmentCase" WHERE "assessmentId"=$1`,
        [A.id],
      )
    ).rows[0].p,
    ruleSet1,
  );
  eq(
    (
      await q(
        `SELECT "lifecycleState" AS s FROM "ComplianceRuleSetVersion" WHERE id=$1`,
        [ruleSet1],
      )
    ).rows[0].s,
    "SUPERSEDED",
  );
  // The case remains pinned to the superseded version after its completed request;
  // a completed selected request cannot issue another worker lease for readback.

  // ---- database guarantees on the real migrated schema ------------------------------------------
  logPhase("DATABASE_INTEGRITY_CHECKS", "START");
  const rejects = async (label, text, values, pattern) => {
    await assert.rejects(
      () => q(text, values),
      (error) => {
        assert.match(`${error.code ?? ""} ${error.message}`, pattern, label);
        return true;
      },
    );
    checks += 1;
  };
  await rejects(
    "pin immutable",
    `UPDATE "AssessmentCase" SET "ruleSetVersionId"=$2 WHERE "assessmentId"=$1`,
    [A.id, ruleSet2],
    /immutable/,
  );
  await rejects(
    "repository pin immutable",
    `UPDATE "AssessmentCase" SET "repositoryCommit"=$2 WHERE "assessmentId"=$1`,
    [A.id, "e".repeat(40)],
    /immutable|pin must match/,
  );
  await rejects(
    "decision history immutable",
    `UPDATE "AssessmentRuleDecision" SET "applicability"='NOT_APPLICABLE', "compliance"=NULL WHERE "assessmentId"=$1`,
    [A.id],
    /immutable/,
  );
  await rejects(
    "evidence immutable",
    `UPDATE "AssessmentEvidence" SET "contentSha256"=$2 WHERE "assessmentId"=$1`,
    [A.id, contentHash("tamper")],
    /immutable/,
  );
  await rejects(
    "DRS RESOLVED needs decision",
    `UPDATE "AssessmentDecisionCoverage" SET "currentDecisionId"=NULL WHERE "assessmentId"=$1 AND "assessmentRuleId"='ER-RET'`,
    [A.id],
    /resolved_has_decision|RESOLVED/,
  );
  await rejects(
    "DRS illegal transition",
    `UPDATE "AssessmentDecisionCoverage" SET "resolutionState"='PENDING' WHERE "assessmentId"=$1 AND "assessmentRuleId"='ER-RET'`,
    [A.id],
    /illegal decision-resolution/,
  );
  await rejects(
    "one thread per assessment",
    `INSERT INTO "AssessmentRuntime"("assessmentId","threadId","rootAgentVersion","checkpointNamespace","updatedAt") VALUES ($1,$2,'x','x',now())`,
    [A.id, randomUUID()],
    /duplicate|unique/,
  );
  await rejects(
    "ACTIVE requires pins",
    `UPDATE "Assessment" SET "lifecycleState"='ACTIVE' WHERE id=$1 AND "lifecycleState" <> 'ACTIVE'`,
    [C.id],
    /cannot be ACTIVE|decision coverage/,
  );

  // Normal text is not terminal: the real graph continues to finalization/report on this fixture.
  const completedByRoot = await newAssessment(
    "Root authoritative terminal contract",
  );
  eq(
    (
      await customerHttp(
        "POST",
        `/assessments/${completedByRoot.id}/repository-setup/complete`,
        owner.token,
      )
    ).status,
    201,
  );
  const terminalCatalog = await customerHttp(
    "GET",
    `/assessments/${completedByRoot.id}/rules?offset=0&limit=100`,
    owner.token,
  );
  eq(terminalCatalog.status, 200, JSON.stringify(terminalCatalog.body));
  const terminalAudit = await customerHttp(
    "POST",
    `/assessments/${completedByRoot.id}/rule-audits`,
    owner.token,
    {
      idempotencyKey: randomUUID(),
      expectedAuditRevision: terminalCatalog.body.data.auditRevision,
      ruleSetVersionId: terminalCatalog.body.data.ruleSetVersionId,
      ruleSetDigest: terminalCatalog.body.data.ruleSetDigest,
      repositorySnapshotId: terminalCatalog.body.data.repositorySnapshotId,
      repositoryCommit: terminalCatalog.body.data.repositoryCommit,
      scopeMode: RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET,
      rules: [],
    },
  );
  eq(terminalAudit.status, 201, JSON.stringify(terminalAudit.body));
  const completed = await runPython(script, [
    base,
    workerKey,
    completedByRoot.id,
    repoDir,
    "complete",
  ], rootOptions);
  eq(
    completed.result.state,
    AGENT_EXECUTION_STATES.SUCCEEDED,
    JSON.stringify(completed),
  );
  eq(completed.remainingSteps, 0);
  eq(
    (await lifecycle(completedByRoot.id)).lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  );

  // ---- ASSESSMENT Completion Gate and immutable Root-authored report ------------------------------------
  logPhase("FINAL_REPORT_AND_COMPLETION", "START");
  const finalizer = (await runtime(A.id, "claim")).body.data;
  ok(finalizer.leaseToken, "Root lease is required for finalization");
  const finalization = await runtime(A.id, "finalization", {
    lease: finalizer.leaseToken,
    body: {},
  });
  eq(finalization.status, 200, JSON.stringify(finalization.body));
  eq(finalization.body.data, {
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
    blockers: [],
  });
  const reportRequest = {
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    summary: "The assessment findings are complete.",
    findings: ["ER-DEF", "ER-RET", "ER-XREF"].map((assessmentRuleId) => ({
      assessmentRuleId,
      summary: "The finding follows the accepted rule decision.",
      recommendations: [],
    })),
  };
  for (const summary of [
    "The outcome remains UNKNOWN.",
    "There is an unresolved question.",
  ]) {
    const invalidReport = await runtime(A.id, "final-report", {
      lease: finalizer.leaseToken,
      body: { ...reportRequest, summary },
    });
    eq(invalidReport.status, 422);
    eq(
      invalidReport.body.problem.code,
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
    );
  }
  eq(
    (await lifecycle(A.id)).lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
        [A.id, AssessmentArtifactKind.FINAL_REPORT],
      )
    ).rows[0].n,
    0,
  );
  const finalReport = await runtime(A.id, "final-report", {
    lease: finalizer.leaseToken,
    body: reportRequest,
  });
  eq(finalReport.status, 200, JSON.stringify(finalReport.body));
  eq(
    [finalReport.body.data.lifecycleState, finalReport.body.data.replayed],
    [ASSESSMENT_LIFECYCLE_STATES.COMPLETE, false],
  );
  const artifact = (
    await q(
      `SELECT "artifactId" AS id, "lifecycleState" AS state, "contentSha256" AS hash, "sizeBytes" AS size, "storageRef" AS ref, "schemaVersion" AS schema, "ruleSetVersionId" AS "ruleSet", "repositorySnapshotId" AS snapshot, "repositoryCommit" AS commit, "caseRevision" AS "caseRevision", "reportRequestDigest" AS "requestDigest" FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
      [A.id, AssessmentArtifactKind.FINAL_REPORT],
    )
  ).rows[0];
  eq(
    [artifact.id, artifact.state],
    [finalReport.body.data.artifactId, ArtifactLifecycleState.ACTIVE],
  );
  ok(
    artifact.hash && artifact.size > 0 && artifact.ref,
    "artifact metadata persisted",
  );
  const manifest = JSON.parse(artifact.ref);
  const storageRoot =
    process.env.LCSP_ARTIFACT_STORAGE_PATH ??
    path.join(root, "tmp", "lcsp-storage");
  const content = readFileSync(
    path.join(storageRoot, "chunks", manifest.chunks[0]),
    "utf8",
  );
  eq(
    createHash("sha256").update(content).digest("hex"),
    artifact.hash.replace(/^sha256:/u, ""),
  );
  // BROWSER customer consumer: exact immutable bytes and canonical read state, with no report generation.
  logPhase("ARTIFACT_DOWNLOAD_AND_PDF_RENDER", "START");
  const download = await fetchWithDeadline(
    "ARTIFACT_DOWNLOAD",
    `${base}/assessments/${A.id}/artifacts/${artifact.id}/download`,
    { headers: { authorization: `Bearer ${owner.token}` } },
  );
  eq(download.status, 200);
  eq(await download.text(), content);
  eq(download.headers.get("etag"), `"${artifact.hash.replace(/^sha256:/u, "")}"`);
  ok(download.headers.get("content-disposition").includes(artifact.id));
  const detailRead = await customerHttp("GET", `/assessments/${A.id}`, owner.token);
  eq(detailRead.status, 200);
  eq(detailRead.body.data.lifecycle.state, ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
  eq(detailRead.body.data.case.artifacts[0].artifactId, artifact.id);
  ok(!Object.hasOwn(detailRead.body.data, "readiness_state") && !Object.hasOwn(detailRead.body.data, "status"));
  eq(
    (
      await fetchWithDeadline(
        "FOREIGN_OWNER_ARTIFACT_DOWNLOAD",
        `${base}/assessments/${B.id}/artifacts/${artifact.id}/download`,
        { headers: { authorization: `Bearer ${owner.token}` } },
      )
    ).status,
    404,
  );
  eq(
    (
      await fetchWithDeadline(
        "UNAUTHENTICATED_ARTIFACT_DOWNLOAD",
        `${base}/assessments/${A.id}/artifacts/${artifact.id}/download`,
      )
    ).status,
    401,
  );
  const reportArtifact = assessmentFinalReportArtifactVersionedSchema.parse(JSON.parse(content));
  eq(
    [
      reportArtifact.artifactId,
      reportArtifact.assessmentId,
      reportArtifact.kind,
      reportArtifact.schemaVersion,
    ],
    [
      artifact.id,
      A.id,
      ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      artifact.schema,
    ],
  );
  eq(reportArtifact.pins.ruleSetVersionId, artifact.ruleSet);
  eq(reportArtifact.pins.repositorySnapshotId, artifact.snapshot);
  eq(reportArtifact.pins.repositoryScanJobId, pinned.job);
  eq(reportArtifact.pins.repositoryCommit, COMMIT);
  ok(reportArtifact.pins.legalSourceVersionId && reportArtifact.pins.legalSourceVersion && reportArtifact.pins.ruleSetVersion && reportArtifact.pins.ruleSetDigest, "V2 preserves source/rule-set pins");
  eq(
    [
      reportArtifact.kind,
      reportArtifact.assessmentId,
      reportArtifact.caseRevision,
      reportArtifact.ruleDetails.length,
      reportArtifact.pins.repositoryCommit,
      reportArtifact.schemaVersion,
    ],
    [ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT, A.id, 1, 3, COMMIT, "ASSESSMENT_FINAL_REPORT_V2"],
  );
  const fingerprintInput = reportArtifact.ruleDetails.map(
    ({ decisionId, decisionRevision, decision }) => ({
      decisionId,
      decisionRevision,
      decision,
    }),
  );
  eq(
    reportArtifact.decisionFingerprint,
    `sha256:${createHash("sha256").update(canonicalJson(fingerprintInput)).digest("hex")}`,
  );
  const referencedEvidence = new Set();
  const referencedFacts = new Set();
  for (const { decision } of reportArtifact.ruleDetails) {
    for (const reference of [
      ...decision.references,
      ...decision.criteria.flatMap((criterion) => criterion.references),
    ]) {
      if (
        reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
      ) {
        referencedEvidence.add(reference.evidenceId);
      } else {
        referencedFacts.add(reference.factId);
      }
    }
  }
  eq(reportArtifact.evidenceIndex.map(({ evidenceId }) => evidenceId).sort(), [...referencedEvidence].sort());
  eq(reportArtifact.factIndex.map(({ factId }) => factId).sort(), [...referencedFacts].sort());
  eq(reportArtifact.outcomeSummary, { totalRules: 3, applicableCompliant: 1, applicableNonCompliant: 1, notApplicable: 1 });
  eq(reportArtifact.ruleDetails.map(({ assessmentRuleId }) => assessmentRuleId).sort(), ["ER-DEF", "ER-RET", "ER-XREF"]);
  const notApplicable = reportArtifact.ruleDetails.find(({ assessmentRuleId }) => assessmentRuleId === "ER-DEF");
  eq([notApplicable.decision.applicability, notApplicable.decision.compliance, notApplicable.decision.criteria], ["NOT_APPLICABLE", null, []]);
  ok(notApplicable.decisionReferences.every(({ origin }) => origin === "DECISION"), "N/A references remain decision-level");
  ok(reportArtifact.ruleDetails.filter(({ assessmentRuleId }) => assessmentRuleId !== "ER-DEF").every(({ criteriaDecisions }) => criteriaDecisions.every(({ references }) => references.every(({ origin }) => origin === "CRITERION"))), "criterion references remain criterion-level");
  ok(reportArtifact.legalRequirements.length >= 3, "V2 preserves normalized LegalRequirements");
  ok(reportArtifact.ruleDetails.every(({ sourceRefs }) => sourceRefs.every(({ legalSourceVersionId, documentId, locator, contentSha256 }) => legalSourceVersionId && documentId === DOC && locator && /^sha256:[a-f0-9]{64}$/u.test(contentSha256))), "V2 preserves exact legal provenance");
  ok(reportArtifact.factIndex.every(({ evidenceIds }) => evidenceIds.every((id) => reportArtifact.evidenceIndex.some((evidence) => evidence.evidenceId === id))), "V2 fact/evidence indexes resolve");
  const pdfResponse = await fetchWithDeadline(
    "PDF_REPORT_DOWNLOAD",
    `${base}/assessments/${A.id}/artifacts/${artifact.id}/report.pdf`,
    { headers: { authorization: `Bearer ${owner.token}` } },
    PDF_PHASE_DEADLINE_MS,
  );
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  eq(pdfResponse.status, 200);
  eq(pdfResponse.headers.get("content-type"), "application/pdf");
  eq(pdfResponse.headers.get("cache-control"), "private, no-store");
  ok(pdfResponse.headers.get("content-disposition")?.includes(`${artifact.id}.pdf`), "PDF filename is bound to artifact identity");
  eq(pdfResponse.headers.get("x-lcsp-source-artifact-sha256"), artifact.hash.replace(/^sha256:/u, ""));
  eq(pdfResponse.headers.get("etag"), null);
  ok(pdfBytes.subarray(0, 5).toString("ascii") === "%PDF-" && pdfBytes.length > 1000, "authorized PDF is non-empty and structurally valid");
  const pdfParser = new PDFParse({ data: pdfBytes });
  const pdfText = await pdfParser.getText();
  await pdfParser.destroy();
  for (const heading of ["KẾT QUẢ ĐÁNH GIÁ", "DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG", "DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ", "CHI TIẾT TỪNG NGHĨA VỤ", "KẾ HOẠCH HÀNH ĐỘNG", "PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT"]) {
    ok(pdfText.text.includes(heading) || pdfText.text.includes(heading.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")), `PDF contains section ${heading}`);
  }
  for (const id of [A.id, artifact.id, "ER-RET", "LR-RET", "art-1", DOC])
    ok(pdfText.text.includes(id), `PDF contains canonical identifier ${id}`);
  eq(
    (
      await fetchWithDeadline(
        "UNAUTHENTICATED_PDF_DOWNLOAD",
        `${base}/assessments/${A.id}/artifacts/${artifact.id}/report.pdf`,
        {},
        PDF_PHASE_DEADLINE_MS,
      )
    ).status,
    401,
  );
  eq(
    (
      await fetchWithDeadline(
        "FOREIGN_OWNER_PDF_DOWNLOAD",
        `${base}/assessments/${B.id}/artifacts/${artifact.id}/report.pdf`,
        { headers: { authorization: `Bearer ${owner.token}` } },
        PDF_PHASE_DEADLINE_MS,
      )
    ).status,
    404,
  );
  eq(Boolean(artifact.requestDigest), true);
  await rejects(
    "published final artifact is immutable",
    `UPDATE "AssessmentArtifact" SET "contentSha256"=$2 WHERE "artifactId"=$1`,
    [artifact.id, contentHash("tampered final report")],
    /published artifact is immutable/,
  );
  await rejects(
    "published final artifact request identity is immutable",
    `UPDATE "AssessmentArtifact" SET "reportRequestDigest"=$2 WHERE "artifactId"=$1`,
    [artifact.id, `${artifact.requestDigest}-tampered`],
    /published artifact is immutable/,
  );
  ok(
    !/\b(?:UNKNOWN|PARTIAL|NEEDS_CONTEXT|TBD)\b|open questions?|unresolved decision/i.test(
      content,
    ),
    "final artifact contains no unresolved outcome language",
  );

  // Browser acceptance runs the real Web against this still-live assessment.
  // The metadata is written outside the repository and contains only a short-lived
  // synthetic owner token; the harness removes it after the browser exits.
  const browserFixturePath = process.env.LCSP_BROWSER_FIXTURE_FILE;
  const browserReleasePath = process.env.LCSP_BROWSER_RELEASE_FILE;
  if (browserFixturePath && browserReleasePath) {
    const browserForeign = await customer("assessment-browser-foreign@acme.test");
    writeFileSync(browserFixturePath, JSON.stringify({
      apiBase: base,
      assessmentId: A.id,
      artifactId: artifact.id,
      ownerToken: owner.token,
      foreignToken: browserForeign.token,
      artifactHash: artifact.hash,
      ruleIds: reportArtifact.ruleDetails.map((detail) => detail.assessmentRuleId),
      schemaVersion: reportArtifact.schemaVersion,
    }), { mode: 0o600 });
    for (;;) {
      if (existsSync(browserReleasePath)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const replayedReport = await runtime(A.id, "final-report", {
    lease: finalizer.leaseToken,
    body: reportRequest,
  });
  eq(replayedReport.status, 200);
  eq(replayedReport.body.data.replayed, true);
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
        [A.id, AssessmentArtifactKind.FINAL_REPORT],
      )
    ).rows[0].n,
    1,
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "AssessmentEvent" WHERE "assessmentId"=$1 AND "eventType"=$2`,
        [A.id, AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED],
      )
    ).rows[0].n,
    2,
  );
  eq(
    (await lifecycle(A.id)).lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  );
  const legacyRequestId = randomUUID();
  const legacyContext = await http(
    "GET",
    `/internal/document-requests/${legacyRequestId}/generation-context`,
  );
  eq(legacyContext.status, 404);
  const legacyCallback = await http(
    "POST",
    `/internal/document-requests/${legacyRequestId}/callback`,
    {
      status: "READY",
      document_url: "https://example.invalid/legacy-final-report.pdf",
    },
  );
  eq(legacyCallback.status, 404);

  // RELEASE zero-retention DELETE uses the canonical domain records produced above.
  logPhase("ASSESSMENT_DELETION", "START");
  const otherOwner = await customer("release-deletion-other@acme.test");
  const survivorCreated = await customerHttp("POST", "/assessments", otherOwner.token, {
    name: "Synthetic protected assessment",
  });
  eq(survivorCreated.status, 201);
  const survivorId = survivorCreated.body.data.assessment_id ?? survivorCreated.body.data.id;
  const survivorThread = (await q(
    `SELECT "threadId"::text AS thread FROM "AssessmentRuntime" WHERE "assessmentId"=$1`,
    [survivorId],
  )).rows[0].thread;
  const humanScript = path.join(root, "deepagents/tests/vertical/hitl_root.py");
  const humanRun = (mode) => runPython(humanScript, [base, workerKey, B.id, repoDir, mode], {
    env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl },
  });
  const interruptedForDelete = await humanRun("ask");
  eq(interruptedForDelete.result.state, AGENT_EXECUTION_STATES.INTERRUPTED);
  const requestsForDelete = await customerHttp("GET", `/assessments/${B.id}/human-requests`, owner.token);
  eq(requestsForDelete.status, 200);
  const humanRequestsForDelete = assessmentHumanRequestsResultSchema.parse(requestsForDelete.body.data);
  const answeredRequest = humanRequestsForDelete.requests[0];
  const answeredForDelete = await customerHttp(
    "POST", `/assessments/${B.id}/human-requests/${answeredRequest.requestId}/answers`, owner.token,
    answerAssessmentHumanRequestSchema.parse({
      expectedCaseRevision: humanRequestsForDelete.caseRevision,
      expectedRequestRevision: answeredRequest.requestRevision,
      idempotencyKey: "release-deletion-answer",
      doesNotKnow: false,
      answer: "The operations team owns the external notification and retention process.",
    }),
  );
  eq(answeredForDelete.status, 200, JSON.stringify(answeredForDelete.body));
  const resumedForDelete = await humanRun("resume");
  eq(resumedForDelete.result.state, AGENT_EXECUTION_STATES.FAILED);
  eq(resumedForDelete.result.threadId, threadB);
  const deletionCaseRevision = (await q(
    `SELECT "caseRevision" AS revision FROM "AssessmentCase" WHERE "assessmentId"=$1`, [B.id],
  )).rows[0].revision;
  const deletionClaim = await runtime(B.id, "claim");
  eq(deletionClaim.status, 200, JSON.stringify(deletionClaim.body));
  const openRequest = await runtime(B.id, "human-requests", {
    lease: deletionClaim.body.data.leaseToken,
    body: {
      expectedCaseRevision: deletionCaseRevision,
      idempotencyKey: "release-deletion-open-request",
      assessmentRuleId: "ER-RET",
      criterionIds: first.captured.rule_set.assessmentRules.find((r) => r.assessmentRuleId === "ER-RET").criterionIds,
      question: "Who owns the external operational retention process?",
      unresolvedFact: "External organizational ownership",
      decisionImpact: ["Ownership determines the operational duty."],
      resolutionAttempts: ["Inspected available repository inputs; organizational ownership is not present."],
      controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
      choices: [],
    },
  });
  eq(openRequest.status, 200, JSON.stringify(openRequest.body));
  const usageId = randomUUID();
  await q(
    `INSERT INTO "LlmUsageEvent"(id,"userId","assessmentId",provider,model,"invocationId","totalTokens","chargedCredits")
     VALUES ($1,$2,$3,'synthetic','synthetic',$1,12,3)`,
    [usageId, owner.id, A.id],
  );
  const deletionInput = path.join(seedDir, "deletion.json");
  writeFileSync(deletionInput, JSON.stringify({
    apiBase: base,
    targets: [
      { assessmentId: A.id, ownerId: owner.id, threadId: threadA },
      { assessmentId: B.id, ownerId: owner.id, threadId: threadB },
    ],
    survivor: { assessmentId: survivorId, ownerId: otherOwner.id, threadId: survivorThread },
    artifact: { id: artifact.id, chunks: manifest.chunks },
    storageRoot,
    usageId,
  }), { mode: 0o600 });
  const deletion = await runPython(
    path.join(root, "deepagents/tests/vertical/assessment_deletion.py"),
    [deletionInput],
    { env: {
      LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl,
      ASSESSMENT_DELETE_DATABASE_URL: databaseUrl.split("?")[0],
      ASSESSMENT_DELETE_OWNER_TOKEN: owner.token,
      ASSESSMENT_DELETE_OTHER_TOKEN: otherOwner.token,
      WORKER_API_KEY: workerKey,
    } },
  );
  eq(deletion.status, "PASS", JSON.stringify(deletion));
  console.log(`RELEASE deletion evidence: ${deletion.evidenceDirectory}`);

  if (process.env.LCSP_TEST_CHECKPOINT_DATABASE) {
    eq((await q(`SELECT to_regclass('public.checkpoints')::text AS name`)).rows[0].name, null,
      "Root retry, HITL and erasure completed without a checkpoint table in the API database");
  }
  console.log(
    `LCSP-56 V2 acceptance: assessment=${A.id} artifact=${artifact.id} schema=${reportArtifact.schemaVersion} rules=${reportArtifact.ruleDetails.length} decisions=${reportArtifact.ruleDetails.length} jsonSha256=${artifact.hash} jsonBytes=${artifact.size} pdfStatus=${pdfResponse.status} pdfBytes=${pdfBytes.length}`,
  );
  console.log(
    `PASS: ${checks} ASSESSMENT/ASSESSMENT vertical checks (real API + PostgreSQL + Python Assessment Root; model scripted) on ${database}`,
  );
  }
} catch (error) {
  logPhase(activePhase || "UNKNOWN", "FAILED", `error=${error.name}`);
  throw error;
} finally {
  await stop();
  rmSync(artifactStoragePath, { recursive: true, force: true });
  if (previousArtifactStoragePath === undefined) {
    delete process.env.LCSP_ARTIFACT_STORAGE_PATH;
  } else {
    process.env.LCSP_ARTIFACT_STORAGE_PATH = previousArtifactStoragePath;
  }
  if (previousAgentServerUrl === undefined) {
    delete process.env.LCSP_AGENT_SERVER_URL;
  } else {
    process.env.LCSP_AGENT_SERVER_URL = previousAgentServerUrl;
  }
}
