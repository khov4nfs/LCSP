import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
const stop = source.slice(
  source.indexOf("function stopDevProcesses()"),
  source.indexOf("function findMatchingProcesses("),
);
const killGroup = source.slice(
  source.indexOf("function killProcessGroup("),
  source.indexOf("function listParentPids("),
);

for (const sharedGroup of [false, true]) {
  test(`dev:stop preserves Fogewise with shared process group=${sharedGroup}`, () => {
    const signals = [];
    const entries = [
      { pid: 10, pgid: 10, command: "node scripts/run.mjs fogewise" },
      {
        pid: 11,
        pgid: 10,
        command: "bash ./fogewise-dev-launchers/fedora/fogewise-dev-fedora.sh",
      },
      {
        pid: 12,
        pgid: 10,
        command:
          "caddy run --config fogewise-dev-launchers/common/Caddyfile.dev",
      },
      {
        pid: 20,
        pgid: sharedGroup ? 10 : 20,
        command: "node scripts/run.mjs dev",
      },
      { pid: 21, pgid: sharedGroup ? 10 : 20, command: "next dev" },
    ];
    const context = vm.createContext({
      process: {
        pid: 100,
        ppid: 99,
        kill: (pid, signal) => signals.push({ pid, signal }),
      },
      isWindows: false,
      managedAgentEventsModule:
        "tools.common.capabilities.managed.rabbitmq_consumer",
      console: { log() {} },
      sleepMs() {},
      listParentPids: () => [99],
      readProcessGroupId: (pid) =>
        entries.find((entry) => entry.pid === pid)?.pgid ?? 99,
      findMatchingProcesses: (pattern, protectedPids) =>
        entries.filter(
          (entry) =>
            entry.command.includes(pattern) && !protectedPids.has(entry.pid),
        ),
    });
    vm.runInContext(`${killGroup}\n${stop}\nstopDevProcesses();`, context);
    assert.ok(signals.length > 0);
    assert.ok(
      signals.every(
        ({ pid }) => ![10, 11, 12, -10, 99, 100, -99].includes(pid),
      ),
    );
    assert.ok(signals.some(({ pid }) => pid === (sharedGroup ? 20 : -20)));
    assert.ok(signals.some(({ signal }) => signal === "SIGTERM"));
  });
}
