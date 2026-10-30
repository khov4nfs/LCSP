// Explicitly synthetic infrastructure inputs for API/legal contract fixtures.
// These receipts never prove production headroom or real paid Root concurrency.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  rootCapacityPolicySchema,
  ROOT_CAPACITY_METRIC_SOURCES,
  ASSESSMENT_ROOT_COMMAND_TYPES,
} from "@lcsp/contracts/assessment-domain";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";

export function directRootAdmissionFixture({
  q: query,
  base,
  databaseUrl,
  workerKey,
  apiDir,
}) {
  const q = async (sql, values) => (await query(sql, values)).rows;
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.ok(Number(target.port) >= 55432 && Number(target.port) <= 55499);
  assert.ok(target.pathname.startsWith("/lcsp_"));
  const identity = {
    hostId: createHash("sha256")
      .update(`provider-free-fixture:${base}`)
      .digest("hex"),
    incarnationId: randomUUID(),
  };
  const policy = rootCapacityPolicySchema.parse({
    enabled: false,
    maximum: 64,
    initial: 64,
    providerConcurrentLimit: 64,
    providerRpmLimit: 1000000,
    providerTpmLimit: 1000000000,
  });
  let initialized, client;
  let reporting = Promise.resolve();
  const manualRuns = new Map();

  async function call(action, payload) {
    const response = await fetch(
      `${base}/internal/assessment-root-capacity/${action}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-api-key": workerKey,
        },
        body: JSON.stringify({ ...identity, ...payload }),
      },
    );
    const envelope = await response.json();
    assert.equal(response.status, 200, JSON.stringify(envelope));
    assert.equal(envelope.ok, true);
    return envelope.data;
  }

  async function initialize() {
    if (!initialized)
      initialized = (async () => {
        const requireApi = createRequire(`${apiDir}/package.json`);
        const { PrismaClient } = requireApi("@prisma/client");
        const { PrismaPg } = requireApi("@prisma/adapter-pg");
        const { AssessmentRootCapacityService } = await import(
          `${apiDir}/dist/src/modules/assessment/application/services/assessment-root-capacity.service.js`
        );
        client = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
        const service = new AssessmentRootCapacityService(client);
        await call("register", {
          liveRunIds: [],
          expectedVersion: (await service.registration()).version,
        });
        const status = await service.status();
        await service.control(
          {
            expectedVersion: status.version,
            policy,
            reason:
              "Synthetic infrastructure for provider-free legal/API fixtures only",
          },
          "provider-free-contract-fixture",
        );
      })();
    return initialized;
  }

  async function report() {
    const work = reporting.then(async () => {
      const live = await q(
        'SELECT "runId" FROM "AssessmentRootExecutionSlot" WHERE "releasedAt" IS NULL',
      );
      const sampledAt = new Date().toISOString();
      await call("report", {
        liveRunIds: live.map((s) => s.runId),
        metrics: {
          sampledAt,
          source: ROOT_CAPACITY_METRIC_SOURCES.runtime,
          workerSlots: 64,
          serverSlots: 64,
          activeNativeRuns: 0,
          activeNativeRoots: 0,
          reservedRootRuns: live.length,
          draining: false,
          cpuPressure: 0,
          memoryAvailableBytes: 1024 ** 4,
          cgroupMemoryAvailableBytes: 1024 ** 4,
          cgroupMemoryLimitBytes: 2 * 1024 ** 4,
          cgroupCpuLimitCores: 64,
          cgroupObserved: true,
          processRssBytes: 1,
          diskAvailableBytes: 1024 ** 4,
          diskPressure: 0,
          sandboxMemoryBytes: 0,
          largestSandboxMemoryBytes: 0,
          sandboxCpuCores: 0,
          activeSandboxes: 0,
          sandboxSamples: [],
          brokerReady: 0,
          brokerUnacknowledged: 0,
          brokerOtherReady: 0,
          brokerObservedAt: sampledAt,
          brokerSource: ROOT_CAPACITY_METRIC_SOURCES.broker,
          checkpointLatencyMs: 0,
          checkpointFailureRate: 0,
          checkpointObservedAt: sampledAt,
          provider429Count: 0,
          budgetDenialCount: 0,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
    reporting = work.catch(() => {});
    return work;
  }

  async function prepare(assessmentId, body = {}, { manual = false } = {}) {
    await initialize();
    const previousManual = manualRuns.get(assessmentId);
    const [state] = await q(
      `SELECT a."lifecycleState", r."executionState", r."leaseExpiresAt", slot."startedAt" AS "physicalStartedAt"
      FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id
      LEFT JOIN "AssessmentRootExecutionSlot" slot ON slot."runId"=$2::uuid
      WHERE a.id=$1`,
      [assessmentId, previousManual ?? null],
    );
    const runId = body.runtimeRunId ?? randomUUID();
    if (
      !state ||
      ![
        ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        ASSESSMENT_LIFECYCLE_STATES.PAUSED,
        ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
        ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
        ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      ].includes(state.lifecycleState)
    )
      return { ...body, runtimeRunId: runId };
    if (
      previousManual &&
      manualRuns.get(assessmentId) === previousManual &&
      state.physicalStartedAt &&
      (![
        AGENT_EXECUTION_STATES.QUEUED,
        AGENT_EXECUTION_STATES.RUNNING,
      ].includes(state.executionState) ||
        (state.leaseExpiresAt && new Date(state.leaseExpiresAt) <= new Date()))
    ) {
      await call("quiesce", { runId: previousManual });
      if (manualRuns.get(assessmentId) === previousManual)
        manualRuns.delete(assessmentId);
    }
    let [command] = await q(
      `SELECT o.id, o.payload, d."completedAt" FROM "OutboxMessage" o
      LEFT JOIN "AssessmentRootAdmissionRequest" d ON d."commandId"=o.id
      WHERE o."aggregateId"=$1 AND o."eventType"=$2 ORDER BY o."createdAt" DESC, o.id DESC LIMIT 1`,
      [assessmentId, ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED],
    );
    if (
      command?.completedAt &&
      state.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE
    ) {
      // A direct fixture retry supplies the new canonical command that the real
      // broker-facing customer retry/Continue path would have supplied.
      const id = `fixture-root-retry:${randomUUID()}`;
      const payload = { assessmentId, idempotencyKey: id };
      await q(
        `INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",payload,status,attempts,"createdAt")
        VALUES ($1,'ASSESSMENT',$2,$3,$4::jsonb,'PENDING',0,now() AT TIME ZONE 'UTC')`,
        [
          id,
          assessmentId,
          ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          JSON.stringify(payload),
        ],
      );
      command = { id, payload };
    }
    if (!command) return { ...body, runtimeRunId: runId };
    await report();
    const reservation = await call("reserve", {
      assessmentId,
      runId,
      commandKey: command.payload.idempotencyKey,
    });
    if (manual && reservation.admitted) manualRuns.set(assessmentId, runId);
    return { ...body, runtimeRunId: runId };
  }

  async function release(runId) {
    if (initialized && runId) await call("quiesce", { runId });
  }
  async function finishManual(assessmentId) {
    await release(manualRuns.get(assessmentId));
    manualRuns.delete(assessmentId);
  }
  async function close() {
    await client?.$disconnect();
  }
  return { prepare, release, finishManual, close };
}
