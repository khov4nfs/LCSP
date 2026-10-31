import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCapacityPolicySchema } from "@lcsp/contracts/assessment-domain";
import { apiDir, root, runPython } from "./compliance-rule-set-stack.mjs";

// Provider-free native integration. Real local resources are measured; the
// authorized provider limits below describe the fixture, never a paid provider.
export async function runAdaptiveCapacityLoad({
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
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp364-native-load-"));
  const cases = [];
  try {
    const status = await service.status();
    await service.control(
      {
        expectedVersion: status.version,
        reason:
          "Provider-free local integration envelope; no paid provider authorization",
        policy: rootCapacityPolicySchema.parse({
          enabled: true,
          initial: 1,
          maximum: 3,
          evaluationSeconds: 5,
          scaleUpCooldownSeconds: 5,
          scaleDownCooldownSeconds: 5,
          hysteresisSamples: 1,
          // No clone/image build or sandbox in this small local fixture. Production keeps its 4 GiB default.
          diskHeadroomBytes: 1024 ** 3,
          rootMemoryReserveBytes: 512 * 1024 ** 2,
          providerConcurrentLimit: 3,
          providerRpmLimit: 1000000,
          providerTpmLimit: 1000000000,
        }),
      },
      "provider-free-load-fixture",
    );
    for (const count of [1, 2, 4, 8]) {
      const jobs = [];
      for (let i = 0; i < count; i++) {
        const actor = i === count - 1 && count > 1 ? otherOwner : owner;
        const assessment = await createAssessment(
          `LCSP-364 provider-free load ${count}/${i}`,
          actor,
        );
        const response = await fetch(
          `${stack.base}/assessments/${assessment.id}/repository-setup/complete`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${actor.token}` },
          },
        );
        assert.equal(response.status, 201, await response.text());
        const command = (
          await stack.q(
            `SELECT id,payload FROM "OutboxMessage" WHERE "aggregateId"=$1
          AND "eventType"='command.assessment.root.requested.v1' ORDER BY "createdAt" DESC LIMIT 1`,
            [assessment.id],
          )
        ).rows[0];
        jobs.push({
          assessmentId: assessment.id,
          commandId: command.id,
          message: command.payload,
        });
      }
      cases.push({ submitted: count, jobs });
    }
    const input = path.join(dir, "input.json");
    const output = path.join(
      root,
      "reports/lcsp364-adaptive-capacity/native-load.json",
    );
    writeFileSync(
      input,
      JSON.stringify({
        base: stack.base,
        databaseUrl: stack.databaseUrl,
        checkpointDatabaseUrl: stack.checkpointDatabaseUrl,
        repoDir,
        cases,
        output,
      }),
      { mode: 0o600 },
    );
    await runPython(
      path.join(root, "deepagents/tests/vertical/adaptive_capacity_load.py"),
      [input],
      {
        timeoutMs: 360000,
        env: {
          WORKER_API_KEY:
            "compliance_rule_set-vertical-worker-key-at-least-32-chars",
        },
      },
    );
    const result = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(
      result.scenarios.map((s) => s.submitted),
      [1, 2, 4, 8],
    );
    assert.ok(result.maximumObservedRoots <= 3);
    assert.equal(
      result.scenarios.every((s) => s.completed === s.submitted),
      true,
    );
    assert.equal((await service.status()).active, 0);
    console.log(
      JSON.stringify({
        scope: result.scope,
        maximumObservedRoots: result.maximumObservedRoots,
        scenarios: result.scenarios.map(
          ({
            submitted,
            completed,
            maximumRoots,
            queueWaitP50Ms,
            queueWaitP95Ms,
          }) => ({
            submitted,
            completed,
            maximumRoots,
            queueWaitP50Ms,
            queueWaitP95Ms,
          }),
        ),
      }),
    );
  } finally {
    await client.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
}
