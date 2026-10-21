// API smoke on the live-eval database: Rule Set visibility, auth/role/tenant gates, and an assessment pinning
// the Rule Set the real model just prepared. Read-mostly; it adds only disposable smoke users/assessments.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
const root = "/home/khovan/Workplaces/LCSP";
const { startStack, workerKey } = await import(path.join(root, "tests/support/compliance-rule-set-stack.mjs"));
const { hashSecret, fingerprintToken } = await import(path.join(root, "apps/api/dist/src/platform/security/crypto.utils.js"));
const runId = process.argv[2] ?? JSON.parse(readFileSync(path.join(root, "reports/lcsp360-final-release-20261021/final-acceptance/live-run/live-eval-synthetic.json"), "utf8")).runId;
const results = {};
const check = (name, ok, detail) => { results[name] = { ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) }; };
const stack = await startStack({ database: "lcsp_compliance_rule_set_live", apiPort: 3415, resetDatabase: false });
const http = async (method, route, { body, token, worker } = {}) => {
  const r = await fetch(`${stack.base}${route}`, { method, headers: { "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(worker ? { "x-worker-api-key": workerKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
try {
  const active = (await stack.q(`SELECT id, version FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"='ACTIVE' AND "preparationRunId"=$1`, [runId])).rows;
  check("one_active_rule_set", active.length === 1, active);
  if (active.length === 1) {
  const versionId = active[0].id;
  const rules = (await stack.q(`SELECT count(*)::int AS n FROM "AssessmentRule" WHERE "ruleSetVersionId"=$1`, [versionId])).rows[0].n;
  // worker reader
  const w = await stack.get("active");
  check("worker_reads_active_rule_set", w.status === 200 && w.body.data.ruleSetVersionId === versionId, { status: w.status });
  check("worker_reader_requires_key", (await stack.get("active", null)).status === 401);
  // admin visibility
  const adminId = randomUUID(), adminToken = `smoke-admin-${randomUUID()}`;
  await stack.q(`INSERT INTO "User"(id,email,"displayName","passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,'Smoke Admin',$3,true,0,'ADMIN',now())`,
    [adminId, `smoke-admin-${adminId}@example.test`, hashSecret("Password123!")]);
  await stack.q(`INSERT INTO "AuthRecord"(id,"userId",type,"lookupKey","secretHash","expiresAt",metadata) VALUES ($1,$2,'SESSION',$3,$4,now()+interval '1 hour',$5)`,
    [randomUUID(), adminId, `SESSION:${fingerprintToken(adminToken)}`, hashSecret(adminToken), JSON.stringify({ tokenFingerprint: fingerprintToken(adminToken), mfaVerifiedAt: null, sensitiveActionVerifiedAt: null })]);
  const list = await http("GET", "/admin/compliance-rule-sets", { token: adminToken });
  check("admin_lists_active_rule_set", list.status === 200 && JSON.stringify(list.body.data).includes(versionId), { status: list.status });
  const detail = await http("GET", `/admin/compliance-rule-sets/${versionId}`, { token: adminToken });
  check("admin_reads_rule_set_detail", detail.status === 200 && JSON.stringify(detail.body.data).includes(versionId), { status: detail.status });
  check("admin_routes_require_session", (await http("GET", "/admin/compliance-rule-sets")).status === 401);
  // customers
  const password = "CorrectHorseBatteryStaple!";
  const customer = async (email, org) => {
    const id = randomUUID();
    await stack.q(`INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'CUSTOMER',now())`, [id, email, hashSecret(password)]);
    const signIn = await http("POST", "/auth/sign-in", { body: { email, password, organization_id: org } });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
    return { id, token: signIn.body.data.session_token };
  };
  const owner = await customer(`smoke-owner-${randomUUID()}@acme.test`, "org-1");
  const other = await customer(`smoke-other-${randomUUID()}@other.test`, "org-2");
  check("customer_cannot_read_admin_rule_sets", [401, 403].includes((await http("GET", "/admin/compliance-rule-sets", { token: owner.token })).status));
  const created = await http("POST", "/assessments", { token: owner.token, body: { name: "LCSP-360 live Rule Set smoke" } });
  check("assessment_created", created.status === 201, { status: created.status });
  const assessmentId = created.body.data.assessment_id ?? created.body.data.id;
  const pinned = (await stack.q(`SELECT "ruleSetVersionId" FROM "AssessmentCase" WHERE "assessmentId"=$1`, [assessmentId])).rows[0];
  check("assessment_pins_live_rule_set", pinned?.ruleSetVersionId === versionId, pinned);
  const connection = randomUUID(), snapshot = randomUUID();
  await stack.q(`INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ($1,$2,$3,'inst-smoke',$4,'repo','acme/repo','main','{}'::jsonb)`,
    [connection, assessmentId, owner.id, `repo-${assessmentId}`]);
  await stack.q(`INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ($1,$2,$3,$4,'acme/repo',$5,'{}'::jsonb,$6)`,
    [snapshot, assessmentId, connection, `repo-${assessmentId}`, "a".repeat(40), owner.id]);
  const setup = await http("POST", `/assessments/${assessmentId}/repository-setup/complete`, { token: owner.token });
  const lifecycle = (await stack.q(`SELECT "lifecycleState" FROM "Assessment" WHERE id=$1`, [assessmentId])).rows[0];
  const coverage = (await stack.q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "resolutionState"='PENDING')::int AS pending FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1`, [assessmentId])).rows[0];
  check("repository_setup_activates_and_covers_every_rule", setup.status === 201 && lifecycle.lifecycleState === "ACTIVE" && coverage.n === rules && coverage.pending === rules,
    { status: setup.status, lifecycle: lifecycle.lifecycleState, coverage, rules });
  const own = await http("GET", `/assessments/${assessmentId}`, { token: owner.token });
  check("owner_reads_assessment", own.status === 200, { status: own.status });
  const foreign = await http("GET", `/assessments/${assessmentId}`, { token: other.token });
  check("other_tenant_cannot_read_assessment", [403, 404].includes(foreign.status), { status: foreign.status });
  const otherList = await http("GET", "/assessments", { token: other.token });
  check("other_tenant_list_excludes_assessment", otherList.status === 200 && !JSON.stringify(otherList.body).includes(assessmentId), { status: otherList.status });
  } else {
    check("downstream_smoke_prerequisite", false, { runId, reason: "Evaluated run has no ACTIVE Rule Set; visibility, auth, isolation and assessment pinning checks are blocked." });
  }
} finally {
  await stack.stop();
}
const allPassed = Object.values(results).every((r) => r.ok);
console.log(JSON.stringify({ allPassed, results }, null, 1));
process.exit(allPassed ? 0 : 1);
