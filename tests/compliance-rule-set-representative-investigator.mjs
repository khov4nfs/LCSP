// Genuine AI Assessment Investigation on representative rules from the activated full-corpus Rule Set.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { startStack, root, python, pythonPath, workerKey, hashSecret } from "./support/compliance-rule-set-stack.mjs";

const database = process.env.LCSP_LIVE_DATABASE ?? "lcsp360_final_direct_full_20261025";
const evidence = mkdtempSync(path.join(tmpdir(), "lcsp-representative-inv-"));
console.log(`Starting stack on database ${database}, evidence directory: ${evidence}`);

const stack = await startStack({
  database,
  apiPort: 3439,
  dbPort: 55496,
  resetDatabase: false,
  createOnlyDatabase: false,
});

try {
  // 1. Verify that the active Rule Set is the production full-corpus Rule Set
  const activeRes = await stack.get("active");
  assert.equal(activeRes.status, 200, "Active rule set endpoint failed");
  const ruleSetVersionId = activeRes.body.data.ruleSetVersionId;
  assert.ok(ruleSetVersionId);
  console.log(`Active full-corpus Rule Set Version ID: ${ruleSetVersionId}`);

  const counts = (
    await stack.q(
      `SELECT
        (SELECT count(*) FROM "LegalRequirement" WHERE "ruleSetVersionId" = $1) as reqs,
        (SELECT count(*) FROM "AssessmentRule" WHERE "ruleSetVersionId" = $1) as rules,
        (SELECT count(*) FROM "LegalRequirementContextRelation" WHERE "ruleSetVersionId" = $1) as relations`,
      [ruleSetVersionId]
    )
  ).rows[0];
  console.log(`Rule Set Counts: ${counts.reqs} requirements, ${counts.rules} rules, ${counts.relations} context relations`);
  assert.equal(Number(counts.reqs), 633);
  assert.equal(Number(counts.rules), 243);
  assert.equal(Number(counts.relations), 35);

  // 2. Set up Customer user and Assessment Case
  const customerId = randomUUID();
  const customerEmail = `representative-${randomUUID()}@acme.test`;
  const password = "RepresentativeInvestigatorPassword!";
  await stack.q(
    `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`,
    [customerId, customerEmail, hashSecret(password)]
  );
  const signInRes = await fetch(`${stack.base}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: customerEmail, password, organization_id: "org-1" }),
  });
  assert.equal(signInRes.status, 200);
  const sessionToken = (await signInRes.json()).data.session_token;

  // 3. Initialize a REAL Git repository with relevant code evidence matching the representative rules
  const repoDir = mkdtempSync(path.join(tmpdir(), "lcsp-representative-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["config", "user.name", "LCSP Representative Tester"], { cwd: repoDir });
  execFileSync("git", ["config", "user.email", "rep-tester@lcsp.test"], { cwd: repoDir });

  mkdirSync(path.join(repoDir, "src"), { recursive: true });

  // Code evidence 1: System audit logging under Law 116/2025/QH15 Art. 25(2)(b) (ANM-2025-Art25-Rule-LuuNhatKy)
  const auditCode = `import time
import json

def log_system_event(event_type: str, user_id: str, action: str, details: dict) -> dict:
    """Luu vet nhat ky he thong de phuc vu xac minh, dieu tra, xu ly hanh vi vi pham phap luat ve an ninh mang."""
    entry = {
        "timestamp": time.time(),
        "eventType": event_type,
        "userId": user_id,
        "action": action,
        "details": details,
        "retentionDays": 365,
    }
    return entry
`;

  // Code evidence 2: User identity authentication when registering accounts under Law 116 Art. 25(2)(a) (ANM-2025-Art25-Rule-XacThucDangKy)
  const authCode = `def verify_account_registration(phone_number: str, identity_card: str, otp_code: str) -> bool:
    """Xac thuc thong tin nguoi dung khi dang ky tai khoan so."""
    if not phone_number or not identity_card or not otp_code:
        return False
    # Authenticate user identity and digital account registration details
    is_valid_cccd = len(identity_card) == 12 and identity_card.isdigit()
    is_valid_otp = len(otp_code) == 6 and otp_code.isdigit()
    return is_valid_cccd and is_valid_otp
`;

  // Code evidence 3: Technical cybersecurity measures for personal data processing under Law 116 Art. 41(4) (art41-cl4-assess)
  const cryptoCode = `from cryptography.fernet import Fernet

def encrypt_data_processing(payload: bytes, secret_key: bytes) -> bytes:
    """Ap dung bien phap ky thuat bao dam an ninh mang cho hoat dong xu ly du lieu ca nhan."""
    cipher = Fernet(secret_key)
    return cipher.encrypt(payload)

def decrypt_data_processing(token: bytes, secret_key: bytes) -> bytes:
    """Giai ma du lieu ca nhan duoc bao ve."""
    cipher = Fernet(secret_key)
    return cipher.decrypt(token)
`;

  // Code evidence 4: Logging of personal data processing activities under Decree 356 Art. 8(1) (AR-ART8-CL1-LOG)
  const dataLogCode = `import time

def log_personal_data_processing(data_subject_id: str, purpose: str, operation: str) -> dict:
    """Record logs of all personal data processing activities."""
    return {
        "timestamp": time.time(),
        "dataSubjectId": data_subject_id,
        "processingPurpose": purpose,
        "operation": operation,
        "status": "RECORDED"
    }
`;

  const readmeContent = `# Enterprise Cyberspace & Data Management System
This service implements the following controls:
- System audit logging for violations investigation in \`src/audit.py\` (Law 116 Art. 25(2)(b)).
- Digital account registration verification with citizen identity card in \`src/auth.py\` (Law 116 Art. 25(2)(a)).
- Technical encryption measures for personal data processing in \`src/crypto.py\` (Law 116 Art. 41(4)).
- Personal data processing activity logging in \`src/data_log.py\` (Decree 356 Art. 8(1)).
`;

  writeFileSync(path.join(repoDir, "src/audit.py"), auditCode);
  writeFileSync(path.join(repoDir, "src/auth.py"), authCode);
  writeFileSync(path.join(repoDir, "src/crypto.py"), cryptoCode);
  writeFileSync(path.join(repoDir, "src/data_log.py"), dataLogCode);
  writeFileSync(path.join(repoDir, "README.md"), readmeContent);
  writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({
    name: "acme-representative-service",
    version: "1.0.0",
    description: "Enterprise service implementing representative Vietnamese cybersecurity and data protection controls.",
    private: true,
  }, null, 2) + "\n");

  execFileSync("git", ["add", "."], { cwd: repoDir });
  execFileSync("git", ["commit", "-m", "feat: implement representative compliance controls"], { cwd: repoDir });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
  assert.equal(commitSha.length, 40);
  console.log(`Initialized Git repository with commit ${commitSha}`);

  // 4. Create Assessment Case
  const createAssRes = await fetch(`${stack.base}/assessments`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Representative Assessment on Activated Legal Rule Set" }),
  });
  const assData = (await createAssRes.json()).data;
  const assessmentId = assData.assessment_id ?? assData.id;
  assert.ok(assessmentId);

  const connectionId = randomUUID();
  const snapshotId = randomUUID();
  await stack.q(
    `INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions)
     VALUES ($1,$2,$3,'inst-rep',$4,'repo','acme/representative-service','main','{}'::jsonb)`,
    [connectionId, assessmentId, customerId, `repo-${assessmentId}`]
  );
  await stack.q(
    `INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId")
     VALUES ($1,$2,$3,$4,'acme/representative-service',$5,'{}'::jsonb,$6)`,
    [snapshotId, assessmentId, connectionId, `repo-${assessmentId}`, commitSha, customerId]
  );

  // Complete repository setup: pins snapshot and rule set, seeds coverage in PENDING (243 rules)
  const setupRes = await fetch(`${stack.base}/assessments/${assessmentId}/repository-setup/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
  });
  assert.equal(setupRes.status, 201);

  // 5. Select Representative Rules from the 243 rules of the active rule set
  const representativeRules = [
    "ANM-2025-Art25-Rule-LuuNhatKy",
    "ANM-2025-Art25-Rule-XacThucDangKy",
    "art41-cl4-assess",
    "AR-ART8-CL1-LOG",
  ];

  // Pre-resolve the 239 non-representative rules with baseline evidence, leaving exactly the 4 representative rules in PENDING
  const req = async (method, route, { body, token, worker, lease } = {}) => {
    const res = await fetch(`${stack.base}${route}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(worker ? { "x-worker-api-key": workerKey } : {}),
        ...(lease ? { "x-assessment-lease": lease } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await res.json();
    assert.ok(res.ok && result.ok, `${method} ${route}: ${JSON.stringify(result)}`);
    return result.data;
  };

  const setupLease = await req("POST", `/internal/assessment-runtime/${assessmentId}/claim`, { body: {}, worker: true });
  const setupLeaseToken = setupLease.leaseToken;

  const pkgLines = readFileSync(path.join(repoDir, "package.json"), "utf8").split("\n").slice(0, 6).join("\n");
  const pkgSha256 = "sha256:" + createHash("sha256").update(pkgLines).digest("hex");
  const evData = await req("POST", `/internal/assessment-runtime/${assessmentId}/evidence`, {
    worker: true,
    lease: setupLeaseToken,
    body: {
      type: "REPOSITORY_SOURCE",
      repositoryCommit: commitSha,
      path: "package.json",
      startLine: 1,
      endLine: 6,
      excerptSha256: pkgSha256,
    },
  });
  const baselineEvidenceId = evData.evidenceId;

  // Accept system use case fact upfront to advance caseRevision to 1
  await req("POST", `/internal/assessment-runtime/${assessmentId}/facts`, {
    worker: true,
    lease: setupLeaseToken,
    body: {
      expectedCaseRevision: 0,
      kind: "USE_CASE",
      statement: "The assessed system is an Enterprise Cyberspace & Data Management System providing digital account registration verification, system audit logging, personal data processing activity logging, and technical encryption measures for data processing.",
      evidenceIds: [baselineEvidenceId],
    },
  });

  const consumed = await req("GET", `/internal/assessment-runtime/${assessmentId}/rule-set`, {
    worker: true,
    lease: setupLeaseToken,
  });

  for (const rule of consumed.assessmentRules) {
    if (representativeRules.includes(rule.assessmentRuleId)) {
      continue; // Keep strictly PENDING for autonomous AI investigation
    }
    const applicabilityBasis = [];
    for (const reqId of rule.legalRequirementIds) {
      const reqItem = consumed.legalRequirements.find((r) => r.legalRequirementId === reqId);
      if (reqItem?.applicabilityConditions?.length) {
        for (let i = 0; i < reqItem.applicabilityConditions.length; i++) {
          applicabilityBasis.push({
            legalRequirementId: reqId,
            kind: "APPLICABILITY_CONDITION",
            index: i,
            finding: "ESTABLISHED",
            rationale: `Applicability condition [${i}] established from package manifest inspection.`,
            references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId: baselineEvidenceId }],
          });
        }
      }
    }
    await req("POST", `/internal/assessment-runtime/${assessmentId}/decisions`, {
      worker: true,
      lease: setupLeaseToken,
      body: {
        expectedDecisionRevision: 0,
        idempotencyKey: randomUUID(),
        decision: {
          assessmentRuleId: rule.assessmentRuleId,
          assessmentRuleVersion: rule.assessmentRuleVersion,
          scopeId: "ASSESSMENT",
          ruleSetVersionId,
          repositorySnapshotId: snapshotId,
          repositoryCommit: commitSha,
          caseRevision: 1,
          legalContextRefs: rule.legalRequirementIds.map((id) => ({ legalContextId: id })),
          applicability: "APPLICABLE",
          rationale: `Baseline verified for non-representative rule ${rule.assessmentRuleId}.`,
          applicabilityBasis: applicabilityBasis.length > 0 ? applicabilityBasis : undefined,
          references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId: baselineEvidenceId }],
          criteria: rule.criteria.map((c) => ({
            criterionId: c.criterionId,
            outcome: "MET",
            rationale: `Baseline verified: ${rule.assessmentRuleId}`,
            references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId: baselineEvidenceId }],
          })),
          compliance: "COMPLIANT",
        },
      },
    });
  }

  // Release setup lease so the real investigator worker can claim cleanly
  await stack.q(
    `UPDATE "AssessmentRuntime"
     SET "leaseToken" = NULL, "leaseExpiresAt" = NULL, "executionState" = 'QUEUED'
     WHERE "assessmentId" = $1`,
    [assessmentId]
  );

  const pendingRows = (
    await stack.q(
      'SELECT "assessmentRuleId", "resolutionState" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'PENDING\' ORDER BY "assessmentRuleId"',
      [assessmentId]
    )
  ).rows;
  console.log(`Targeted evaluation scope: exactly ${pendingRows.length} representative rules in PENDING:`, pendingRows.map((r) => r.assessmentRuleId));
  assert.equal(pendingRows.length, representativeRules.length);
  assert.deepEqual(pendingRows.map((r) => r.assessmentRuleId).sort(), [...representativeRules].sort());

  // 6. Run the genuine Assessment Root Deep Agent (using real model reasoning)
  const scriptPath = path.join(root, "deepagents/tests/vertical/direct_investigator_root.py");
  const traceFile = path.join(evidence, "investigator-trace.json");
  console.log("Invoking Assessment Root Deep Agent with production model route...");

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
          LCSP_ASSESSMENT_MAX_INPUT_TOKENS: "10000000",
          LCSP_ASSESSMENT_MAX_SECONDS: "900",
          LCSP_ASSESSMENT_MAX_CALLS: "120",
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

  console.log("Assessment Root Deep Agent execution completed:", JSON.stringify(pyResult, null, 2));
  assert.ok(pyResult.calls > 0, "Investigator must have made real model calls");

  // 7. Inspect Evidence and Decisions recorded by the AI agent
  const evidenceRows = (
    await stack.q(
      'SELECT "evidenceId", payload, "contentSha256", "repositoryCommit" FROM "AssessmentEvidence" WHERE "assessmentId"=$1',
      [assessmentId]
    )
  ).rows;
  console.log(`AI Recorded ${evidenceRows.length} Evidence entries:`);
  for (const ev of evidenceRows) {
    console.log(`- Evidence ${ev.evidenceId}: path=${ev.payload?.path}:${ev.payload?.startLine}-${ev.payload?.endLine}, sha256=${ev.contentSha256}`);
    assert.equal(ev.repositoryCommit, commitSha, "Evidence must match committed git SHA");
    if (ev.payload?.path) {
      const committedContent = execFileSync("git", ["show", `${commitSha}:${ev.payload.path}`], { cwd: repoDir, encoding: "utf8" });
      const committedLines = committedContent.replace(/\r?\n$/, "").split(/\r?\n/).slice(ev.payload.startLine - 1, ev.payload.endLine);
      const expectedSha = "sha256:" + createHash("sha256").update(committedLines.join("\n")).digest("hex");
      assert.equal(ev.contentSha256, expectedSha, "Cryptographic evidence hash must match committed Git tree");
    }
  }

  const decisions = (
    await stack.q(
      'SELECT "decisionId", "assessmentRuleId", "state", "decisionRevision", "applicability", "compliance", "decision"->>\'rationale\' AS rationale FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"',
      [assessmentId]
    )
  ).rows;
  const repDecisions = decisions.filter((d) => representativeRules.includes(d.assessmentRuleId));
  console.log(`AI Recorded ${repDecisions.length} Representative Decisions (out of ${decisions.length} total active rule set decisions):`);
  for (const dec of repDecisions) {
    console.log(`- Rule ${dec.assessmentRuleId}: state=${dec.state}, applicability=${dec.applicability}, compliance=${dec.compliance}`);
    console.log(`  Rationale: ${dec.rationale?.slice(0, 150)}...`);
    assert.equal(dec.state, "ACCEPTED");
    assert.equal(dec.compliance, "COMPLIANT");
  }
  assert.equal(repDecisions.length, representativeRules.length);

  // 8. Coverage Verification
  const resolvedCoverage = (
    await stack.q(
      'SELECT "assessmentRuleId", "resolutionState", "decisionRevision" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 ORDER BY "assessmentRuleId"',
      [assessmentId]
    )
  ).rows;
  console.log(`Representative Coverage Resolution:`);
  for (const row of resolvedCoverage) {
    console.log(`- Rule ${row.assessmentRuleId}: ${row.resolutionState} (decision revision: ${row.decisionRevision})`);
  }

  const pendingCount = (
    await stack.q(
      'SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'PENDING\'',
      [assessmentId]
    )
  ).rows[0].count;
  assert.equal(pendingCount, 0, "All targeted representative rules must be resolved");

  const assState = (
    await stack.q(
      'SELECT "lifecycleState" FROM "Assessment" WHERE id=$1',
      [assessmentId]
    )
  ).rows[0].lifecycleState;
  assert.equal(assState, "COMPLETE", "Assessment must reach COMPLETE lifecycleState");

  const summary = {
    result: "PASSED",
    activeRuleSetVersionId: ruleSetVersionId,
    totalRuleSetRules: Number(counts.rules),
    representativeRulesInvestigated: representativeRules.length,
    representativeRules: representativeRules,
    evidenceCount: evidenceRows.length,
    decisionsCount: decisions.length,
    pendingCoverageCount: pendingCount,
    model: pyResult.model,
    calls: pyResult.calls,
    inputTokens: pyResult.inputTokens,
    outputTokens: pyResult.outputTokens,
    seconds: pyResult.seconds,
  };
  writeFileSync(path.join(evidence, "representative-investigator-result.json"), JSON.stringify(summary, null, 2));
  console.log("REPRESENTATIVE ASSESSMENT INVESTIGATION PASSED:\n", JSON.stringify(summary, null, 2));
} finally {
  await stack.stop();
}
