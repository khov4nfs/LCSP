// Vertical: ONE assessment pinned to TWO repositories, run through the real built API, real PostgreSQL and the real
// Root tools with a provider-free scripted model.
//   repo "web": the frontend that collects consent.
//   repo "api": the backend that stores and deletes it (scoped to services/billing).
// Rule ER-CONSENT is only satisfied by evidence from BOTH repositories; ER-RETENTION cites the api repository alone.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION,
  assessmentFinalReportArtifactVersionedSchema,
} from "@lcsp/contracts/assessment-report";
import {
  contentHash,
  root,
  runPython,
  startStack,
  workerKey,
} from "./support/compliance-rule-set-stack.mjs";

const requireApi = createRequire(path.join(root, "apps/api/package.json"));
const { AssessmentArtifactKind } = requireApi("@prisma/client");
const database = "lcsp_multi_repository_vertical";
const apiPort = Number(process.env.LCSP_ASSESSMENT_TEST_API_PORT ?? 3416);
const storageRoot = mkdtempSync(
  path.join(tmpdir(), "lcsp-multirepo-artifacts-"),
);
const previousStorage = process.env.LCSP_ARTIFACT_STORAGE_PATH;
process.env.LCSP_ARTIFACT_STORAGE_PATH = storageRoot;
const DOC = "SYNTHETIC-MULTI-REPOSITORY";
const sha = (value) => createHash("sha256").update(value).digest("hex");
// The structured locator set the source graph resolves (same shape the other assessment verticals seed).
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
const contentFor = (locator) => `content ${locator}`;
const ref = (locator) => ({
  documentId: DOC,
  locator,
  contentSha256: contentHash(contentFor(locator)),
});
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

const ruleDefinitions = [
  {
    assessmentRuleId: "ER-CONSENT",
    legalRequirementIds: ["LR-CONSENT"],
    locator: "art-1::cl-1",
    compliance: "COMPLIANT",
    rationale:
      "The web repository collects consent and the api repository records it, so the consent control is present end to end.",
  },
  {
    assessmentRuleId: "ER-RETENTION",
    legalRequirementIds: ["LR-RETENTION"],
    locator: "art-5::cl-1::pt-a",
    compliance: "NON_COMPLIANT",
    rationale:
      "The api repository stores consent records but never deletes them after withdrawal.",
  },
];
const packet = {
  legalRequirements: ruleDefinitions.map((rule) => ({
    legalRequirementId: rule.legalRequirementIds[0],
    title: `Synthetic ${rule.legalRequirementIds[0]}`,
    proposition: `Synthetic proposition for ${rule.legalRequirementIds[0]}.`,
    applicabilityConditions: ["Synthetic condition."],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty: false,
    sourceRefs: [ref(rule.locator)],
    coverage: {
      state: "COVERED_BY_ASSESSMENT_RULES",
      nonAssessableReason: null,
    },
  })),
  assessmentRules: ruleDefinitions.map((rule) => ({
    assessmentRuleId: rule.assessmentRuleId,
    legalRequirementIds: rule.legalRequirementIds,
    concept: `Synthetic ${rule.assessmentRuleId}`,
    legalIntent: `Synthetic legal intent for ${rule.assessmentRuleId}.`,
    applicabilityGuidance: "Applies when personal data is processed.",
    criteria: [{ criterionId: "C-1", statement: "The control is present." }],
    investigationGoals: ["inspect the control in every repository"],
    startingNodeTypes: [],
    targetNodeTypes: [],
    edgeStrategies: [],
    graphQueries: [],
    keywords: [],
    commonApis: [],
    commonLibraries: [],
    patterns: [],
    requiredEvidence: ["control evidence"],
    supportingEvidence: [],
    negativeEvidence: [],
    unresolvedConditions: [],
    sourceRefs: [ref(rule.locator)],
  })),
  contextRelations: [],
};

