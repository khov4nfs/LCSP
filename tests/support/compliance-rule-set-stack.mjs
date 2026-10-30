// Shared real-stack helper for the COMPLIANCE_RULE_SET vertical/live scripts: a fresh migrated PostgreSQL database
// on the loopback test container, the REAL built API process, worker-authenticated HTTP helpers.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGAL_SOURCE_CHUNK_STATUSES } from "@lcsp/contracts/legal-source";
import { directRootAdmissionFixture } from "./direct-root-admission.mjs";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const apiDir = path.join(root, "apps/api");
export const python = path.join(root, "deepagents/.venv/bin/python");
export const workerKey =
  "compliance_rule_set-vertical-worker-key-at-least-32-chars";
export const pythonPath = [
  path.join(root, "deepagents"),
  path.join(root, "deepagents/tests"),
].join(":");
export const sha = (text) => createHash("sha256").update(text).digest("hex");
export const contentHash = (text) => `sha256:${sha(text)}`; // legalSource representation of chunk hashes
const requireApi = createRequire(path.join(apiDir, "package.json"));
const { Client } = requireApi("pg");
const directRootFixtures = new Map();
// Load built security only when a vertical needs it; process-control tests need no API build.
export function hashSecret(...args) {
  return requireApi(
    path
      .join(
        apiDir,
        "dist",
        path.relative(apiDir, requireApi.resolve("@lcsp/api/security")),
      )
      .replace(/\.ts$/, ".js"),
  ).hashSecret(...args);
}

