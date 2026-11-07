import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalRuleIdentities, PINS, requestFullRuleAudit } from "./t31_scoped_pilot_bootstrap.mjs";

function fixture({ mutatePage, mutateRequest } = {}) {
  const runtime = { assessmentId: randomUUID(), repositorySnapshotId: randomUUID() };
  const rules = Array.from({ length: 243 }, (_, index) => ({
    assessmentRuleId: "rule-" + String(index).padStart(3, "0"), assessmentRuleVersion: "v1",
  }));
  const auditId = randomUUID(), calls = [];
  const pins = {
    assessmentId: runtime.assessmentId, ruleSetVersionId: PINS.ruleSetVersionId,
    ruleSetDigest: PINS.ruleSetDigest, repositorySnapshotId: runtime.repositorySnapshotId,
    repositoryCommit: PINS.repositoryCommit,
  };
  const call = async (route, body, method) => {
    calls.push({ route, body, method });
    if (method === "GET") {
      const offset = Number(new URL(route, "http://fixture.invalid").searchParams.get("offset"));
      const slice = rules.slice(offset, offset + 100);
      const page = {
        ...pins, auditMode: "CUSTOMER_SELECTED", auditRevision: 0,
        latestRequestId: null, latestRequestStatus: null,
        total: 243, offset, nextOffset: offset + slice.length < 243 ? offset + slice.length : null,
        rules: slice.map((row) => ({ ...row, progress: "NOT_SELECTED", decisionId: null })),
      };
      mutatePage?.(page, offset);
      return page;
    }
    assert.equal(method, "POST");
    const response = {
      ...pins, requestId: auditId, scopeMode: "FULL_RULE_SET", status: "QUEUED", requestRevision: 1,
      requested: 243, totalPinned: 243, ready: 0, notRequested: 0,
      rules: rules.map((row, ordinal) => ({ ...row, ordinal, progress: "QUEUED", decisionId: null })),
    };
    mutateRequest?.(response);
    return response;
  };
  return { runtime, rules, call, calls, auditId };
}

test("explicit full243 audit follows all pages and freezes exact membership", async () => {
  const value = fixture();
  await requestFullRuleAudit(value.runtime, value.call, value.rules);
  assert.deepEqual(value.calls.filter((call) => call.method === "GET")
    .map((call) => Number(new URL(call.route, "http://fixture.invalid").searchParams.get("offset"))), [0, 100, 200]);
  const submitted = value.calls.at(-1).body;
  assert.equal(submitted.scopeMode, "FULL_RULE_SET");
  assert.deepEqual(submitted.rules, []);
  assert.equal(submitted.expectedAuditRevision, 0);
  assert.equal(value.runtime.auditRequestId, value.auditId);
  assert.equal(value.runtime.rootCommandKey, "rule-audit:" + value.auditId + ":start");
  assert.equal(value.runtime.auditMembershipSha256, createHash("sha256")
    .update(JSON.stringify(canonicalRuleIdentities(value.rules))).digest("hex"));
  assert.equal(value.runtime.auditRules.length, 243);
});

for (const [label, mutatePage] of [
  ["baseline drift", (page, offset) => { if (offset) page.ruleSetDigest = "changed"; }],
  ["snapshot drift", (page) => { page.repositorySnapshotId = randomUUID(); }],
  ["revision drift", (page, offset) => { if (offset) page.auditRevision = 1; }],
  ["prior request", (page) => { page.latestRequestId = randomUUID(); }],
  ["prior decision", (page) => { page.rules[0].decisionId = randomUUID(); }],
  ["already selected", (page) => { page.rules[0].progress = "QUEUED"; }],
  ["empty page", (page) => { page.rules = []; }],
  ["truncated catalog", (page) => { page.nextOffset = null; }],
  ["nonprogressing offset", (page) => { page.nextOffset = page.offset; }],
  ["wrong page offset", (page) => { page.offset += 1; }],
  ["duplicate member", (page, offset) => { if (offset) page.rules[0].assessmentRuleId = "rule-000"; }],
  ["changed version", (page) => { page.rules[0].assessmentRuleVersion = "v2"; }],
  ["expanded catalog", (page) => { page.total = 244; }],
]) {
  test("rejects " + label + " before submitting customer intent", async () => {
    const value = fixture({ mutatePage });
    await assert.rejects(requestFullRuleAudit(value.runtime, value.call, value.rules));
    assert.equal(value.calls.filter((call) => call.method === "POST").length, 0);
    assert.equal(value.runtime.auditRequestId, undefined);
  });
}

for (const [label, mutateRequest] of [
  ["partial audit", (response) => { response.requested = 242; }],
  ["changed membership", (response) => { response.rules[0].assessmentRuleId = "different"; }],
  ["selected scope", (response) => { response.scopeMode = "SELECTED_RULES"; }],
  ["completed audit", (response) => { response.status = "COMPLETED"; }],
  ["reused decision", (response) => { response.rules[0].decisionId = randomUUID(); }],
  ["wrong revision", (response) => { response.requestRevision = 2; }],
]) {
  test("refuses to advertise a prepared pilot after " + label, async () => {
    const value = fixture({ mutateRequest });
    await assert.rejects(requestFullRuleAudit(value.runtime, value.call, value.rules));
    assert.equal(value.calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(value.runtime.auditRequestId, undefined);
  });
}
