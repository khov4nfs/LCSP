#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

export const LEGACY_MDA_QUEUE_PREFIX = "lcsp.mda.boundary.";

const execFileDefault = promisify(execFileCallback);

export function parseCleanupArgs(argv) {
  const container = readOption(argv, "--container");
  return {
    dryRun: !argv.includes("--execute"),
    rabbitmqctl:
      readOption(argv, "--rabbitmqctl") ??
      (container ? `docker:${container}` : "rabbitmqctl"),
  };
}

export function filterLegacyMdaQueues(queueNames) {
  return queueNames
    .map((name) => name.trim())
    .filter((name) => name.startsWith(LEGACY_MDA_QUEUE_PREFIX));
}

export async function listQueues({ execFileImpl, rabbitmqctl }) {
  const { stdout } = await execRabbitmqCtl(execFileImpl, rabbitmqctl, [
    "-q",
    "list_queues",
    "name",
  ]);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function cleanupLegacyMdaQueues({
  argv = process.argv.slice(2),
  execFileImpl = execFileDefault,
  stdout = process.stdout,
} = {}) {
  const options = parseCleanupArgs(argv);
  const queueNames = await listQueues({
    execFileImpl,
    rabbitmqctl: options.rabbitmqctl,
  });
  const legacyQueues = filterLegacyMdaQueues(queueNames);

  for (const queueName of legacyQueues) {
    if (options.dryRun) {
      stdout.write(`[dry-run] would delete ${queueName}\n`);
      continue;
    }
    await execRabbitmqCtl(execFileImpl, options.rabbitmqctl, [
      "delete_queue",
      queueName,
    ]);
    stdout.write(`deleted ${queueName}\n`);
  }

  if (legacyQueues.length === 0) {
    stdout.write("no legacy MDA RabbitMQ queues found\n");
  }

  return {
    dryRun: options.dryRun,
    deleted: options.dryRun ? [] : legacyQueues,
    matched: legacyQueues,
  };
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  return typeof value === "string" && !value.startsWith("--") ? value : null;
}

function execRabbitmqCtl(execFileImpl, rabbitmqctl, args) {
  const parsed = parseRabbitmqCtlCommand(rabbitmqctl);
  return execFileImpl(parsed.command, [...parsed.args, ...args]);
}

function parseRabbitmqCtlCommand(rabbitmqctl) {
  if (rabbitmqctl.startsWith("docker:")) {
    return {
      command: "docker",
      args: ["exec", rabbitmqctl.slice("docker:".length), "rabbitmqctl"],
    };
  }
  return { command: rabbitmqctl, args: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupLegacyMdaQueues().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