export async function startStack({
  database,
  apiPort,
  checkpointDatabase = database,
  dbPort = Number(process.env.LCSP_TEST_PG_PORT ?? 55441),
  resetDatabase = true,
  createOnlyDatabase = false,
  signal,
  operationTimeoutMs = 0,
}) {
  const host = "127.0.0.1";
  const databaseUrl = `postgresql://postgres:postgres@${host}:${dbPort}/${database}?schema=public`;
  const checkpointDatabaseUrl = `postgresql://postgres:postgres@${host}:${dbPort}/${checkpointDatabase}`;
  if (checkpointDatabase !== database) {
    assert.match(checkpointDatabase, /^lcsp_assessment_[a-z0-9_]+$/);
  }
  const base = `http://${host}:${apiPort}`;

  const adminClient = new Client({
    connectionString: `postgresql://postgres:postgres@${host}:${dbPort}/postgres`,
  });
  await adminClient.connect();
  try {
    signal?.throwIfAborted();
    if (createOnlyDatabase) {
      assert.match(database, /^lcsp360_final_[a-z0-9_]+$/);
      const existing = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [database],
      );
      assert.equal(
        existing.rowCount,
        0,
        "Create-only evaluation database already exists; preserve it",
      );
      await adminClient.query(`CREATE DATABASE "${database}"`);
    } else if (resetDatabase) {
      await adminClient.query(
        `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
      );
      await adminClient.query(`CREATE DATABASE "${database}"`);
    } else {
      const existing = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [database],
      );
      assert.equal(
        existing.rowCount,
        1,
        "Resume requires the existing disposable database",
      );
    }
    if (checkpointDatabase !== database) {
      const existing = await adminClient.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [checkpointDatabase],
      );
      if (!existing.rowCount) {
        await adminClient.query(`CREATE DATABASE "${checkpointDatabase}"`);
      }
    }
  } finally {
    await adminClient.end();
  }
  const migrate = spawnSync(
    "pnpm",
    ["--dir", apiDir, "exec", "prisma", "migrate", "deploy"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: operationTimeoutMs,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);

  const db = new Client({
    connectionString: databaseUrl,
    ...(operationTimeoutMs
      ? {
          query_timeout: operationTimeoutMs,
          statement_timeout: operationTimeoutMs,
        }
      : {}),
  });
  await db.connect();
  const q = (text, values = []) => db.query(text, values);

  if (signal?.aborted) {
    await db.end();
    signal.throwIfAborted();
  }
  const log = [];
  const apiEnv = {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    ...(checkpointDatabase !== database
      ? { LANGGRAPH_CHECKPOINT_DATABASE_URL: checkpointDatabaseUrl }
      : {}),
    RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:55999", // unreachable on purpose: outbox rows stay PENDING
    RABBITMQ_EXCHANGE: "lcsp.events.compliance_rule_setvertical",
    OUTBOX_POLL_INTERVAL_MS: "600000",
    WORKER_API_KEY: workerKey,
    MFA_SECRET_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: "test-kek-v1",
    GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
      "test-kek-v1": Buffer.alloc(32, 7).toString("base64"),
    }),
    OAUTH_GOOGLE_CLIENT_ID: "x",
    OAUTH_GOOGLE_CLIENT_SECRET: "x",
    OAUTH_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000",
    BILLING_SEPAY_BANK_NAME: "T",
    BILLING_SEPAY_BANK_ACCOUNT_NUMBER: "1",
    BILLING_SEPAY_ACCOUNT_HOLDER: "T",
    BILLING_SEPAY_QR_URL_TEMPLATE:
      "https://p.test/qr?amount={amountVnd}&content={paymentCode}",
  };
  const server = spawn("node", ["dist/src/main.js"], {
    cwd: apiDir,
    env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => log.push(String(d)));
  server.stderr.on("data", (d) => log.push(String(d)));
  const abortServer = () => server.kill("SIGKILL");
  signal?.addEventListener("abort", abortServer, { once: true });
  const stop = async () => {
    signal?.removeEventListener("abort", abortServer);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await directRootFixtures.get(base)?.close();
    directRootFixtures.delete(base);
    await db.end();
  };

  for (let i = 0; ; i += 1) {
    if (signal?.aborted) {
      await stop();
      signal.throwIfAborted();
    }
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i >= 60 || server.exitCode !== null || server.signalCode !== null) {
      await stop();
      assert.fail(`API did not become healthy:\n${log.join("").slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const call = async (method, route, body, key) => {
    const response = await fetch(
      `${base}/internal/compliance-rule-set/${route}`,
      {
        method,
        signal,
        headers: {
          "content-type": "application/json",
          ...(key ? { "x-worker-api-key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  // `key` defaults to the real worker key; pass null to send no key.
  const post = (route, body, key = workerKey) => call("POST", route, body, key);
  const get = (route, key = workerKey) => call("GET", route, undefined, key);

  /** Seeds one pinned legalSource (document + chunks + VALID retrieval index). chunks: {locator, content, contentSha256}. */
  async function seedLegalSource({
    name,
    status,
    documentId,
    chunks,
    sourceBytes,
    sourceSha256,
  }) {
    assert.ok(
      Buffer.isBuffer(sourceBytes),
      "sourceBytes must contain the original document bytes",
    );
    assert.equal(typeof sourceSha256, "string", "sourceSha256 is required");
    assert.match(
      sourceSha256,
      /^(?:sha256:)?[a-f0-9]{64}$/,
      "sourceSha256 must be a SHA-256 digest",
    );
    const canonicalSourceDigest = sourceSha256.startsWith("sha256:")
      ? sourceSha256
      : `sha256:${sourceSha256}`;
    assert.equal(
      canonicalSourceDigest,
      contentHash(sourceBytes),
      "sourceSha256 must match the original source bytes",
    );
    const legalSourceId = randomUUID();
    await q(
      `INSERT INTO "LegalSourceVersion"(id, version, status, "sourceManifest") VALUES ($1,$2,$3::"LegalSourceLifecycleStatus",'{}')`,
      [legalSourceId, name, status],
    );
    const documentRow = randomUUID();
    await q(
      `INSERT INTO "LegalSourceDocument"(id,"legalSourceVersionId","documentId",title,"sourceUrl","sourceSha256","sourceEffectStatus")
       VALUES ($1,$2,$3,'Synthetic notice','https://example.invalid/n',$4,'IN_FORCE')`,
      [documentRow, legalSourceId, documentId, canonicalSourceDigest],
    );
    for (const chunk of chunks) {
      await q(
        `INSERT INTO "LegalDocumentChunk"(id,"legalSourceVersionId","legalSourceDocumentId","documentId",locator,content,"contentSha256",hierarchy,"legalStatus","legalEffectStatus","legalStatusSourceRef")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'IN_FORCE',$9,$10)`,
        [
          `${name}-${chunk.locator}`,
          legalSourceId,
          documentRow,
          documentId,
          chunk.locator,
          chunk.content,
          chunk.contentSha256,
          JSON.stringify(chunk.hierarchy ?? {}),
          LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          `fixture:${name}`,
        ],
      );
    }
    await q(
      `INSERT INTO "LegalRetrievalIndex"(id,"legalSourceVersionId",version,status,"configHash","contentHash","validationManifestRef","validatedAt")
       VALUES ($1,$2,$3,'VALID',$4,$4,$5,now())`,
      [
        randomUUID(),
        legalSourceId,
        `index-${name}`,
        "c".repeat(64),
        `manifest:${name}`,
      ],
    );
    return legalSourceId;
  }

  /**
   * Delivers `times` Legal Source activation events for `legalSourceId` to the real consumer (see
   * deliver-legal-source-activation.mjs) and returns that source's Rule Set Preparation runs.
   */
  async function activateLegalSource(
    legalSourceId,
    { times = 1, concurrent = false } = {},
  ) {
    const events = Array.from({ length: times }, () => ({
      legalSourceVersionId: legalSourceId,
      correlationId: randomUUID(),
    }));
    const delivered = spawnSync(
      "node",
      [
        path.join(root, "tests/support/deliver-legal-source-activation.mjs"),
        JSON.stringify({ events, concurrent }),
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: operationTimeoutMs,
        env: apiEnv,
      },
    );
    assert.equal(delivered.status, 0, delivered.stdout + delivered.stderr);
    const result = JSON.parse(
      delivered.stdout
        .trim()
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .pop(),
    );
    const runs = (
      await q(
        `SELECT id, "idempotencyKey", "requestedBy", "executionState" FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"=$1 ORDER BY "createdAt"`,
        [legalSourceId],
      )
    ).rows;
    return { ...result, runs, preparationRunId: runs[0]?.id ?? null };
  }

  /** Copy a read-only corpus export into this disposable DB; activation still uses the real Admin API. */
  async function seedLegalDocuments(corpus) {
    assert.ok(corpus.entries?.length, "A pinned corpus export is required");
    const versionId = randomUUID();
    await q("BEGIN");
    try {
      await q(
        `INSERT INTO "LegalSourceVersion"(id,version,status,"sourceManifest") VALUES ($1,$2,'DRAFT',$3::jsonb)`,
        [
          versionId,
          `acceptance-${versionId}`,
          JSON.stringify({
            ...corpus.version.sourceManifest,
            exportedVersionId: corpus.version.id,
          }),
        ],
      );
      for (const { document, chunks, blob } of corpus.entries) {
        assert.ok(
          chunks.length && blob,
          "Preserve the pinned original bytes and chunks",
        );
        const bytes = Buffer.from(blob.base64, "base64");
        assert.equal(sha(bytes), blob.sha256.replace(/^sha256:/, ""));
        assert.equal(bytes.length, blob.byteLength);
        assert.equal(document.sourceSha256.replace(/^sha256:/, ""), sha(bytes));
        await q(
          `INSERT INTO "LegalSourceDocumentBlob"(sha256,"byteLength",bytes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [blob.sha256, bytes.length, bytes],
        );
        const row = {
          ...document,
          id: randomUUID(),
          legalSourceVersionId: versionId,
        };
        await q(
          `INSERT INTO "LegalSourceDocument" SELECT * FROM jsonb_populate_record(NULL::"LegalSourceDocument",$1::jsonb)`,
          [JSON.stringify(row)],
        );
        const copied = chunks.map((c) => {
          assert.equal(sha(c.content), c.contentSha256.replace(/^sha256:/, ""));
          return {
            ...c,
            id: sha(`${versionId}:${document.documentId}:${c.locator}`),
            legalSourceVersionId: versionId,
            legalSourceDocumentId: row.id,
          };
        });
        await q(
          `INSERT INTO "LegalDocumentChunk" SELECT * FROM jsonb_populate_recordset(NULL::"LegalDocumentChunk",$1::jsonb)`,
          [JSON.stringify(copied)],
        );
      }
      const count = (
        await q(
          `SELECT count(*)::int AS count FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=$1`,
          [versionId],
        )
      ).rows[0].count;
      assert.equal(
        count,
        corpus.entries.reduce((n, e) => n + e.chunks.length, 0),
      );
      await q("COMMIT");
      return versionId;
    } catch (error) {
      await q("ROLLBACK");
      throw error;
    }
  }

  const materializeLegalSource = async (source) => {
    const result = spawnSync(
      "node",
      [
        path.join(root, "tests/support/materialize-legal-document-graph.mjs"),
        source,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: operationTimeoutMs,
        env: apiEnv,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(
      result.stdout
        .trim()
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .pop(),
    );
  };
  const admission = directRootAdmissionFixture({ q, base, databaseUrl, workerKey, apiDir });
  directRootFixtures.set(base, admission);
  return {
    admission,
    db,
    q,
    base,
    post,
    get,
    stop,
    seedLegalSource,
    seedLegalDocuments,
    activateLegalSource,
    materializeLegalSource,
    databaseUrl,
    checkpointDatabaseUrl,
    logs: log,
  };
}

/** Runs a Python script with the repo PYTHONPATH; resolves with the last JSON line it prints. */
/** @param {string} script @param {string[]} args
 * @param {{env?: Record<string,string>, timeoutMs?:number, signal?:AbortSignal, ownedProcessGroup?:boolean, executable?:string}} [options] */
export async function runPython(
  script,
  args,
  {
    env = {},
    timeoutMs = 0,
    signal,
    ownedProcessGroup = false,
    executable = python,
  } = {},
) {
  const admission = ["scripted_root.py", "hitl_root.py", "root_control.py"].includes(path.basename(script))
    ? directRootFixtures.get(args[0]) : null;
  const prepared = admission ? await admission.prepare(args[2]) : null;
  try {
  return await new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(executable, [script, ...args], {
      cwd: root,
      detached: ownedProcessGroup,
      env: { ...process.env, PYTHONPATH: pythonPath, ...env,
        ...(prepared ? { LCSP_TEST_ROOT_RUNTIME_RUN_ID: prepared.runtimeRunId } : {}) },
    });
    let out = "",
      err = "",
      failure;
    const kill = () => {
      try {
        process.kill(ownedProcessGroup ? -child.pid : child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") failure = error;
      }
    };
    const abort = () => {
      failure = signal.reason;
      kill();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = timeoutMs
      ? setTimeout(() => {
          failure = new Error(`Worker deadline ${timeoutMs}ms`);
          kill();
        }, timeoutMs)
      : null;
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code, exitSignal) => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure || code !== 0)
        return reject(
          failure ??
            new Error(
              `python ${path.basename(script)} exited ${code} signal=${exitSignal} budgetMs=${timeoutMs}\n${err.slice(-3000)}`,
            ),
        );
      try {
        resolve(
          JSON.parse(
            out
              .trim()
              .split("\n")
              .filter((l) => l.startsWith("{"))
              .pop(),
          ),
        );
      } catch (error) {
        reject(error);
      }
    });
  });
  } finally {
    // A closed fixture process has no surviving Python model/tool threads.
    await admission?.release(prepared.runtimeRunId);
  }
}
