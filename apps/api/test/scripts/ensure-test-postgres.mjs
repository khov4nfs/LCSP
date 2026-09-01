import { execFileSync } from "node:child_process";
import net from "node:net";

const image = "postgres:16-alpine";
const host = "127.0.0.1";
const hostPort = Number(process.env.LCSP_TEST_POSTGRES_PORT ?? 55432);
const databaseName = process.env.LCSP_TEST_POSTGRES_DB ?? "lcsp_api_test";
const databaseUser = process.env.LCSP_TEST_POSTGRES_USER ?? "postgres";
const databasePassword = process.env.LCSP_TEST_POSTGRES_PASSWORD ?? "postgres";
const containerPort = 5432;
const containerName = `lcsp-api-test-postgres-${hostPort}-${databaseName}`;

/**
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileSyncOptions} [options]
 * @returns {string}
 */
function run(args, options = {}) {
  const output = execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return output.toString().trim();
}

function containerStatus() {
  const output = run([
    "ps",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Status}}",
  ]);

  return output;
}

function ensureContainer() {
  const status = containerStatus();
  if (!status) {
    run([
      "run",
      "--name",
      containerName,
      "-e",
      `POSTGRES_USER=${databaseUser}`,
      "-e",
      `POSTGRES_PASSWORD=${databasePassword}`,
      "-e",
      `POSTGRES_DB=${databaseName}`,
      "-p",
      `${host}:${hostPort}:${containerPort}`,
      "-d",
      image,
    ]);
    return;
  }

  if (!status.startsWith("Up ")) {
    run(["start", containerName]);
  }
}

function isAuthenticated() {
  try {
    run([
      "exec",
      "-e",
      `PGPASSWORD=${databasePassword}`,
      containerName,
      "psql",
      "-h",
      host,
      "-U",
      databaseUser,
      "-d",
      databaseName,
      "-w",
      "-c",
      "SELECT 1",
    ]);
    return true;
  } catch {
    return false;
  }
}

function waitForAuthentication() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (isAuthenticated()) {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

/**
 * @param {number} port
 * @param {string} host
 */
function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function waitUntilReady() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      run([
        "exec",
        containerName,
        "pg_isready",
        "-U",
        databaseUser,
        "-d",
        databaseName,
      ]);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }

  throw new Error("PostgreSQL test container did not become ready in time");
}

if (await isPortOpen(hostPort, host)) {
  process.exit(0);
}

ensureContainer();
waitUntilReady();

if (!waitForAuthentication()) {
  run(["rm", "-f", containerName]);
  ensureContainer();
  waitUntilReady();
  if (!waitForAuthentication()) {
    throw new Error(`PostgreSQL test container authentication failed for ${host}:${hostPort}/${databaseName} as postgres`);
  }
}

if (!(await isPortOpen(hostPort, host))) {
  throw new Error(
    `PostgreSQL test container is ready but ${host}:${hostPort} is not reachable. ` +
      `Recreate ${containerName} with ${host}:${hostPort}:${containerPort}.`,
  );
}
