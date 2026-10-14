import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import {
  contentHash,
  root,
  runPython,
  startStack,
  workerKey,
} from "./support/compliance-rule-set-stack.mjs";

const requireApi = createRequire(path.join(root, "apps/api/package.json"));
const { AssessmentArtifactKind } = requireApi("@prisma/client");
const scenario = process.env.LCSP_CORPUS_SCENARIO ?? "ai";
const database =
  scenario === "all-na" ? "lcsp_report_all_na" : "lcsp_report_ai";
const apiPort = Number(process.env.LCSP_ASSESSMENT_TEST_API_PORT ?? 3414);
const storageRoot = mkdtempSync(
  path.join(tmpdir(), `lcsp-${scenario}-artifacts-`),
);
const previousStorage = process.env.LCSP_ARTIFACT_STORAGE_PATH;
process.env.LCSP_ARTIFACT_STORAGE_PATH = storageRoot;
const DOC = scenario === "all-na" ? "SYNTHETIC-ALL-NA" : "SYNTHETIC-AI-CORPUS";
const COMMIT = scenario === "all-na" ? "a".repeat(40) : "b".repeat(40);
const count = scenario === "all-na" ? 20 : 3;
const locators = Array.from({ length: count }, (_, i) => `rule-${i + 1}`);
const contentFor = (locator) =>
  `Synthetic ${scenario} corpus provision ${locator}.`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const http = async (
  base,
  method,
  route,
  { token, body, worker = true } = {},
) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(worker ? { "x-worker-api-key": workerKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
};
const ref = (locator) => ({
  documentId: DOC,
  locator,
  contentSha256: contentHash(contentFor(locator)),
});
const ruleDefinitions =
  scenario === "all-na"
    ? Array.from({ length: 20 }, (_, i) => ({
        assessmentRuleId: `ER-NA-${String(i + 1).padStart(2, "0")}`,
        legalRequirementIds: [`LR-NA-${String(i + 1).padStart(2, "0")}`],
        locator: locators[i],
        applicability: "NOT_APPLICABLE",
        compliance: null,
        rationale: `Synthetic applicability condition for rule ${i + 1} is not triggered.`,
      }))
    : [
        {
          assessmentRuleId: "ER-AI-INVENTORY",
          legalRequirementIds: ["LR-AI-INVENTORY"],
          locator: locators[0],
          applicability: "APPLICABLE",
          compliance: "COMPLIANT",
          rationale: "The synthetic AI inventory control is present.",
        },
        {
          assessmentRuleId: "ER-AI-OPTIONAL",
          legalRequirementIds: ["LR-AI-OPTIONAL"],
          locator: locators[2],
          applicability: "NOT_APPLICABLE",
          compliance: null,
          rationale: "The synthetic optional AI feature is not enabled.",
        },
        {
          assessmentRuleId: "ER-AI-OVERSIGHT",
          legalRequirementIds: ["LR-AI-OVERSIGHT", "LR-AI-RECORDS"],
          locator: locators[1],
          applicability: "APPLICABLE",
          compliance: "NON_COMPLIANT",
          rationale: "The synthetic human oversight record is incomplete.",
        },
      ];
if (scenario === "ai-permuted") {
  // Deliberately differ from lexical AssessmentRule ID order. The persisted
  // rule-set ordinals remain this packet order while accepted decisions are
  // queried by ID; this is the regression input for fingerprint canonicality.
  ruleDefinitions.splice(1, 2, ruleDefinitions[2], ruleDefinitions[1]);
}
const packet = {
  legalRequirements: ruleDefinitions
    .map((rule) =>
      rule.legalRequirementIds.map((id) => ({
        legalRequirementId: id,
        title: `Synthetic ${id}`,
        proposition: `Synthetic proposition for ${id}.`,
        applicabilityConditions: [`Synthetic condition for ${id}.`],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        sourceRefs: [ref(rule.locator)],
        coverage: {
          state: "COVERED_BY_ASSESSMENT_RULES",
          nonAssessableReason: null,
        },
      })),
    )
    .flat(),
  assessmentRules: ruleDefinitions.map((rule) => ({
    assessmentRuleId: rule.assessmentRuleId,
    legalRequirementIds: rule.legalRequirementIds,
    concept: `Synthetic ${rule.assessmentRuleId}`,
    legalIntent: `Synthetic legal intent for ${rule.assessmentRuleId}.`,
    applicabilityGuidance:
      "Applies only when the synthetic condition is triggered.",
    criteria: [
      { criterionId: "C-1", statement: "The synthetic control is present." },
    ],
    investigationGoals: ["inspect the synthetic control"],
    startingNodeTypes: [],
    targetNodeTypes: [],
    edgeStrategies: [],
    graphQueries: [],
    keywords: [],
    commonApis: [],
    commonLibraries: [],
    patterns: [],
    requiredEvidence: ["synthetic control evidence"],
    supportingEvidence: [],
    negativeEvidence: [],
    unresolvedConditions: [],
    sourceRefs: [ref(rule.locator)],
  })),
  contextRelations: [],
};

let stopStack = async () => {};
try {
  const { q, base, stop, seedLegalSource, activateLegalSource } =
    await startStack({ database, apiPort });
  stopStack = stop;
  const source = await seedLegalSource({
    name: `${scenario}-source`,
    status: "ACTIVE",
    documentId: DOC,
    chunks: locators.map((locator) => ({
      locator,
      content: contentFor(locator),
      contentSha256: contentHash(contentFor(locator)),
    })),
  });
  const seedDir = mkdtempSync(path.join(tmpdir(), `lcsp-${scenario}-seed-`));
  const seedFile = path.join(seedDir, "seed.json");
  writeFileSync(
    seedFile,
    JSON.stringify({
      hashes: Object.fromEntries(
        locators.map((locator) => [locator, contentHash(contentFor(locator))]),
      ),
      packet,
    }),
  );
  const activation = await activateLegalSource(source);
  const prepared = await runPython(
    path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
    [base, workerKey, activation.preparationRunId, seedFile, "valid"],
  );
  assert.equal(prepared.state, "SUCCEEDED", JSON.stringify(prepared));
  const ruleSetVersionId = prepared.submission.ruleSetVersionId;
  const password = "CorrectHorseBatteryStaple!";
  const ownerId = randomUUID();
  const hashSecret = (
    await import(
      pathToFileURL(
        path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js"),
      ).href
    )
  ).hashSecret;
  await q(
    `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
    [ownerId, `${scenario}@acme.test`, hashSecret(password)],
  );
  const signed = await http(base, "POST", "/auth/sign-in", {
    body: {
      email: `${scenario}@acme.test`,
      password,
      organization_id: "org-1",
    },
    worker: false,
  });
  assert.equal(signed.status, 200);
  const token = signed.body.data.session_token;
  const created = await http(base, "POST", "/assessments", {
    token,
    body: { name: `LCSP ${scenario} corpus` },
    worker: false,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const assessmentId = created.body.data.assessment_id ?? created.body.data.id;
  const connection = randomUUID();
  const snapshot = randomUUID();
  await q(
    `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,'inst-corpus',$4,'repo','acme/repo','main','{}'::jsonb)`,
    [connection, assessmentId, ownerId, `repo-${assessmentId}`],
  );
  await q(
    `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}'::jsonb,$6)`,
    [
      snapshot,
      assessmentId,
      connection,
      `repo-${assessmentId}`,
      COMMIT,
      ownerId,
    ],
  );
  const setup = await http(
    base,
    "POST",
    `/assessments/${assessmentId}/repository-setup/complete`,
    { token, worker: false },
  );
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  const repoDir = mkdtempSync(path.join(tmpdir(), `lcsp-${scenario}-repo-`));
  mkdirSync(path.join(repoDir, "src"));
  writeFileSync(
    path.join(repoDir, "src/control.py"),
    "synthetic_control = True\n",
  );
  const configFile = path.join(seedDir, "root-config.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      grepPattern: scenario === "all-na" ? "synthetic_control" : "ai_inventory",
      factStatement: `The synthetic ${scenario} system context is recorded.`,
      rules: ruleDefinitions.map((rule) => ({ ...rule, criterionId: "C-1" })),
    }),
  );
  const rootRun = await runPython(
    path.join(root, "deepagents/tests/vertical/scripted_root_corpus.py"),
    [base, workerKey, assessmentId, repoDir, configFile],
  );
  assert.equal(rootRun.result.state, "SUCCEEDED", JSON.stringify(rootRun));
  const artifactRow = (
    await q(
      `SELECT "artifactId", "contentSha256", "sizeBytes", "storageRef", kind, "lifecycleState", "schemaVersion", "ruleSetVersionId", "repositorySnapshotId", "repositoryCommit", "caseRevision" FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
      [assessmentId, AssessmentArtifactKind.FINAL_REPORT],
    )
  ).rows[0];
  assert.equal(
    (
      await q(`SELECT "lifecycleState" FROM "Assessment" WHERE id=$1`, [
        assessmentId,
      ])
    ).rows[0].lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  );
  const manifest = JSON.parse(artifactRow.storageRef);
  const storedBytes = Buffer.concat(
    manifest.chunks.map((chunk) =>
      readFileSync(path.join(storageRoot, "chunks", chunk)),
    ),
  );
  assert.equal(`sha256:${sha(storedBytes)}`, artifactRow.contentSha256);
  assert.equal(storedBytes.length, artifactRow.sizeBytes);
  const downloaded = await fetch(
    `${base}/assessments/${assessmentId}/artifacts/${artifactRow.artifactId}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.equal(downloaded.status, 200);
  assert.deepEqual(bytes, storedBytes);
  const report = assessmentFinalReportArtifactVersionedSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  const invalidAssessment = await fetch(
    `${base}/assessments/not-a-uuid/artifacts/${artifactRow.artifactId}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(invalidAssessment.status, 422);
  const invalidArtifact = await fetch(
    `${base}/assessments/${assessmentId}/artifacts/not-a-uuid/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(invalidArtifact.status, 422);
  const wrongPair = await fetch(
    `${base}/assessments/${randomUUID()}/artifacts/${artifactRow.artifactId}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(wrongPair.status, 404);
  assert.equal(report.ruleDetails.length, count);
  assert.equal(report.outcomeSummary.totalRules, count);
  assert.equal(
    new Set(report.ruleDetails.map((detail) => detail.assessmentRuleId)).size,
    count,
  );
  assert.equal(
    (
      await q(
        `SELECT count(*)::int AS count FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 AND state='ACCEPTED'`,
        [assessmentId],
      )
    ).rows[0].count,
    count,
  );
  assert(
    report.ruleDetails.every((detail) =>
      detail.sourceRefs.every(
        (sourceRef) =>
          sourceRef.legalSourceVersionId === report.pins.legalSourceVersionId &&
          sourceRef.documentId === DOC &&
          sourceRef.contentSha256 === ref(sourceRef.locator).contentSha256,
      ),
    ),
  );
  if (scenario === "all-na") {
    assert.deepEqual(
      [
        report.outcomeSummary.applicableCompliant,
        report.outcomeSummary.applicableNonCompliant,
        report.outcomeSummary.notApplicable,
      ],
      [0, 0, 20],
    );
    assert(
      report.ruleDetails.every(
        (detail) =>
          detail.decision.applicability === "NOT_APPLICABLE" &&
          detail.decision.compliance === null &&
          detail.decision.criteria.length === 0 &&
          detail.decision.references.length > 0,
      ),
    );
  } else {
    assert.deepEqual(
      [
        report.outcomeSummary.applicableCompliant,
        report.outcomeSummary.applicableNonCompliant,
        report.outcomeSummary.notApplicable,
      ],
      [1, 1, 1],
    );
    assert.equal(
      report.ruleDetails.find(
        (detail) => detail.assessmentRuleId === "ER-AI-OVERSIGHT",
      )?.legalRequirementIds.length,
      2,
    );
  }
  const fixturePath = process.env.LCSP_BROWSER_FIXTURE_FILE;
  const releasePath = process.env.LCSP_BROWSER_RELEASE_FILE;
  if (fixturePath && releasePath) {
    const foreignEmail = `${scenario}-foreign@acme.test`;
    const foreignId = randomUUID();
    await q(
      `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
      [foreignId, foreignEmail, hashSecret(password)],
    );
    const foreignSigned = await http(base, "POST", "/auth/sign-in", {
      body: { email: foreignEmail, password, organization_id: "org-1" },
      worker: false,
    });
    assert.equal(foreignSigned.status, 200);
    writeFileSync(
      fixturePath,
      JSON.stringify({
        scenario,
        apiBase: base,
        assessmentId,
        artifactId: artifactRow.artifactId,
        ownerToken: token,
        foreignToken: foreignSigned.body.data.session_token,
        artifactHash: `sha256:${sha(bytes)}`,
        ruleIds: ruleDefinitions.map((rule) => rule.assessmentRuleId),
        schemaVersion: report.schemaVersion,
        expectedCounts: report.outcomeSummary,
      }),
    );
    while (!existsSync(releasePath))
      await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopStack();
  stopStack = async () => {};
  rmSync(seedDir, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
} finally {
  await stopStack().catch(() => {});
  rmSync(storageRoot, { recursive: true, force: true });
  if (previousStorage === undefined)
    delete process.env.LCSP_ARTIFACT_STORAGE_PATH;
  else process.env.LCSP_ARTIFACT_STORAGE_PATH = previousStorage;
}
