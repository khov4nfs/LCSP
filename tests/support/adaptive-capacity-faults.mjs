import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rootCapacityPolicySchema } from "@lcsp/contracts/assessment-domain";
import {
  apiDir,
  root,
  runPython,
  workerKey,
  hashSecret,
} from "./compliance-rule-set-stack.mjs";

// Real processes, HTTP, PostgreSQL, RabbitMQ and native Root. Only the model and
// repository are explicitly synthetic; the model adapter's HTTP call outlives a killed server.
export async function runAdaptiveCapacityFaults({
  stack,
  createAssessment,
  owner,
  otherOwner,
  repoDir,
}) {
  const requireApi = createRequire(`${apiDir}/package.json`);
  const { PrismaClient } = requireApi("@prisma/client");
  const { PrismaPg } = requireApi("@prisma/adapter-pg");
  const { AssessmentRootCapacityService } = await import(
    `${apiDir}/dist/src/modules/assessment/application/services/assessment-root-capacity.service.js`
  );
  const client = new PrismaClient({ adapter: new PrismaPg(stack.databaseUrl) });
  const service = new AssessmentRootCapacityService(client);
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp364-active-faults-"));
  const altPort = 3431,
    routerPort = 3430;
  const routeFile = path.join(dir, "route.json");
  writeFileSync(
    routeFile,
    JSON.stringify({ port: Number(new URL(stack.base).port) }),
  );
  const logs = [];
  const replica = spawn("node", ["dist/src/main.js"], {
    cwd: apiDir,
    env: { ...stack.apiEnv, PORT: String(altPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  replica.stdout.on("data", (d) => logs.push(String(d)));
  replica.stderr.on("data", (d) => logs.push(String(d)));
  const router = createServer((incoming, outgoing) => {
    const url = incoming.url.split("?")[0];
    if (
      url.endsWith("/report") &&
      existsSync(path.join(dir, "hold-capacity-reports"))
    ) {
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ injected: "capacity report unavailable" }));
      return;
    }
    const fault = path.join(dir, "fail-quiesce-once");
    if (url.endsWith("/quiesce") && existsSync(fault)) {
      // One lost receipt: fail before forwarding, never fabricate an API success.
      unlinkSync(fault);
      appendFileSync(
        path.join(dir, "proxy.jsonl"),
        JSON.stringify({ at: Date.now(), path: url, injectedStatus: 503 }) +
          "\n",
      );
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end(
        JSON.stringify({ injected: "quiescence receipt unavailable" }),
      );
      return;
    }
    const { port } = JSON.parse(readFileSync(routeFile, "utf8"));
    assert.ok([Number(new URL(stack.base).port), altPort].includes(port));
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (reply) => {
        outgoing.writeHead(reply.statusCode, reply.headers);
        reply.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(503);
      outgoing.end();
    });
    incoming.pipe(upstream); // Never retry a mutation in the fixture router.
  });
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${altPort}/health`)).ok) break;
      } catch {
        /* wait for the owned replica */
      }
      assert.ok(i < 45, logs.join("").slice(-2000));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) =>
      router.listen(routerPort, "127.0.0.1", resolve),
    );
    const status = await service.status();
    await service.control(
      {
        expectedVersion: status.version,
        reason:
          "Provider-free owned-process active-failure fixture; no paid provider",
        policy: rootCapacityPolicySchema.parse({
          enabled: false,
          initial: 2,
          maximum: 2,
          evaluationSeconds: 5,
          scaleUpCooldownSeconds: 5,
          scaleDownCooldownSeconds: 5,
          hysteresisSamples: 1,
          diskHeadroomBytes: 1024 ** 3,
          rootMemoryReserveBytes: 512 * 1024 ** 2,
          providerConcurrentLimit: 2,
          providerRpmLimit: 1000000,
          providerTpmLimit: 1000000000,
        }),
      },
      "lcsp364-active-fault-fixture",
    );
    const jobs = [];
    const adminId = randomUUID(),
      email = `lcsp364-fault-${adminId}@acceptance.invalid`,
      password = "FixtureOnly-Admin-Password!";
    await stack.q(
      'INSERT INTO "User" (id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,\'ADMIN\',now())',
      [adminId, email, hashSecret(password)],
    );
    const signIn = await fetch(`${stack.base}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, organization_id: "org-1" }),
    });
    assert.equal(signIn.status, 200);
    const adminToken = (await signIn.json()).data.session_token;
    for (const [i, label] of [
      "active",
      "short",
      "queued",
      "crash",
      "after-crash",
    ].entries()) {
      const actor = i % 2 ? otherOwner : owner;
      const assessment = await createAssessment(
        `LCSP-364 ACTIVE FAULT synthetic ${label}`,
        actor,
      );
      await stack.q(
        `UPDATE "AssessmentCase" SET "auditMode"='LEGACY_FULL' WHERE "assessmentId"=$1`,
        [assessment.id],
      );
      const response = await fetch(
        `${stack.base}/assessments/${assessment.id}/repository-setup/complete`,
        { method: "POST", headers: { authorization: `Bearer ${actor.token}` } },
      );
      assert.equal(response.status, 201, await response.text());
      const command = (
        await stack.q(
          'SELECT id,payload FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"=\'command.assessment.root.requested.v1\' ORDER BY "createdAt" DESC LIMIT 1',
          [assessment.id],
        )
      ).rows[0];
      jobs.push({
        label,
        assessmentId: assessment.id,
        commandId: command.id,
        message: command.payload,
      });
    }
    const output = path.join(
      root,
      "reports/lcsp364-adaptive-capacity/final-active-faults.json",
    );
    const input = path.join(dir, "input.json");
    writeFileSync(
      input,
      JSON.stringify({
        base: `http://127.0.0.1:${routerPort}`,
        apiPids: [stack.server.pid, replica.pid],
        apiPorts: [Number(new URL(stack.base).port), altPort],
        databaseUrl: stack.databaseUrl,
        checkpointDatabaseUrl: stack.checkpointDatabaseUrl,
        repoDir,
        jobs,
        dir,
        output,
        adminToken,
        adminId,
      }),
      { mode: 0o600 },
    );
    await runPython(
      path.join(root, "deepagents/tests/vertical/adaptive_capacity_faults.py"),
      [input],
      { timeoutMs: 300000, env: { WORKER_API_KEY: workerKey } },
    );
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(evidence.status, "PASS");
    assert.equal(evidence.paidProviderCalls, 0);
    assert.equal((await service.status()).active, 0);
    console.log(
      JSON.stringify({
        scope: evidence.scope,
        status: evidence.status,
        scenarios: evidence.scenarios,
      }),
    );
  } finally {
    writeFileSync(path.join(dir, "api-replica.log"), logs.join(""), {
      mode: 0o600,
    });
    if (replica.exitCode === null && replica.signalCode === null)
      replica.kill("SIGTERM");
    router.closeAllConnections();
    await new Promise((resolve) => router.close(resolve));
    await client.$disconnect();
    // Keep only this owned fixture's private process logs on failure; no production credentials.
    console.log(`LCSP364_ACTIVE_FAULT_PRIVATE_DIR=${dir}`);
  }
}
