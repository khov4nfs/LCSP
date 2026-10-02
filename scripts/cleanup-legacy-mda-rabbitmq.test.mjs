import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanupLegacyMdaQueues,
  filterLegacyMdaQueues,
} from "./cleanup-legacy-mda-rabbitmq.mjs";

test("legacy MDA queue cleanup filters only retired LCSP MDA queues", () => {
  assert.deepEqual(
    filterLegacyMdaQueues([
      "lcsp.mda.boundary.scan_requested",
      "lcsp.mda.boundary.scan_requested.retry.2000ms",
      "lcsp.agent_runtime.boundary.scan_requested",
      "customer.queue",
      "lcsp.mda.boundaryish.not-a-match",
    ]),
    [
      "lcsp.mda.boundary.scan_requested",
      "lcsp.mda.boundary.scan_requested.retry.2000ms",
    ],
  );
});

test("legacy MDA queue cleanup dry-run never deletes queues", async () => {
  const calls = [];
  let output = "";

  const result = await cleanupLegacyMdaQueues({
    argv: [],
    stdout: { write: (value) => { output += value; } },
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      return {
        stdout: [
          "lcsp.mda.boundary.scan_requested",
          "lcsp.agent_runtime.boundary.scan_requested",
        ].join("\n"),
      };
    },
  });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.matched, ["lcsp.mda.boundary.scan_requested"]);
  assert.equal(calls.length, 1);
  assert.match(output, /\[dry-run\] would delete lcsp\.mda\.boundary\.scan_requested/u);
});

test("legacy MDA queue cleanup deletes only matched queues when executed", async () => {
  const calls = [];

  const result = await cleanupLegacyMdaQueues({
    argv: ["--execute"],
    stdout: { write: () => {} },
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      if (args[1] === "list_queues") {
        return {
          stdout: [
            "lcsp.mda.boundary.scan_requested",
            "lcsp.mda.boundary.scan_requested.retry.2000ms",
            "lcsp.agent_runtime.boundary.scan_requested",
          ].join("\n"),
        };
      }
      return { stdout: "" };
    },
  });

  assert.deepEqual(result.deleted, [
    "lcsp.mda.boundary.scan_requested",
    "lcsp.mda.boundary.scan_requested.retry.2000ms",
  ]);
  assert.deepEqual(calls.slice(1), [
    ["rabbitmqctl", ["delete_queue", "lcsp.mda.boundary.scan_requested"]],
    [
      "rabbitmqctl",
      ["delete_queue", "lcsp.mda.boundary.scan_requested.retry.2000ms"],
    ],
  ]);
});

test("legacy MDA queue cleanup can run rabbitmqctl inside a Docker container", async () => {
  const calls = [];

  await cleanupLegacyMdaQueues({
    argv: ["--execute", "--container", "fogewise-rabbitmq"],
    stdout: { write: () => {} },
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      if (args.at(-2) === "list_queues") {
        return { stdout: "lcsp.mda.boundary.scan_requested\n" };
      }
      return { stdout: "" };
    },
  });

  assert.deepEqual(calls, [
    [
      "docker",
      ["exec", "fogewise-rabbitmq", "rabbitmqctl", "-q", "list_queues", "name"],
    ],
    [
      "docker",
      [
        "exec",
        "fogewise-rabbitmq",
        "rabbitmqctl",
        "delete_queue",
        "lcsp.mda.boundary.scan_requested",
      ],
    ],
  ]);
});
