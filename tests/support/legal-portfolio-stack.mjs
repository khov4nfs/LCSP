// Shared real-stack helper for the W2 vertical/live scripts: a fresh migrated PostgreSQL database
// on the loopback test container, the REAL built API process, worker-authenticated HTTP helpers.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const apiDir = path.join(root, "apps/api");
export const python = path.join(root, "deepagents/.venv/bin/python");
export const workerKey = "w2-vertical-worker-key-at-least-32-chars";
export const pythonPath = [path.join(root, "deepagents"), path.join(root, "deepagents/tests")].join(":");
export const sha = (text) => createHash("sha256").update(text).digest("hex");
export const contentHash = (text) => `sha256:${sha(text)}`; // corpus representation of chunk hashes
const { Client } = createRequire(path.join(apiDir, "package.json"))("pg");

export async function startStack({ database, apiPort, dbPort = Number(process.env.LCSP_W2_PG_PORT ?? 55441), resetDatabase = true }) {
  const host = "127.0.0.1";
  const databaseUrl = `postgresql://postgres:postgres@${host}:${dbPort}/${database}?schema=public`;
  const base = `http://${host}:${apiPort}`;

  const adminClient = new Client({ connectionString: `postgresql://postgres:postgres@${host}:${dbPort}/postgres` });
  await adminClient.connect();
  try {
    if (resetDatabase) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${database}"`);
    } else {
      const existing = await adminClient.query("SELECT 1 FROM pg_database WHERE datname=$1", [database]);
      assert.equal(existing.rowCount, 1, "Resume requires the existing disposable database");
    }
  } finally {
    await adminClient.end();
  }
  const migrate = spawnSync("pnpm", ["--dir", apiDir, "exec", "prisma", "migrate", "deploy"], {
    cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const q = (text, values = []) => db.query(text, values);

  const log = [];
  const server = spawn("node", ["dist/src/main.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(apiPort),
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:55999", // unreachable on purpose: outbox rows stay PENDING
      RABBITMQ_EXCHANGE: "lcsp.events.w2vertical",
      OUTBOX_POLL_INTERVAL_MS: "600000",
      WORKER_API_KEY: workerKey,
      MFA_SECRET_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "test-kek-v1",
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({ "test-kek-v1": Buffer.alloc(32, 7).toString("base64") }),
      OAUTH_GOOGLE_CLIENT_ID: "x",
      OAUTH_GOOGLE_CLIENT_SECRET: "x",
      OAUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000",
      BILLING_SEPAY_BANK_NAME: "T",
      BILLING_SEPAY_BANK_ACCOUNT_NUMBER: "1",
      BILLING_SEPAY_ACCOUNT_HOLDER: "T",
      BILLING_SEPAY_QR_URL_TEMPLATE: "https://p.test/qr?amount={amountVnd}&content={paymentCode}",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  const stop = async () => {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    await db.end();
  };

  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i >= 60) {
      await stop();
      assert.fail(`API did not become healthy:\n${log.join("").slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const call = async (method, route, body, key) => {
    const response = await fetch(`${base}/internal/legal-portfolio/${route}`, {
      method,
      headers: { "content-type": "application/json", ...(key ? { "x-worker-api-key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  // `key` defaults to the real worker key; pass null to send no key.
  const post = (route, body, key = workerKey) => call("POST", route, body, key);
  const get = (route, key = workerKey) => call("GET", route, undefined, key);

  /** Seeds one pinned corpus (document + chunks + VALID retrieval index). chunks: {locator, content, contentSha256}. */
  async function seedCorpus({ name, status, documentId, chunks }) {
    const corpusId = randomUUID();
    await q(
      `INSERT INTO "LegalCorpusVersion"(id, version, status, "sourceManifest") VALUES ($1,$2,$3::"LegalRuleLifecycleStatus",'{}')`,
      [corpusId, name, status],
    );
    const documentRow = randomUUID();
    await q(
      `INSERT INTO "LegalSourceDocument"(id,"legalCorpusVersionId","documentId",title,"sourceUrl","sourceSha256","sourceEffectStatus")
       VALUES ($1,$2,$3,'Synthetic notice','https://example.invalid/n',$4,'IN_FORCE')`,
      [documentRow, corpusId, documentId, contentHash(name)],
    );
    for (const chunk of chunks) {
      await q(
        `INSERT INTO "LegalDocumentChunk"(id,"legalCorpusVersionId","legalSourceDocumentId","documentId",locator,content,"contentSha256",hierarchy,"legalStatus")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'IN_FORCE')`,
        [`${name}-${chunk.locator}`, corpusId, documentRow, documentId, chunk.locator, chunk.content, chunk.contentSha256, JSON.stringify(chunk.hierarchy ?? {})],
      );
    }
    await q(
      `INSERT INTO "LegalRetrievalIndex"(id,"legalCorpusVersionId",version,status,"configHash","contentHash","validationManifestRef","validatedAt")
       VALUES ($1,$2,$3,'VALID',$4,$4,$5,now())`,
      [randomUUID(), corpusId, `index-${name}`, "c".repeat(64), `manifest:${name}`],
    );
    return corpusId;
  }

  return { db, q, base, post, get, stop, seedCorpus, databaseUrl, logs: log };
}

/** Runs a Python script with the repo PYTHONPATH; resolves with the last JSON line it prints. */
export function runPython(script, args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], { cwd: root, env: { ...process.env, PYTHONPATH: pythonPath, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`python ${path.basename(script)} exited ${code}\n${err.slice(-3000)}`));
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      resolve(JSON.parse(line));
    });
  });
}
