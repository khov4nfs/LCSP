// Real Root/provider/API/PostgreSQL/PostgresSaver. Writes outputs for semantic review, not auto approval.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import {
  root,
  runPython,
  startStack,
  workerKey,
} from "./support/legal-portfolio-stack.mjs";

const mode = process.argv[2] ?? "decisions";
const outputLabel = process.env.LCSP_W4_EVAL_LABEL ?? mode;
const resumeReceiptPath = process.env.LCSP_W4_EVAL_RESUME_RECEIPT;
const previousEval = resumeReceiptPath
  ? JSON.parse(readFileSync(path.resolve(root, resumeReceiptPath), "utf8"))
  : null;
if (previousEval) {
  assert.equal(mode, "bounded-absence");
  assert.equal(previousEval.fixture.fixture, mode);
  assert.equal(previousEval.result.result.state, AGENT_EXECUTION_STATES.FAILED);
  assert.equal(
    previousEval.finalization.assessment.lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
  );
  assert.equal(previousEval.finalization.artifact, null);
}
assert.match(outputLabel, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
assert.ok(
  [
    "decisions",
    "single",
    "source-answerable",
    "human",
    "not-applicable",
    "bounded-absence",
    "bounded-absence-gapped",
    "fallback-found",
  ].includes(mode),
);
const artifactStoragePath = mkdtempSync(
  path.join(tmpdir(), "lcsp-w4-live-artifacts-"),
);
const previousArtifactStoragePath = process.env.LCSP_ARTIFACT_STORAGE_PATH;
process.env.LCSP_ARTIFACT_STORAGE_PATH = artifactStoragePath;
const stack = await startStack({
  database: "lcsp_w4_live",
  apiPort: Number(process.env.LCSP_W4_LIVE_API_PORT ?? 3415),
  resetDatabase: previousEval === null,
});
const { q, base, post, stop, seedCorpus, databaseUrl } = stack;
const requireApi = createRequire(path.join(root, "apps/api/package.json"));
const { ArtifactLifecycleState } = requireApi("@prisma/client");
const http = async (route, body, token) => {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  return data.data;
};
const httpGet = async (route, token) => {
  const res = await fetch(`${base}${route}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  return data.data;
};
const tests = path.join(root, "deepagents/tests/vertical"),
  outputDir = path.join(root, "reports/w4-live-eval");
mkdirSync(outputDir, { recursive: true });
try {
  const fixture =
    previousEval?.fixture ??
    (await runPython(path.join(tests, "root_semantic_fixture.py"), [mode]));
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp-w4-live-")),
    repo = path.join(dir, "repo"),
    seed = path.join(dir, "seed.json");
  mkdirSync(repo);
  writeFileSync(seed, JSON.stringify(fixture));
  for (const [name, content] of Object.entries(fixture.files)) {
    const file = path.join(repo, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  let id;
  let token;
  if (previousEval) {
    const existing = (
      await q(
        `SELECT ar."assessmentId",ar."currentExecutionId",ar."executionState",ar."leaseToken",a."lifecycleState",ac."caseRevision",ac."legalPortfolioVersionId",ac."repositorySnapshotId",ac."repositoryCommit" FROM "AssessmentRuntime" ar JOIN "Assessment" a ON a.id=ar."assessmentId" JOIN "AssessmentCase" ac ON ac."assessmentId"=a.id WHERE ar."threadId"=$1`,
        [previousEval.result.result.threadId],
      )
    ).rows[0];
    assert.ok(
      existing,
      "The saved server thread must still exist; resume never seeds a replacement",
    );
    assert.equal(
      existing.currentExecutionId,
      previousEval.result.result.executionId,
    );
    assert.equal(existing.executionState, AGENT_EXECUTION_STATES.FAILED);
    assert.equal(existing.leaseToken, null);
    const {
      assessmentId,
      currentExecutionId,
      executionState,
      leaseToken,
      ...caseState
    } = existing;
    assert.deepEqual(caseState, previousEval.finalization.assessment);
    id = assessmentId;
  } else {
    const corpus = await seedCorpus({
      name: `w4-eval-${mode}`,
      status: "APPROVED",
      documentId: fixture.documentId,
      chunks: fixture.chunks,
    });
    const prep = await post("preparations", {
      legalCorpusVersionId: corpus,
      idempotencyKey: `w4-eval-${randomUUID()}`,
    });
    assert.equal(prep.status, 202, JSON.stringify(prep.body));
    const prepared = await runPython(
      path.join(tests, "scripted_preparation.py"),
      [base, workerKey, prep.body.data.preparationRunId, seed, "valid"],
    );
    assert.equal(prepared.state, "SUCCEEDED", JSON.stringify(prepared));
    const { hashSecret } = await import(
      path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js")
    );
    const owner = randomUUID(),
      password = "CorrectHorseBatteryStaple!",
      email = "w4-eval@acme.test";
    await q(
      `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
      [owner, email, hashSecret(password)],
    );
    const auth = await http("/auth/sign-in", {
      email,
      password,
      organization_id: "org-1",
    });
    token = auth.session_token;
    const created = await http(
      "/assessments",
      { name: `W4 semantic ${mode}` },
      token,
    );
    id = created.assessment_id ?? created.id;
    const connection = randomUUID(),
      snapshot = randomUUID();
    await q(
      `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,'w4-eval',$4,'repo','acme/repo','main','{}')`,
      [connection, id, owner, `repo-${id}`],
    );
    await q(
      `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}',$6)`,
      [snapshot, id, connection, `repo-${id}`, "c".repeat(40), owner],
    );
    await http(
      `/assessments/${id}/repository-setup/complete`,
      undefined,
      token,
    );
  }
  const traceFile = path.join(outputDir, `${outputLabel}-trace.json`);
  const result = await runPython(
    path.join(tests, "live_root.py"),
    [base, workerKey, id, repo, traceFile],
    { env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: databaseUrl.split("?")[0] } },
  );
  let resumedResult = null;
  let resumedTrace = null;
  if (mode === "human") {
    const humanState = await httpGet(
      `/assessments/${id}/human-requests`,
      token,
    );
    assert.equal(humanState.requests.length, 1, JSON.stringify(humanState));
    const [request] = humanState.requests;
    assert.equal(request.status, "OPEN");
    const answer = await http(
      `/assessments/${id}/human-requests/${request.requestId}/answers`,
      {
        expectedCaseRevision: humanState.caseRevision,
        expectedRequestRevision: request.requestRevision,
        idempotencyKey: `w4-eval-human-${id}`,
        doesNotKnow: false,
        answer:
          "Customer Operations is assigned as the responsible owner for notice notifications.",
      },
      token,
    );
    assert.equal(answer.status, "RESOLVED", JSON.stringify(answer));
    const resumedTraceFile = path.join(outputDir, "human-resume-trace.json");
    resumedResult = await runPython(
      path.join(tests, "live_root.py"),
      [base, workerKey, id, repo, resumedTraceFile],
      { env: { LANGGRAPH_CHECKPOINT_DATABASE_URL: databaseUrl.split("?")[0] } },
    );
    resumedTrace = JSON.parse(readFileSync(resumedTraceFile, "utf8"));
    assert.equal(resumedResult.result.threadId, result.result.threadId);
  }
  const decisions = (
    await q(
      `SELECT "decisionId","decisionRevision","engineeringRuleId",state,decision FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 ORDER BY "engineeringRuleId","decisionRevision"`,
      [id],
    )
  ).rows;
  const requests = (
    await q(
      `SELECT "requestId",status,question,"unresolvedFact","resolutionAttempts","decisionImpact","resolvedFactId",answers FROM "AssessmentHumanRequest" WHERE "assessmentId"=$1`,
      [id],
    )
  ).rows;
  const evidence = (
    await q(
      `SELECT "evidenceId",type,state,"repositoryCommit",payload FROM "AssessmentEvidence" WHERE "assessmentId"=$1`,
      [id],
    )
  ).rows;
  const facts = (
    await q(
      `SELECT kind,authority,state,statement FROM "AssessmentCaseFact" WHERE "assessmentId"=$1`,
      [id],
    )
  ).rows;
  const rootTrace = JSON.parse(readFileSync(traceFile, "utf8"));
  const continuation = previousEval
    ? {
        receipt: resumeReceiptPath,
        previousExecution: previousEval.result,
        combinedCalls: previousEval.result.calls + result.calls,
        combinedInputTokens:
          previousEval.result.inputTokens + result.inputTokens,
        combinedOutputTokens:
          previousEval.result.outputTokens + result.outputTokens,
        combinedSeconds: previousEval.result.seconds + result.seconds,
      }
    : null;
  const evalReport = {
    generatedAt: new Date().toISOString(),
    fixture,
    result,
    trace: rootTrace,
    resumedResult,
    resumedTrace,
    decisions,
    requests,
    evidence,
    facts,
    continuation,
  };
  // Preserve the actual Root/DB state even when acceptance assertions fail.
  writeFileSync(
    path.join(outputDir, `${outputLabel}.json`),
    JSON.stringify(evalReport, null, 2),
  );
  let finalization = null;
  if (mode === "bounded-absence") {
    const assessment = (
      await q(
        `SELECT a."lifecycleState",ac."caseRevision",ac."legalPortfolioVersionId",ac."repositorySnapshotId",ac."repositoryCommit" FROM "Assessment" a JOIN "AssessmentCase" ac ON ac."assessmentId"=a.id WHERE a.id=$1`,
        [id],
      )
    ).rows[0];
    const artifact = (
      await q(
        `SELECT "artifactId",kind,"lifecycleState","legalPortfolioVersionId","repositorySnapshotId","repositoryCommit","caseRevision","schemaVersion","reportRequestDigest","contentSha256","sizeBytes","storageRef" FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
        [id, ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT],
      )
    ).rows[0];
    const artifactEvents = (
      await q(
        `SELECT count(*)::int AS n FROM "AssessmentEvent" WHERE "assessmentId"=$1 AND "eventType"=$2`,
        [id, AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED],
      )
    ).rows[0].n;
    writeFileSync(
      path.join(outputDir, `${outputLabel}.json`),
      JSON.stringify(
        {
          ...evalReport,
          finalization: {
            assessment,
            artifact: artifact ?? null,
            artifactEvents,
          },
        },
        null,
        2,
      ),
    );
    let reportContent = null;
    let report = null;
    if (artifact?.storageRef) {
      const manifest = JSON.parse(artifact.storageRef);
      reportContent = Buffer.concat(
        manifest.chunks.map((chunk) =>
          readFileSync(path.join(artifactStoragePath, "chunks", chunk)),
        ),
      ).toString("utf8");
      // Preserve the stored bytes before any assertion or temporary-storage cleanup.
      writeFileSync(
        path.join(outputDir, `${outputLabel}.json`),
        JSON.stringify(
          {
            ...evalReport,
            finalization: {
              assessment,
              artifact,
              artifactEvents,
              reportContent,
            },
          },
          null,
          2,
        ),
      );
      report = JSON.parse(reportContent);
    }
    assert.equal(
      result.result.state,
      AGENT_EXECUTION_STATES.SUCCEEDED,
      JSON.stringify({
        errorType: result.result.errorType,
        model: result.model,
        calls: result.calls,
        inputTokens: result.inputTokens,
        lifecycleState: assessment.lifecycleState,
        artifactId: artifact?.artifactId ?? null,
        evidence: path.join(outputDir, `${outputLabel}.json`),
      }),
    );
    assert.equal(decisions.length, 1);
    if (previousEval) {
      assert.equal(result.result.threadId, previousEval.result.result.threadId);
      assert.notEqual(
        result.result.executionId,
        previousEval.result.result.executionId,
      );
      assert.deepEqual(
        decisions,
        previousEval.decisions,
        "Native continuation preserves the accepted decision without another write",
      );
      assert.deepEqual(
        evidence,
        previousEval.evidence,
        "Native continuation adds no new evidence",
      );
      assert.deepEqual(
        facts,
        previousEval.facts,
        "Native continuation preserves accepted facts",
      );
    }
    assert.equal(
      decisions[0].decision.applicability,
      RULE_DECISION_APPLICABILITIES.APPLICABLE,
    );
    assert.equal(
      decisions[0].decision.compliance,
      RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    );
    assert.deepEqual(
      decisions[0].decision.criteria.map(({ outcome }) => outcome),
      [RULE_DECISION_CRITERION_OUTCOMES.NOT_MET],
    );
    assert.equal(
      assessment.lifecycleState,
      ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
    );
    assert.equal(artifact.lifecycleState, ArtifactLifecycleState.ACTIVE);
    assert.equal(
      artifact.legalPortfolioVersionId,
      assessment.legalPortfolioVersionId,
    );
    assert.equal(
      artifact.repositorySnapshotId,
      assessment.repositorySnapshotId,
    );
    assert.equal(artifact.caseRevision, assessment.caseRevision);
    const repositoryPin = (
      await q(`SELECT "commitSha" FROM "RepositorySnapshot" WHERE id=$1`, [
        assessment.repositorySnapshotId,
      ])
    ).rows[0];
    assert.equal(artifact.repositoryCommit, repositoryPin.commitSha);
    assert.equal(artifact.repositoryCommit, assessment.repositoryCommit);
    assert.ok(artifact.reportRequestDigest);
    assert.ok(
      artifact.contentSha256 && artifact.sizeBytes > 0 && artifact.storageRef,
    );
    assert.ok(artifactEvents > 0, "final report emits ARTIFACT_CHANGED");
    assert.ok(
      [...(previousEval?.trace.tools ?? []), ...rootTrace.tools].some(
        ({ tool }) => tool === "request_finalization",
      ),
    );
    assert.ok(
      [...(previousEval?.trace.tools ?? []), ...rootTrace.tools].some(
        ({ tool }) => tool === "submit_final_report",
      ),
    );
    assert.equal(
      requests.length,
      0,
      "source-answerable absence required no human question",
    );
    const coverage = evidence.find(
      ({ type }) => type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
    );
    assert.ok(coverage, "Root persisted authenticated search coverage");
    assert.equal(coverage.state, ASSESSMENT_RECORD_STATES.ACCEPTED);
    assert.equal(coverage.repositoryCommit, artifact.repositoryCommit);
    assert.ok(
      [
        ...decisions[0].decision.references,
        ...decisions[0].decision.criteria.flatMap(
          ({ references }) => references,
        ),
      ].some(
        (ref) =>
          ref.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE &&
          ref.evidenceId === coverage.evidenceId,
      ),
      "bounded absence decision cites its authenticated coverage",
    );
    assert.ok(coverage.payload.queries.length > 0);
    assert.ok(coverage.payload.queries.every(({ truncated }) => !truncated));
    assert.ok(
      coverage.payload.directSourceFallbacks.some(
        ({ path: searchedPath }) => searchedPath === "src/notices.py",
      ),
    );

    assert.equal(
      `sha256:${createHash("sha256").update(reportContent).digest("hex")}`,
      artifact.contentSha256,
    );
    assert.deepEqual(
      [
        report.artifactId,
        report.assessmentId,
        report.kind,
        report.caseRevision,
      ],
      [
        artifact.artifactId,
        id,
        ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
        artifact.caseRevision,
      ],
    );
    assert.deepEqual(
      [
        report.pins.legalPortfolioVersionId,
        report.pins.repositorySnapshotId,
        report.pins.repositoryCommit,
      ],
      [
        artifact.legalPortfolioVersionId,
        artifact.repositorySnapshotId,
        artifact.repositoryCommit,
      ],
    );
    assert.deepEqual(
      report.findings.map(({ decisionId, decisionRevision, decision }) => ({
        decisionId,
        decisionRevision,
        decision,
      })),
      decisions.map(({ decisionId, decisionRevision, decision }) => ({
        decisionId,
        decisionRevision,
        decision,
      })),
    );
    assert.ok(
      !/\b(?:UNKNOWN|PARTIAL|NEEDS_CONTEXT|TBD)\b|open questions?|unresolved decision/i.test(
        reportContent,
      ),
      "Root report contains no unresolved outcome placeholder",
    );
    finalization = {
      assessment,
      artifact,
      artifactEvents,
      report,
      reportContent,
      contentSha256Verified: true,
    };
  }
  if (mode === "bounded-absence-gapped") {
    const coverage = (
      await q(
        `SELECT "resolutionState" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1`,
        [id],
      )
    ).rows;
    const lifecycleState = (
      await q(`SELECT "lifecycleState" FROM "Assessment" WHERE id=$1`, [id])
    ).rows[0]?.lifecycleState;
    assert.equal(
      decisions.length,
      0,
      "a known coverage gap cannot become a verdict",
    );
    assert.ok(
      coverage.some(
        (item) => item.resolutionState !== DECISION_RESOLUTION_STATES.RESOLVED,
      ),
      "the affected rule remains unresolved",
    );
    assert.notEqual(lifecycleState, ASSESSMENT_LIFECYCLE_STATES.COMPLETE);
  }
  writeFileSync(
    path.join(outputDir, `${outputLabel}.json`),
    JSON.stringify(
      {
        ...evalReport,
        finalization,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      fixture: mode,
      ...result,
      resumed: resumedResult,
      decisions: decisions.map((d) => ({
        rule: d.engineeringRuleId,
        state: d.state,
        applicability: d.decision.applicability,
        compliance: d.decision.compliance,
      })),
      questions: requests.length,
      requestStates: requests.map(({ requestId, status }) => ({
        requestId,
        status,
      })),
      finalization: finalization && {
        lifecycleState: finalization.assessment.lifecycleState,
        artifactId: finalization.artifact.artifactId,
        artifactEvents: finalization.artifactEvents,
        contentSha256Verified: finalization.contentSha256Verified,
        reportFindings: finalization.report.findings.length,
        reportPins: finalization.report.pins,
      },
      output: path.join(outputDir, `${outputLabel}.json`),
      continuation,
    }),
  );
} finally {
  try {
    await stop();
  } finally {
    rmSync(artifactStoragePath, { recursive: true, force: true });
    if (previousArtifactStoragePath === undefined) {
      delete process.env.LCSP_ARTIFACT_STORAGE_PATH;
    } else {
      process.env.LCSP_ARTIFACT_STORAGE_PATH = previousArtifactStoragePath;
    }
  }
}
