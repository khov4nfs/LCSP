import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const launcher = fileURLToPath(
  new URL(
    "../fogewise-dev-launchers/windows/fogewise-dev-windows.ps1",
    import.meta.url,
  ),
);
const domain = "lcsp.fogewise.io.vn";
const managedEntry = `127.0.0.1 ${domain} # fogewise-local-dev`;

function runHostsCheck(t, lines) {
  const directory = mkdtempSync(join(tmpdir(), "fogewise-hosts-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const hostsPath = join(directory, "hosts");
  writeFileSync(hostsPath, lines.join("\n") + "\n");

  // Load the actual hosts function without starting Caddy or touching Windows DNS.
  const command = String.raw`
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
      $env:FOGEWISE_TEST_LAUNCHER, [ref]$null, [ref]$null
    )
    $function = $ast.Find({
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Ensure-Hosts'
    }, $false)
    . ([scriptblock]::Create($function.Extent.Text))
    function Require-Administrator {}
    function ipconfig {}
    function Fail([string]$message) { throw $message }
    $HostsPath = $env:FOGEWISE_TEST_HOSTS
    Ensure-Hosts $env:FOGEWISE_TEST_DOMAIN
    Ensure-Hosts $env:FOGEWISE_TEST_DOMAIN
  `;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FOGEWISE_TEST_LAUNCHER: launcher,
        FOGEWISE_TEST_HOSTS: hostsPath,
        FOGEWISE_TEST_DOMAIN: domain,
      },
    },
  );
  assert.ifError(result.error);
  return {
    result,
    lines: readFileSync(hostsPath, "utf8").trimEnd().split(/\r?\n/),
  };
}

test(
  "Windows launcher ignores hostname mentions in hosts comments",
  { skip: process.platform !== "win32" },
  (t) => {
    const original = [
      `# production-access: ${managedEntry}`,
      `127.0.0.1 fogewise-redis # see ${domain} for local development`,
      "127.0.0.1 fogewise-redis # fogewise-local-infra",
    ];
    const { result, lines } = runHostsCheck(t, original);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(lines, [...original, managedEntry]);
  },
);

test(
  "Windows launcher rejects an active hosts mapping it does not own",
  { skip: process.platform !== "win32" },
  (t) => {
    const original = [`192.0.2.10 other-host ${domain} # custom mapping`];
    const { result, lines } = runHostsCheck(t, original);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /hosts already contains/);
    assert.deepEqual(lines, original);
  },
);
