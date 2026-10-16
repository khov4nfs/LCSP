// Provider-free HTTP acceptance on an isolated migrated DB and the real built API.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startStack, apiDir } from "./support/compliance-rule-set-stack.mjs";
import {
  validPacket,
  legalSourceFactory,
} from "../apps/api/test/support/compliance-rule-set-fixtures.ts";
import {
  RULE_SET_REACTIVATION_REASONS,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
} from "@lcsp/contracts/compliance-rule-set";
const require = createRequire(path.join(apiDir, "package.json"));
const { hashSecret } = await import(pathToFileURL(require.resolve("@lcsp/api/security")).href);
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const stack = await startStack({
  database: "lcsp_reactivation_http",
  apiPort: 3398,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(stack.databaseUrl) });
const password = randomUUID() + "Aa1!";
const tokens = [];
const call = async (route, body, token) => {
  const response = await fetch(stack.base + route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
try {
  const users = [];
  for (const role of ["ADMIN", "CUSTOMER"]) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: randomUUID() + "@test.invalid",
        passwordHash: hashSecret(password),
        emailVerified: true,
        failedLoginCount: 0,
        role,
      },
    });
    const signed = await call("/auth/sign-in", { email: user.email, password });
    assert.equal(signed.status, 200);
    const token = signed.body.data?.session_token ?? signed.body.session_token;
    assert(token);
    tokens.push(token);
    users.push(user);
  }
  const source = await legalSourceFactory(prisma, randomUUID())();
  const publish = async () => {
    const id = randomUUID();
    // Fixture run, claimed/submitted through the real worker API; no Agent or model is started.
    await stack.q(
      `INSERT INTO "RuleSetPreparationRun"(id,"idempotencyKey","legalSourceVersionId","requestedBy","correlationId") VALUES ($1,$1,$2,'test-worker',$3)`,
      [id, source.id, randomUUID()],
    );
    assert.equal(
      (await stack.post("claims", { preparationRunId: id })).status,
      200,
    );
    const submitted = await stack.post("submissions", {
      preparationRunId: id,
      idempotencyKey: randomUUID(),
      packet: validPacket(),
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.lifecycleState, "ACTIVE");
    return submitted.body.data.ruleSetVersionId;
  };
  const trusted = await publish();
  const rejected = await publish();
  const original = await prisma.complianceRuleSetActivationRecord.findMany({
    orderBy: { id: "asc" },
  });
  const request = {
    expectedActiveRuleSetVersionId: rejected,
    idempotencyKey: randomUUID(),
    reason: RULE_SET_REACTIVATION_REASONS.SEMANTIC_AUTHORITY_CONTAINMENT,
  };
  const route = `/admin/compliance-rule-sets/${trusted}/reactivate`;
  assert.equal((await call(route, request)).status, 401);
  assert.equal((await call(route, request, tokens[1])).status, 403);
  assert.equal((await call(route, request, "invalid-token")).status, 401);
  const first = await call(route, request, tokens[0]);
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  const result = first.body.data;
  assert.equal(result.ruleSetVersionId, trusted);
  assert.equal(result.replayed, false);
  const replay = await call(route, request, tokens[0]);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.transitionId, result.transitionId);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(await prisma.complianceRuleSetReactivationRecord.count(), 1);
  assert.deepEqual(
    await prisma.complianceRuleSetActivationRecord.findMany({
      orderBy: { id: "asc" },
    }),
    original,
  );
  assert.equal(
    await prisma.auditEvent.count({
      where: { eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetReactivated },
    }),
    1,
  );
  assert.equal(
    await prisma.outboxMessage.count({
      where: { eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetReactivated },
    }),
    1,
  );
  assert.deepEqual(
    await prisma.complianceRuleSetVersion.findMany({
      where: { lifecycleState: "ACTIVE" },
      select: { id: true },
    }),
    [{ id: trusted }],
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      realHttp: true,
      authentication: "Admin allowed; customer/missing/invalid denied",
      transitionId: result.transitionId,
      idempotency: "same receipt; one transition/audit/outbox",
      normalPreparationActivation: "PASS; provider-free fixture",
      providerCalls: 0,
    }),
  );
} finally {
  for (const token of tokens)
    await call("/auth/revoke-session", { session_token: token });
  await prisma.$disconnect();
  await stack.stop();
}
