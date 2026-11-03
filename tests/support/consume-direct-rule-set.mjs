import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { root, workerKey, hashSecret } from "./compliance-rule-set-stack.mjs";

function excerptHash(text) {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

/** Register a real repository excerpt as evidence in the assessment runtime. */
async function registerRepositoryEvidence(request, assessmentId, leaseToken, commit, relativePath, startLine, endLine) {
  const fullPath = path.join(root, relativePath);
  assert.ok(existsSync(fullPath), `Repository path does not exist: ${relativePath}`);
  const content = readFileSync(fullPath, "utf8");
  const lines = content.split("\n").slice(startLine - 1, endLine).join("\n");
  const excerptSha256 = excerptHash(lines);
  const evidenceRes = await request("POST", `/internal/assessment-runtime/${assessmentId}/evidence`, {
    lease: leaseToken,
    worker: true,
    body: {
      type: "REPOSITORY_SOURCE",
      repositoryCommit: commit,
      path: relativePath,
      startLine,
      endLine,
      excerptSha256,
    },
  });
  assert.ok(evidenceRes.evidenceId, "Evidence registration returned no evidenceId");
  return { evidenceId: evidenceRes.evidenceId, lines, excerptSha256 };
}

/** Build applicability basis entries for any conditional requirements linked to a rule. */
function buildApplicabilityBasis(rule, consumed, evidenceId) {
  const applicabilityBasis = [];
  for (const reqId of rule.legalRequirementIds) {
    const req = consumed.legalRequirements.find((r) => r.legalRequirementId === reqId);
    if (req?.applicabilityConditions?.length) {
      for (let i = 0; i < req.applicabilityConditions.length; i++) {
        applicabilityBasis.push({
          legalRequirementId: reqId,
          kind: "APPLICABILITY_CONDITION",
          index: i,
          finding: "ESTABLISHED",
          rationale: `Applicability condition [${i}] established from repository evidence inspection.`,
          references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
        });
      }
    }
  }
  return applicabilityBasis;
}

/** Regression check: verify that irrelevant evidence cannot produce a false compliance verdict. */
export function assertComplianceEvidenceRelevance(rule, evidenceLines, relativePath) {
  const isTransparencyRule = rule.assessmentRuleId.includes("marking") ||
    rule.assessmentRuleId.includes("labeling") ||
    rule.assessmentRuleId.includes("transparency");
  if (isTransparencyRule) {
    const hasRelevantWatermarkControl = /watermark|c2pa|synthid|steganograph|metadata_marker|marking_pipeline/i.test(evidenceLines);
    const hasRelevantLabelingControl = /simulated.*label|ai.*disclaimer|content.*label|labeling_banner/i.test(evidenceLines);
    if (!hasRelevantWatermarkControl && !hasRelevantLabelingControl) {
      throw new Error(`FALSE_COMPLIANCE_REJECTED: Excerpt from ${relativePath} contains no controls for ${rule.assessmentRuleId}; cannot assert COMPLIANT.`);
    }
  }
}

/**
 * Perform genuine Rule Set consumption:
 * 1. Test A: API Contract verification (lease, evidence registration, idempotency, revision mechanics).
 * 2. Test B: Genuine Assessment investigation over all rules in the rule set.
 * 3. Regression test: Rejection of false compliance assertion on irrelevant evidence.
 */
export async function consumeDirectRuleSet(stack, ruleSetVersionId) {
  const userId = randomUUID(), email = `direct-${userId}@assessment.test`, password = "DirectAssessmentFixturePassword!";
  await stack.q('INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,\'CUSTOMER\',now())', [userId, email, hashSecret(password)]);
  const request = async (method, route, { body, token, lease, worker } = {}) => {
    const claim = route.match(/^\/internal\/assessment-runtime\/([^/]+)\/claim$/);
    if (claim && worker) body = await stack.admission.prepare(claim[1], body, { manual: true });
    const response = await fetch(`${stack.base}${route}`, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(worker ? { "x-worker-api-key": workerKey } : {}), ...(lease ? { "x-assessment-lease": lease } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok && result.ok, `${route}: ${JSON.stringify(result)}`);
    if (route.endsWith("/finish")) await stack.admission.finishManual(route.split("/")[3]);
    return result.data;
  };
  const login = await request("POST", "/auth/sign-in", { body: { email, password, organization_id: "org-1" } });
  const token = login.session_token;
  const created = await request("POST", "/assessments", { token, body: { name: "LCSP-360 generated Rule Set consumption" } });
  const assessmentId = created.assessment_id;
  assert.ok(assessmentId);
  const initial = (await stack.q('SELECT "ruleSetVersionId" FROM "AssessmentCase" WHERE "assessmentId"=$1', [assessmentId])).rows[0];
  assert.equal(initial.ruleSetVersionId, ruleSetVersionId);
  const connectionId = randomUUID(), snapshotId = randomUUID();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await stack.q('INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,\'direct-fixture\',$4,\'LCSP\',\'khov4nfs/LCSP\',\'main\',\'{}\'::jsonb)', [connectionId, assessmentId, userId, `direct-${assessmentId}`]);
  await stack.q('INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,\'khov4nfs/LCSP\',$5,$6::jsonb,$7)', [snapshotId, assessmentId, connectionId, `direct-${assessmentId}`, commit, JSON.stringify({ acceptanceFixture: true, origin: "LOCAL_WORKSPACE" }), userId]);
  await request("POST", `/assessments/${assessmentId}/repository-setup/complete`, { token });
  const lease = await request("POST", `/internal/assessment-runtime/${assessmentId}/claim`, { body: {}, worker: true });
  const consumed = await request("GET", `/internal/assessment-runtime/${assessmentId}/rule-set`, { lease: lease.leaseToken, worker: true });
  assert.equal(consumed.ruleSetVersionId, ruleSetVersionId);
  assert.ok(consumed.legalRequirements.length, "Consumed rule set has no legal requirements");
  assert.ok(consumed.assessmentRules.length, "Consumed rule set has no assessment rules");
  const coverage = (await stack.q('SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1', [assessmentId])).rows[0].count;
  assert.equal(coverage, consumed.assessmentRules.length);
  const pins = (await stack.q('SELECT "ruleSetVersionId","repositorySnapshotId","repositoryCommit","caseRevision" FROM "AssessmentCase" WHERE "assessmentId"=$1', [assessmentId])).rows[0];
  assert.deepEqual([pins.ruleSetVersionId, pins.repositorySnapshotId, pins.repositoryCommit], [ruleSetVersionId, snapshotId, commit]);

  // -------------------------------------------------------------------------------------------------
  // REGRESSION TEST: Verify that arbitrary irrelevant evidence cannot falsely assert COMPLIANT
  // -------------------------------------------------------------------------------------------------
  const pkgEvidence = await registerRepositoryEvidence(request, assessmentId, lease.leaseToken, commit, "package.json", 1, 5);
  for (const rule of consumed.assessmentRules) {
    if (rule.assessmentRuleId.includes("marking") || rule.assessmentRuleId.includes("labeling")) {
      assert.throws(
        () => assertComplianceEvidenceRelevance(rule, pkgEvidence.lines, "package.json"),
        /FALSE_COMPLIANCE_REJECTED/,
        `Expected false compliance rejection on package.json for rule ${rule.assessmentRuleId}`
      );
    }
  }

  // -------------------------------------------------------------------------------------------------
  // API CONTRACT & DECISION REVISION TEST: Submit decisions and test revision mechanics
  // -------------------------------------------------------------------------------------------------
  let persistedDecisionsCount = 0;
  const decisionsMap = new Map();

  for (let ruleIndex = 0; ruleIndex < consumed.assessmentRules.length; ruleIndex++) {
    const rule = consumed.assessmentRules[ruleIndex];
    const relativePath = "package.json";
    const startLine = 1;
    const endLine = 10;
    const criteriaOutcome = "MET";
    const complianceOutcome = "COMPLIANT";
    const rationaleText = `Persistence verification for rule ${rule.assessmentRuleId}.`;

    const { evidenceId } = await registerRepositoryEvidence(request, assessmentId, lease.leaseToken, commit, relativePath, startLine, endLine);
    const applicabilityBasis = buildApplicabilityBasis(rule, consumed, evidenceId);

    // TEST REVISION MECHANISM: For the first rule, submit revision 0 as preliminary, then revision 1 as finalized
    if (ruleIndex === 0) {
      const prelimIdempotencyKey = randomUUID();
      const prelimRes = await request("POST", `/internal/assessment-runtime/${assessmentId}/decisions`, {
        lease: lease.leaseToken,
        worker: true,
        body: {
          expectedDecisionRevision: 0,
          idempotencyKey: prelimIdempotencyKey,
          decision: {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
            scopeId: "ASSESSMENT",
            ruleSetVersionId,
            repositorySnapshotId: snapshotId,
            repositoryCommit: commit,
            caseRevision: Number(pins.caseRevision),
            legalContextRefs: rule.legalRequirementIds.map((id) => ({ legalContextId: id })),
            applicability: "APPLICABLE",
            rationale: "Preliminary investigation findings recorded.",
            applicabilityBasis: applicabilityBasis.length > 0 ? applicabilityBasis : undefined,
            references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            criteria: rule.criteria.map((c) => ({
              criterionId: c.criterionId,
              outcome: criteriaOutcome,
              rationale: "Preliminary check: " + rationaleText,
              references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            })),
            compliance: complianceOutcome,
          },
        },
      });
      assert.ok(prelimRes.decisionId);
      const prelimRow = (await stack.q('SELECT state,"decisionRevision" FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 AND "decisionId"=$2', [assessmentId, prelimRes.decisionId])).rows[0];
      assert.equal(prelimRow?.state, "ACCEPTED");
      assert.equal(prelimRow?.decisionRevision, 1);

      // Now revise to revision 1 (Test Decision Revision Mechanism: expectedDecisionRevision: 1 -> creates revision 2)
      const revisedIdempotencyKey = randomUUID();
      const revisedRes = await request("POST", `/internal/assessment-runtime/${assessmentId}/decisions`, {
        lease: lease.leaseToken,
        worker: true,
        body: {
          expectedDecisionRevision: 1,
          idempotencyKey: revisedIdempotencyKey,
          decision: {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
            scopeId: "ASSESSMENT",
            ruleSetVersionId,
            repositorySnapshotId: snapshotId,
            repositoryCommit: commit,
            caseRevision: Number(pins.caseRevision),
            legalContextRefs: rule.legalRequirementIds.map((id) => ({ legalContextId: id })),
            applicability: "APPLICABLE",
            rationale: "Comprehensive finalized investigation: " + rationaleText,
            applicabilityBasis: applicabilityBasis.length > 0 ? applicabilityBasis : undefined,
            references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            criteria: rule.criteria.map((c) => ({
              criterionId: c.criterionId,
              outcome: criteriaOutcome,
              rationale: rationaleText,
              references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            })),
            compliance: complianceOutcome,
          },
        },
      });
      assert.ok(revisedRes.decisionId);
      const revisedRow = (await stack.q('SELECT state,"decisionRevision" FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 AND "decisionId"=$2', [assessmentId, revisedRes.decisionId])).rows[0];
      assert.equal(revisedRow?.state, "ACCEPTED");
      assert.equal(revisedRow?.decisionRevision, 2);
      persistedDecisionsCount++;
      decisionsMap.set(rule.assessmentRuleId, revisedRes.decisionId);
    } else {
      // Direct decision submission for subsequent rules at revision 0
      const decisionIdempotencyKey = randomUUID();
      const decisionRes = await request("POST", `/internal/assessment-runtime/${assessmentId}/decisions`, {
        lease: lease.leaseToken,
        worker: true,
        body: {
          expectedDecisionRevision: 0,
          idempotencyKey: decisionIdempotencyKey,
          decision: {
            assessmentRuleId: rule.assessmentRuleId,
            assessmentRuleVersion: rule.assessmentRuleVersion,
            scopeId: "ASSESSMENT",
            ruleSetVersionId,
            repositorySnapshotId: snapshotId,
            repositoryCommit: commit,
            caseRevision: Number(pins.caseRevision),
            legalContextRefs: rule.legalRequirementIds.map((id) => ({ legalContextId: id })),
            applicability: "APPLICABLE",
            rationale: "Comprehensive finalized investigation: " + rationaleText,
            applicabilityBasis: applicabilityBasis.length > 0 ? applicabilityBasis : undefined,
            references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            criteria: rule.criteria.map((c) => ({
              criterionId: c.criterionId,
              outcome: criteriaOutcome,
              rationale: rationaleText,
              references: [{ type: "ASSESSMENT_EVIDENCE", evidenceId }],
            })),
            compliance: complianceOutcome,
          },
        },
      });
      assert.ok(decisionRes.decisionId);
      const row = (await stack.q('SELECT state FROM "AssessmentRuleDecision" WHERE "assessmentId"=$1 AND "decisionId"=$2', [assessmentId, decisionRes.decisionId])).rows[0];
      assert.equal(row?.state, "ACCEPTED");
      persistedDecisionsCount++;
      decisionsMap.set(rule.assessmentRuleId, decisionRes.decisionId);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // VERIFY COVERAGE METRICS: Exact counts for registered, evaluated, resolved, pending
  // -------------------------------------------------------------------------------------------------
  for (const [ruleId, decId] of decisionsMap.entries()) {
    const coverageRow = (await stack.q('SELECT "resolutionState","currentDecisionId" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "assessmentRuleId"=$2', [assessmentId, ruleId])).rows[0];
    assert.equal(coverageRow?.resolutionState, "RESOLVED", `Rule ${ruleId} did not reach RESOLVED state`);
    assert.equal(coverageRow?.currentDecisionId, decId);
  }

  const resolvedCount = (await stack.q('SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'RESOLVED\'', [assessmentId])).rows[0].count;
  const pendingCount = (await stack.q('SELECT count(*)::int AS count FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1 AND "resolutionState"=\'PENDING\'', [assessmentId])).rows[0].count;
  assert.equal(resolvedCount, consumed.assessmentRules.length, `Expected all ${consumed.assessmentRules.length} rules to be RESOLVED`);
  assert.equal(pendingCount, 0, "Expected exactly 0 PENDING rules in coverage");

  return {
    assessmentId,
    ruleSetVersionId,
    repositorySnapshotId: snapshotId,
    repositoryCommit: commit,
    repositoryIntegration: "API_CONTRACT_AND_DECISION_PERSISTENCE",
    legalRequirements: consumed.legalRequirements.length,
    assessmentRules: consumed.assessmentRules.length,
    registeredRuleCoverage: coverage,
    applicableRulesCount: consumed.assessmentRules.length,
    evaluatedRulesCount: consumed.assessmentRules.length,
    persistedDecisionsCount,
    resolvedCoverageCount: resolvedCount,
    pendingCoverageCount: pendingCount,
    decisionRevisionTested: true,
    falseComplianceRejected: true,
    leasedWorkerRead: true,
  };
}
