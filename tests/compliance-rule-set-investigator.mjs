// Genuine Assessment Root & Investigator execution against a pinned repository and direct rule set.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { startStack, contentHash, root, python, pythonPath, workerKey, hashSecret } from "./support/compliance-rule-set-stack.mjs";

const evidence = mkdtempSync(path.join(tmpdir(), "lcsp-inv-evidence-"));
const database = `lcsp360_final_direct_inv_${Date.now()}`;
const stack = await startStack({
  database,
  apiPort: 3436,
  dbPort: 55496,
  resetDatabase: false,
  createOnlyDatabase: true,
});

try {
  // 1. Seed and activate legal source with direct draft candidates
  const chunks = [
    {
      locator: "art-1",
      content: "Article 1. Scope and definitions\n1. A record is any structured or unstructured data retained by a healthcare data provider.",
    },
    {
      locator: "art-2",
      content: "Article 2. Technical safeguards for healthcare data\n1. For providers processing sensitive health records:\na) Providers must encrypt stored records using strong cryptographic algorithms.\nb) Providers must restrict access to records through authorization controls, except public records.\nc) Providers must record audit logs for data modifications.",
    },
    {
      locator: "art-3",
      content: "Article 3. Biometric data safeguards\n1. For providers processing biometric identification data:\na) Providers must implement liveness detection for biometric authentication.",
    },
    {
      locator: "art-4",
      content: "Article 4. External reporting\n1. Providers must deliver a signed report to the competent authority.",
    },
  ];
  const bytes = Buffer.from(chunks.map((c) => c.content).join("\n"));
  const sourceId = await stack.seedLegalSource({
    name: "direct-inv-" + randomUUID(),
    status: "ACTIVE",
    documentId: "DIRECT-FIXTURE",
    sourceBytes: bytes,
    sourceSha256: contentHash(bytes),
    chunks: chunks.map((c) => ({ ...c, contentSha256: contentHash(c.content) })),
  });

  const { preparationRunId } = await stack.activateLegalSource(sourceId);
  const support = (locator, quote) => [{ documentId: "DIRECT-FIXTURE", locator, quote }];
  const healthCondition = {
    statement: "Providers processing sensitive health records",
    support: support("art-2", "For providers processing sensitive health records:"),
  };
  const biometricCondition = {
    statement: "Providers processing biometric identification data",
    support: support("art-3", "For providers processing biometric identification data:"),
  };
  const recordDefinition = {
    statement: "A record is any structured or unstructured data retained by a healthcare data provider.",
    support: support("art-1", "A record is any structured or unstructured data retained by a healthcare data provider."),
  };

  const candidates = [
    {
      candidateId: "encrypt",
      title: "Encrypt stored health records",
      obligations: [
        {
          statement: "Providers processing sensitive health records must encrypt stored records using strong cryptographic algorithms.",
          actor: "Providers",
          modality: "DUTY",
          action: "encrypt stored records using strong cryptographic algorithms",
          support: support("art-2::pt-a", "Providers must encrypt stored records using strong cryptographic algorithms."),
        },
      ],
      applicability: { mode: "CONDITIONAL", conditions: [healthCondition] },
      qualifiers: [],
      exceptions: [],
      definitions: [recordDefinition],
      repositoryAssessability: "REPOSITORY_VERIFIABLE",
      nonAssessableReason: null,
      assessmentRule: {
        assessmentRuleId: "encryption",
        concept: "Stored record encryption",
        investigationFocus: "Inspect storage encryption in src/crypto.py",
      },
    },
    {
      candidateId: "access",
      title: "Restrict health record access",
      obligations: [
        {
          statement: "Providers processing sensitive health records must restrict access to records through authorization controls, except public records.",
          actor: "Providers",
          modality: "DUTY",
          action: "restrict access to records through authorization controls",
          support: support("art-2::pt-b", "Providers must restrict access to records through authorization controls, except public records."),
        },
      ],
      applicability: { mode: "CONDITIONAL", conditions: [healthCondition] },
      qualifiers: [],
      exceptions: [
        {
          statement: "Public records are excepted",
          support: support("art-2::pt-b", "except public records."),
        },
      ],
      definitions: [recordDefinition],
      repositoryAssessability: "REPOSITORY_VERIFIABLE",
      nonAssessableReason: null,
      assessmentRule: {
        assessmentRuleId: "access-control",
        concept: "Record access controls",
        investigationFocus: "Inspect record access checks in src/acl.py",
      },
    },
    {
      candidateId: "audit",
      title: "Audit trail logging",
      obligations: [
        {
          statement: "Providers processing sensitive health records must record audit logs for data modifications.",
          actor: "Providers",
          modality: "DUTY",
          action: "record audit logs for data modifications",
          support: support("art-2::pt-c", "Providers must record audit logs for data modifications."),
        },
      ],
      applicability: { mode: "CONDITIONAL", conditions: [healthCondition] },
      qualifiers: [],
      exceptions: [],
      definitions: [recordDefinition],
      repositoryAssessability: "REPOSITORY_VERIFIABLE",
      nonAssessableReason: null,
      assessmentRule: {
        assessmentRuleId: "audit-trail",
        concept: "Audit trail logging",
        investigationFocus: "Inspect audit logging implementation in src/audit.py",
      },
    },
    {
      candidateId: "biometric",
      title: "Biometric liveness detection",
      obligations: [
        {
          statement: "Providers processing biometric identification data must implement liveness detection for biometric authentication.",
          actor: "Providers",
          modality: "DUTY",
          action: "implement liveness detection for biometric authentication",
          support: support("art-3::pt-a", "Providers must implement liveness detection for biometric authentication."),
        },
      ],
      applicability: { mode: "CONDITIONAL", conditions: [biometricCondition] },
      qualifiers: [],
      exceptions: [],
      definitions: [],
      repositoryAssessability: "REPOSITORY_VERIFIABLE",
      nonAssessableReason: null,
      assessmentRule: {
        assessmentRuleId: "biometric-defense",
        concept: "Biometric authentication security",
        investigationFocus: "Inspect biometric data processing and liveness detection in repository",
      },
    },
    {
      candidateId: "report",
      title: "Deliver signed report",
      obligations: [
        {
          statement: "Providers must deliver a signed report to the competent authority.",
          actor: "Providers",
          modality: "DUTY",
          action: "deliver a signed report to the competent authority",
          support: support("art-4", "Providers must deliver a signed report to the competent authority."),
        },
      ],
      applicability: { mode: "UNCONDITIONAL", conditions: [] },
      qualifiers: [],
      exceptions: [],
      definitions: [],
      repositoryAssessability: "EXTERNAL_FULFILLMENT",
      nonAssessableReason: "Delivery of the signed report requires external performance",
      assessmentRule: null,
    },
  ];

  const manifest = {
    candidates,
    noRequirementReasons: {
      "art-1::cl-1": "Definition of a record; no independent operative duty",
      "art-2::cl-1": "Source lead-in supplies the applicability conditions retained by the duties",
      "art-3::cl-1": "Source lead-in supplies the applicability conditions retained by the duties",
      "art-1": "Definition of a record; no independent operative duty",
      "art-2": "Applicability lead-in retained by the duties",
      "art-3": "Applicability lead-in retained by the duties",
      "art-4": "Structural article heading",
      preamble: "Document identity; no independent operative duty",
    },
  };
  const manifestFile = path.join(evidence, "candidates.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  // Run direct_preparation.py to submit, validate and activate Rule Set
  const workerExit = await new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [path.join(root, "deepagents/tests/vertical/direct_preparation.py"), stack.base, workerKey, preparationRunId, manifestFile],
      { cwd: root, env: { ...process.env, PYTHONPATH: pythonPath, LCSP_DIRECT_CRASH_AFTER_SAVE: "0" } }
    );
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
  assert.equal(workerExit.code, 0, workerExit.out);

  const activeRes = await stack.get("active");
  assert.equal(activeRes.status, 200);
  const ruleSetVersionId = activeRes.body.data.ruleSetVersionId;
  assert.ok(ruleSetVersionId);
  assert.equal(activeRes.body.data.legalRequirements.length, 5);
  assert.equal(activeRes.body.data.assessmentRules.length, 4);

  // 2. Set up Customer, Assessment, and REAL Pinned Git Repository
  const customerId = randomUUID();
  const customerEmail = "investigator-test@acme.test";
  const password = "CorrectHorseBatteryStaple!";
  await stack.q(
    `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
    [customerId, customerEmail, hashSecret(password)]
  );
  const signInRes = await fetch(`${stack.base}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: customerEmail, password, organization_id: "org-1" }),
  });
  const sessionToken = (await signInRes.json()).data.session_token;

  // Initialize REAL Git repository
  const repoDir = mkdtempSync(path.join(tmpdir(), "lcsp-real-git-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "LCSP Tester"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "tester@lcsp.test"], { cwd: repoDir });

  mkdirSync(path.join(repoDir, "src"), { recursive: true });

  const cryptoCode = `import os
from cryptography.fernet import Fernet

def encrypt_record(data: bytes, key: bytes) -> bytes:
    """Encrypt sensitive stored records using Fernet symmetric encryption."""
    f = Fernet(key)
    return f.encrypt(data)

def decrypt_record(token: bytes, key: bytes) -> bytes:
    """Decrypt sensitive stored records."""
    f = Fernet(key)
    return f.decrypt(token)
`;

  const aclCode = `class AccessControl:
    """Role-based access control restricting record access."""
    def __init__(self):
        self.public_roles = {"PUBLIC", "GUEST"}

    def is_allowed(self, user_role: str, record_type: str) -> bool:
        """Check whether the user role is authorized to access the given record type."""
        if record_type == "PUBLIC":
            return True
        return user_role == "ADMIN"
`;

  const auditCode = `def log_data_modification(user_id: str, action: str, record_id: str) -> None:
    """Audit trail logging for data modifications."""
    # Audit logging is currently unimplemented in this service
    raise NotImplementedError("Audit logging is not implemented")
`;

  const readmeContent = `# Healthcare Data Management System
This service processes sensitive patient health records.
- Stored records are encrypted with Fernet symmetric keys (see src/crypto.py).
- Record access is restricted by role-based access control (see src/acl.py).
- Audit logging for data modifications is not yet implemented (see src/audit.py).
- This service does NOT collect or process any biometric data.
`;

  writeFileSync(path.join(repoDir, "src/crypto.py"), cryptoCode);
  writeFileSync(path.join(repoDir, "src/acl.py"), aclCode);
  writeFileSync(path.join(repoDir, "src/audit.py"), auditCode);
  writeFileSync(path.join(repoDir, "README.md"), readmeContent);

  // Commit real files to Git
  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "feat: initial healthcare system code"], { cwd: repoDir });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
  assert.equal(commitSha.length, 40, "Commit SHA must be a 40-character git SHA");

  // Create Assessment
  const createAssRes = await fetch(`${stack.base}/assessments`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Direct Rule Set Genuine Investigator Assessment" }),
  });
  const assData = (await createAssRes.json()).data;
  const assessmentId = assData.assessment_id ?? assData.id;

  const connectionId = randomUUID();
  const snapshotId = randomUUID();
  await stack.q(
    `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions)
     VALUES ($1,$2,$3,'inst-inv',$4,'repo','acme/repo','main','{}'::jsonb)`,
    [connectionId, assessmentId, customerId, `repo-${assessmentId}`]
  );
  await stack.q(
    `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId")
     VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}'::jsonb,$6)`,
    [snapshotId, assessmentId, connectionId, `repo-${assessmentId}`, commitSha, customerId]
  );

  // Complete repository setup: pins snapshot and rule set, seeds coverage in PENDING
  const setupRes = await fetch(`${stack.base}/assessments/${assessmentId}/repository-setup/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
  });
  assert.equal(setupRes.status, 201);

  // Verify coverage seeded in PENDING (4 rules)
  const initialPending = (await stack.q('SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'PENDING\'', [assessmentId])).rows[0].count;
  assert.equal(initialPending, 4, "Expected 4 initial pending rules in coverage");

  // 3. RUN THE REAL ASSESSMENT ROOT INVESTIGATOR
  const scriptPath = path.join(root, "deepagents/tests/vertical/direct_investigator_root.py");
  const traceFile = path.join(evidence, "investigator-trace.json");
  const pyResult = await new Promise((resolve, reject) => {
    const child = spawn(
      python,
      [scriptPath, stack.base, workerKey, assessmentId, repoDir, traceFile],
      {
        cwd: root,
        env: {
          ...process.env,
          PYTHONPATH: pythonPath,
          LCSP_ASSESSMENT_EVAL_ROUTE: process.env.LCSP_ASSESSMENT_EVAL_ROUTE ?? "preparation-fallback",
          LANGGRAPH_CHECKPOINT_DATABASE_URL: stack.databaseUrl?.split("?")[0],
        },
      }
    );
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Investigator exited ${code}: ${stderr}\nStdout: ${stdout}`));
      try {
        const jsonLine = stdout.trim().split("\n").filter((line) => line.trim().startsWith("{")).at(-1);
        resolve(JSON.parse(jsonLine));
      } catch (err) {
        reject(new Error(`Invalid JSON output: ${stdout}\nStderr: ${stderr}`));
      }
    });
  });

  console.log("Genuine Investigator execution result:", JSON.stringify(pyResult, null, 2));
  assert.ok(pyResult.calls > 0, "Investigator must have made real model calls");

  // 4. CRYPTOGRAPHIC EVIDENCE & COMMITTED REPOSITORY VERIFICATION
  const evidenceRows = (
    await stack.q(
      'SELECT "evidenceId", payload, "contentSha256", "repositoryCommit" FROM "AssessmentEvidence" WHERE "assessmentId"=$1',
      [assessmentId]
    )
  ).rows;
  assert.ok(evidenceRows.length >= 1, "Expected at least 1 evidence record");

  for (const row of evidenceRows) {
    assert.equal(row.repositoryCommit, commitSha, "Evidence must be pinned to the committed git SHA");
    if (row.payload && row.payload.path) {
      const { path: relPath, startLine, endLine } = row.payload;
      // Read directly from git show <commitSha>:<path> to prove committed authority
      const committedContent = execFileSync("git", ["show", `${commitSha}:${relPath}`], {
        cwd: repoDir,
        encoding: "utf8",
      });
      const committedLines = committedContent.replace(/\r?\n$/, "").split(/\r?\n/).slice(startLine - 1, endLine);
      const expectedExcerpt = committedLines.join("\n");
      const expectedSha256 = "sha256:" + createHash("sha256").update(expectedExcerpt).digest("hex");

      assert.equal(
        row.contentSha256,
        expectedSha256,
        `Evidence ${row.evidenceId} SHA256 does not match pinned git commit ${commitSha} for ${relPath}:${startLine}-${endLine}`
      );
      console.log(`Verified evidence ${row.evidenceId} matches committed git object ${relPath}:${startLine}-${endLine}`);

      // TEST: Mutate the worktree directly at the exact cited line range to verify Git pinning invariant
      const diskPath = path.join(repoDir, relPath);
      const originalDiskContent = readFileSync(diskPath, "utf8");
      const diskLines = originalDiskContent.replace(/\r?\n$/, "").split(/\r?\n/);
      const targetLineIdx = Math.max(0, startLine - 1);
      const originalLineText = diskLines[targetLineIdx] ?? "";
      diskLines[targetLineIdx] = `# TAMPERED MUTATION DIRECTLY AT CITED LINE ${startLine}: was '${originalLineText}'`;
      writeFileSync(diskPath, diskLines.join("\n") + "\n");

      const mutatedLines = readFileSync(diskPath, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
      const mutatedCitedExcerpt = mutatedLines.slice(startLine - 1, endLine).join("\n");
      const mutatedCitedSha256 = "sha256:" + createHash("sha256").update(mutatedCitedExcerpt).digest("hex");

      // Verify that the disk mutation directly altered the hash at the cited line range
      assert.notEqual(
        mutatedCitedSha256,
        row.contentSha256,
        `Direct worktree mutation at cited line ${startLine} must produce a different SHA256 than pinned evidence`
      );

      // Verify that the database evidence contentSha256 strictly preserves the committed Git authority
      assert.equal(
        row.contentSha256,
        expectedSha256,
        `Evidence contentSha256 must remain bound to commit ${commitSha} even when line ${startLine} is tampered on disk`
      );

      // Restore original file
      writeFileSync(diskPath, originalDiskContent);

      // Verify that the backend API strictly enforces evidence pin authority against uncommitted / mismatched commits
      const testTurnId = randomUUID();
      const testLease = randomUUID();
      await stack.q(`UPDATE "Assessment" SET "lifecycleState"='ACTIVE' WHERE id=$1`, [assessmentId]);
      await stack.q(
        `INSERT INTO "AssessmentRuntimeTurn"(id, "assessmentId", "threadId", boundary, "logicalRunId", "correlationId", state, "contextJson", "updatedAt")
         SELECT $1, "assessmentId", "threadId", 'root_turn', 'run-pin-test', 'corr-pin-test', 'RUNNING'::"AssessmentRuntimeControlState", '{}'::jsonb, now()
         FROM "AssessmentRuntime" WHERE "assessmentId"=$2`,
        [testTurnId, assessmentId]
      );
      await stack.q(
        `UPDATE "AssessmentRuntime" SET "executionState"='RUNNING', "leaseToken"=$1, "leaseExpiresAt"=now() + interval '1 hour', "currentExecutionId"=$2 WHERE "assessmentId"=$3`,
        [testLease, testTurnId, assessmentId]
      );

      const mismatchRes = await fetch(`${stack.base}/internal/assessment-runtime/${assessmentId}/evidence`, {
        method: "POST",
        headers: {
          "x-worker-api-key": workerKey,
          "x-assessment-lease": testLease,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "REPOSITORY_SOURCE",
          repositoryCommit: "0000000000000000000000000000000000000000",
          path: relPath,
          startLine,
          endLine,
          excerptSha256: mutatedCitedSha256,
        }),
      });
      assert.equal(mismatchRes.status, 422, "API must reject evidence with mismatched repositoryCommit with status 422");
      const mismatchBody = await mismatchRes.json();
      assert.equal(mismatchBody.problem?.code, "ASSESSMENT_EVIDENCE_PIN_MISMATCH");

      await stack.q(
        `UPDATE "AssessmentRuntime" SET "executionState"='SUCCEEDED', "leaseToken"=NULL, "leaseExpiresAt"=NULL, "currentExecutionId"=NULL WHERE "assessmentId"=$1`,
        [assessmentId]
      );
      await stack.q(`UPDATE "Assessment" SET "lifecycleState"='COMPLETE' WHERE id=$1`, [assessmentId]);
    }
  }

  // 5. DECISION OUTCOME AND COVERAGE VERIFICATION
  const decisions = (
    await stack.q(
      'SELECT "decisionId", "assessmentRuleId", "state", "decisionRevision", "applicability", "compliance" FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"',
      [assessmentId]
    )
  ).rows;

  assert.ok(decisions.length >= 4, `Expected at least 4 decisions, got ${decisions.length}`);
  const decisionByRule = new Map(decisions.map((d) => [d.assessmentRuleId, d]));

  for (const dec of decisions) {
    assert.equal(dec.state, "ACCEPTED", `Decision for rule ${dec.assessmentRuleId} must be ACCEPTED`);
  }

  // Verify Positive controls: encryption and access-control must be APPLICABLE and COMPLIANT
  const encDecision = decisionByRule.get("encryption");
  assert.ok(encDecision, "Decision for encryption must exist");
  assert.equal(encDecision.applicability, "APPLICABLE");
  assert.equal(encDecision.compliance, "COMPLIANT", "Encryption implemented in src/crypto.py must be COMPLIANT");

  const aclDecision = decisionByRule.get("access-control");
  assert.ok(aclDecision, "Decision for access-control must exist");
  assert.equal(aclDecision.applicability, "APPLICABLE");
  assert.equal(aclDecision.compliance, "COMPLIANT", "Access control implemented in src/acl.py must be COMPLIANT");

  // Verify Negative control: audit-trail must be APPLICABLE and NON_COMPLIANT
  const auditDecision = decisionByRule.get("audit-trail");
  assert.ok(auditDecision, "Decision for audit-trail must exist");
  assert.equal(auditDecision.applicability, "APPLICABLE");
  assert.equal(auditDecision.compliance, "NON_COMPLIANT", "Unimplemented audit logging must be NON_COMPLIANT");

  // Verify Unestablished / Not Applicable control: biometric-defense
  const bioDecision = decisionByRule.get("biometric-defense");
  assert.ok(bioDecision, "Decision for biometric-defense must exist");
  assert.equal(
    bioDecision.applicability,
    "NOT_APPLICABLE",
    "Service without biometric data must conclude biometric-defense NOT_APPLICABLE"
  );

  // Coverage verification: 0 pending, all resolved
  const finalPending = (
    await stack.q(
      'SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'PENDING\'',
      [assessmentId]
    )
  ).rows[0].count;
  assert.equal(finalPending, 0, "All rules must be resolved with 0 pending");

  console.log("GENUINE ASSESSMENT INVESTIGATOR REAL LLM TEST PASSED!");
} finally {
  await stack.stop();
}