let stopStack = async () => {};
let seedDir;
let repoDir;
try {
  const { q, base, stop, seedLegalSource, startPreparationFixture } =
    await startStack({ database, apiPort });
  stopStack = stop;
  const sourceBytes = Buffer.from(
    locators
      .map((locator) => contentFor(locator))
      .join(String.fromCharCode(10)) + String.fromCharCode(10),
    "utf8",
  );
  const source = await seedLegalSource({
    name: "multi-repository-source",
    status: "ACTIVE",
    documentId: DOC,
    sourceBytes,
    sourceSha256: contentHash(sourceBytes),
    chunks: locators.map((locator) => ({
      locator,
      content: contentFor(locator),
      contentSha256: contentHash(contentFor(locator)),
    })),
  });
  seedDir = mkdtempSync(path.join(tmpdir(), "lcsp-multirepo-seed-"));
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
  const activation = await startPreparationFixture(source);
  const prepared = await runPython(
    path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
    [base, workerKey, activation.preparationRunId, seedFile, "valid"],
  );
  assert.equal(prepared.state, "SUCCEEDED", JSON.stringify(prepared));

  const password = "CorrectHorseBatteryStaple!";
  const ownerId = randomUUID();
  const cryptoMod = await import(
    pathToFileURL(
      path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js"),
    ).href
  );
  const hashSecret = cryptoMod.hashSecretSync ?? cryptoMod.hashSecret;
  await q(
    `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
    [ownerId, "multirepo@acme.test", hashSecret(password)],
  );
  const signed = await http(base, "POST", "/auth/sign-in", {
    body: {
      email: "multirepo@acme.test",
      password,
      organization_id: "org-1",
    },
    worker: false,
  });
  assert.equal(signed.status, 200);
  const token = signed.body.data.session_token;
  const created = await http(base, "POST", "/assessments", {
    token,
    body: { name: "LCSP multi-repository assessment" },
    worker: false,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const assessmentId = created.body.data.assessment_id ?? created.body.data.id;

  // Two candidate repositories: web (whole tree) and api (scoped to services/billing).
  const candidates = [
    { fullName: "acme/web", commit: "a".repeat(40), prefix: null },
    {
      fullName: "acme/api",
      commit: "b".repeat(40),
      prefix: "services/billing",
    },
  ];
  const snapshotIds = [];
  for (const candidate of candidates) {
    const connection = randomUUID();
    const snapshot = randomUUID();
    const repositoryId = `repo-${randomUUID()}`;
    await q(
      `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,$4,$5,$6,$7,'main','{}'::jsonb)`,
      [
        connection,
        assessmentId,
        ownerId,
        `inst-${connection}`,
        repositoryId,
        candidate.fullName.split("/")[1],
        candidate.fullName,
      ],
    );
    await q(
      `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","sourcePathPrefix","providerMetadata","actorId") VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,$8)`,
      [
        snapshot,
        assessmentId,
        connection,
        repositoryId,
        candidate.fullName,
        candidate.commit,
        candidate.prefix,
        ownerId,
      ],
    );
    snapshotIds.push(snapshot);
  }
  // Full-audit mode (as the other assessment verticals do): the rule-audit selection flow has its own coverage.
  await q(
    `UPDATE "AssessmentCase" SET "auditMode"='LEGACY_FULL' WHERE "assessmentId"=$1`,
    [assessmentId],
  );
  const setup = await http(
    base,
    "POST",
    `/assessments/${assessmentId}/repository-setup/complete`,
    { token, worker: false, body: { snapshotIds } },
  );
  assert.equal(setup.status, 201, JSON.stringify(setup.body));

  const pinned = (
    await q(
      `SELECT "repositoryKey", ordinal, "repositorySnapshotId", "repositoryCommit", "sourcePathPrefix" FROM "AssessmentCaseRepository" WHERE "assessmentId"=$1 ORDER BY ordinal`,
      [assessmentId],
    )
  ).rows;
  assert.equal(pinned.length, 2, "both repositories are pinned as one set");
  const caseRow = (
    await q(
      `SELECT "repositoryCount", "repositorySetDigest" FROM "AssessmentCase" WHERE "assessmentId"=$1`,
      [assessmentId],
    )
  ).rows[0];
  assert.equal(caseRow.repositoryCount, 2);
  assert.match(caseRow.repositorySetDigest, /^sha256:[0-9a-f]{64}$/);

  const contents = {
    web: {
      grepPattern: "collectConsent",
      citePath: "src/consent.ts",
      files: {
        "src/consent.ts": "export function collectConsent() { return true; }\n",
      },
    },
    api: {
      grepPattern: "storeConsent",
      citePath: "services/billing/store.py",
      files: {
        "services/billing/store.py":
          "def storeConsent(record):\n    save(record)\n",
      },
    },
  };
  const keys = pinned.map((row) => row.repositoryKey);
  assert.deepEqual(keys, ["web", "api"]);
  repoDir = mkdtempSync(path.join(tmpdir(), "lcsp-multirepo-repos-"));
  const configFile = path.join(seedDir, "root-config.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      factStatement:
        "Consent is collected by the web repository and stored by the api repository.",
      repositories: pinned.map((row) => ({
        repositoryKey: row.repositoryKey,
        snapshotId: row.repositorySnapshotId,
        commit: row.repositoryCommit,
        sourcePathPrefix: row.sourcePathPrefix,
        ...contents[row.repositoryKey],
      })),
      rules: ruleDefinitions,
    }),
  );
  const rootRun = await runPython(
    path.join(
      root,
      "deepagents/tests/vertical/scripted_root_multi_repository.py",
    ),
    [base, workerKey, assessmentId, repoDir, configFile],
  );
  assert.equal(rootRun.result.state, "SUCCEEDED", JSON.stringify(rootRun));
  // Only the closing chat message may remain: the accepted final report ends the run.
  assert.ok(
    rootRun.remainingSteps <= 1,
    "the whole scripted investigation ran",
  );
  assert.equal(
    (
      await q(`SELECT "lifecycleState" FROM "Assessment" WHERE id=$1`, [
        assessmentId,
      ])
    ).rows[0].lifecycleState,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  );

  // Evidence is bound to the repository it was read from.
  const evidenceRows = (
    await q(
      `SELECT type, "repositoryKey", "repositoryCommit" FROM "AssessmentEvidence" WHERE "assessmentId"=$1 AND type='REPOSITORY_SOURCE' ORDER BY "repositoryKey"`,
      [assessmentId],
    )
  ).rows;
  assert.deepEqual(
    evidenceRows.map((row) => row.repositoryKey),
    ["api", "web"],
  );
  for (const row of evidenceRows) {
    const pin = pinned.find((item) => item.repositoryKey === row.repositoryKey);
    assert.equal(row.repositoryCommit, pin.repositoryCommit);
  }

  // The published artifact is a V4 report of the pinned set.
  const artifactRow = (
    await q(
      `SELECT "artifactId", "contentSha256", "sizeBytes", "storageRef" FROM "AssessmentArtifact" WHERE "assessmentId"=$1 AND kind=$2`,
      [assessmentId, AssessmentArtifactKind.FINAL_REPORT],
    )
  ).rows[0];
  const manifest = JSON.parse(artifactRow.storageRef);
  const storedBytes = Buffer.concat(
    manifest.chunks.map((chunk) =>
      readFileSync(path.join(storageRoot, "chunks", chunk)),
    ),
  );
  assert.equal(`sha256:${sha(storedBytes)}`, artifactRow.contentSha256);
  const downloaded = await fetch(
    `${base}/assessments/${assessmentId}/artifacts/${artifactRow.artifactId}/download`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(downloaded.status, 200);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.deepEqual(bytes, storedBytes);
  const report = assessmentFinalReportArtifactVersionedSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  assert.equal(report.schemaVersion, ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION);
  assert.deepEqual(
    report.pins.repositories.map((item) => item.repositoryKey),
    ["web", "api"],
  );
  assert.equal(report.pins.repositorySetDigest, caseRow.repositorySetDigest);
  assert.deepEqual(
    report.pins.repositories.map((item) => item.repositoryCommit),
    pinned.map((item) => item.repositoryCommit),
  );
  assert.deepEqual(
    report.sourceScopes.map((scope) => [
      scope.repositoryKey,
      scope.sourcePathPrefix,
    ]),
    [
      ["web", null],
      ["api", "services/billing"],
    ],
  );
  assert.equal(report.outcomeSummary.totalRules, 2);
  assert.deepEqual(
    [
      report.outcomeSummary.applicableCompliant,
      report.outcomeSummary.applicableNonCompliant,
    ],
    [1, 1],
  );

  // The cross-repository rule cites evidence of both repositories; the other cites only the api one.
  const keyOfEvidence = new Map(
    report.evidenceIndex.map((item) => [item.evidenceId, item.repositoryKey]),
  );
  const citedKeys = (ruleId) =>
    new Set(
      report.ruleDetails
        .find((detail) => detail.assessmentRuleId === ruleId)
        .decision.references.filter(
          (item) => item.type === "ASSESSMENT_EVIDENCE",
        )
        .map((item) => keyOfEvidence.get(item.evidenceId)),
    );
  assert.deepEqual([...citedKeys("ER-CONSENT")].sort(), ["api", "web"]);
  assert.deepEqual([...citedKeys("ER-RETENTION")], ["api"]);
  console.log("[MULTI_REPOSITORY_VERTICAL] PASSED");

  await stopStack();
  stopStack = async () => {};
} finally {
  await stopStack().catch(() => {});
  if (seedDir) rmSync(seedDir, { recursive: true, force: true });
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  rmSync(storageRoot, { recursive: true, force: true });
  if (previousStorage === undefined)
    delete process.env.LCSP_ARTIFACT_STORAGE_PATH;
  else process.env.LCSP_ARTIFACT_STORAGE_PATH = previousStorage;
}
