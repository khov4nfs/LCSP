#!/usr/bin/env node
/**
 * Create-only, no-model bootstrap for the approved T31 chatbot source scope.
 * The active baseline is copied exactly with its existing provenance. No candidate
 * is activated, and no old assessment, fact, decision, credential or queue is copied.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  constants as fsConstants, chmodSync, existsSync, lstatSync, mkdirSync,
  openSync, closeSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  ASSESSMENT_AUDIT_MODES, RULE_AUDIT_SCOPE_MODES, RULE_AUDIT_STATUSES,
  ASSESSMENT_ROOT_COMMAND_TYPES,
} from "@lcsp/contracts/assessment-domain";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PINS = Object.freeze({
  ruleSetVersionId: "97004ff3-9240-4e37-8a94-9ade8832c00a",
  ruleSetDigest: "f06180635588eb5c026a3dc2e9d3c4da1c3c92853258bb8463f2b52c2478d1ce",
  legalSourceVersionId: "ea43540c-513e-4b76-969a-8415f06696f2",
  preparationRunId: "630eed1a-1577-4ca7-84bc-4ba17df911f1",
  repositoryFullName: "tkhudson/AI-Powered-Customer-Support-Chatbot",
  repositoryCommit: "65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b",
  sourcePathPrefix: "tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot",
  originalAssessmentId: "5ec45c57-3625-4368-bedc-22824a396e5e",
});
export const DEFAULT_EXPORT = path.join(ROOT, ".cache/t31/source-scope-20261104/baseline-export.json");
export const DEFAULT_EXPORT_SHA256 = "79a402afbb509668f8654a70933006843e8df4a35a0f6b6d3d84427f47233ae0";
export const T31_ARCHIVE_MAX_BYTES = 268435456;
export const TABLES = Object.freeze([
  "LegalSource", "LegalSourceVersion", "LegalSourceDocumentBlob", "LegalSourceDocument",
  "LegalDocumentChunk", "LegalRetrievalIndex", "LegalDocumentMaterialization",
  "LegalDocumentNode", "LegalDocumentReference", "LegalDocumentChunkNode",
  "LegalDocumentRetrievalUnit", "LegalSourceActivationRecord", "RuleSetPreparationRun",
  "RuleSetPreparationClaimInventory", "RuleSetPreparationReviewFrontier",
  "RuleSetPreparationSourceReview", "ComplianceRuleSetVersion", "LegalRequirement",
  "AssessmentRule", "AssessmentRuleLegalRequirement", "LegalRequirementProvenance",
  "LegalRequirementContextRelation", "LegalSemanticGraph", "LegalSemanticClaim",
  "LegalSemanticClaimSource", "LegalSemanticClaimRelation", "LegalRequirementClaimBinding",
  "ComplianceRuleSetActivationRecord", "ComplianceRuleSetReactivationRecord",
]);
const CACHE_ROOT = path.join(ROOT, ".cache/t31");
const API_MAIN = path.join(ROOT, "apps/api/dist/src/main.js");
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,100}$/u;
const DATABASE_PATTERN = /^lcsp360_final_t31_[a-z0-9_]{8,40}$/u;
const CHECKPOINT_PATTERN = /^lcsp_assessment_t31_[a-z0-9_]{8,40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const sha = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Business purpose: Report a stable failure without exposing captured process or API secrets.
 * Business rules: Only an explicitly safe code is public; original exceptions remain private.
 * Execution flow:
 * 1. Validate the operator code.
 * 2. Attach it to an otherwise non-sensitive Error.
 * Failure cases: Unknown codes become OPERATOR_FAILURE.
 * Side effects: None; creates an in-memory failure.
 */
export function fail(code) {
  const safe = SAFE_CODE.test(code) ? code : "OPERATOR_FAILURE";
  const error = new Error(safe);
  error.operatorCode = safe;
  throw error;
}

/**
 * Business purpose: Enforce local endpoints and disposable names before any database operation.
 * Business rules: Original assessments and non-pilot database names are never resumable.
 * Execution flow:
 * 1. Validate names, loopback URLs and immutable scope pins.
 * 2. Validate optional assessment ownership and readiness metadata.
 * Failure cases: Reject remote URLs, malformed ports, changed pins or the historical assessment.
 * Side effects: None; validates supplied metadata only.
 */
export function validateRuntime(runtime, { requireAssessment = true } = {}) {
  if (!DATABASE_PATTERN.test(runtime.database ?? "") ||
      !CHECKPOINT_PATTERN.test(runtime.checkpointDatabase ?? "") ||
      runtime.database === runtime.checkpointDatabase) fail("ISOLATED_DATABASE_NAME_REQUIRED");
  const dbPort = Number(runtime.dbPort);
  if (!Number.isInteger(dbPort) || dbPort < 1024 || dbPort > 65535) fail("INVALID_DATABASE_PORT");
  let api, checkpoint;
  try {
    api = new URL(runtime.apiBase);
    checkpoint = new URL(runtime.checkpointDatabaseUrl);
  } catch { fail("LOOPBACK_RUNTIME_URL_REQUIRED"); }
  if (api.protocol !== "http:" || api.hostname !== "127.0.0.1" ||
      api.username || api.password || api.pathname !== "/" || api.search || api.hash ||
      !Number.isInteger(Number(api.port)) || Number(api.port) < 1024) fail("LOOPBACK_API_REQUIRED");
  if (checkpoint.protocol !== "postgresql:" || checkpoint.hostname !== "127.0.0.1" ||
      Number(checkpoint.port) !== dbPort || checkpoint.pathname !== "/" + runtime.checkpointDatabase ||
      checkpoint.search || checkpoint.hash) fail("ISOLATED_CHECKPOINT_REQUIRED");
  for (const key of ["ruleSetVersionId", "repositoryFullName", "repositoryCommit", "sourcePathPrefix"])
    if (runtime[key] !== PINS[key]) fail("IMMUTABLE_SCOPE_PIN_MISMATCH");
  if (typeof runtime.workerKey !== "string" || runtime.workerKey.length < 32) fail("WORKER_KEY_REQUIRED");
  if (runtime.manifestVersion !== "T31_SCOPED_PILOT_RUNTIME_V2") fail("NATIVE_AUDIT_RUNTIME_V2_REQUIRED");
  const agent = new URL(runtime.agentBase ?? "http://invalid.invalid");
  if (agent.protocol !== "http:" || agent.hostname !== "127.0.0.1" ||
      agent.username || agent.password || agent.pathname !== "/" || agent.search || agent.hash ||
      !Number.isInteger(Number(agent.port)) || Number(agent.port) < 1024 || agent.port === api.port)
    fail("OWNED_NATIVE_AGENT_ENDPOINT_REQUIRED");
  if (requireAssessment) {
    for (const key of ["assessmentId", "repositorySnapshotId", "repositoryScanJobId", "auditRequestId"])
      if (!UUID.test(runtime[key] ?? "")) fail("FRESH_ASSESSMENT_PIN_REQUIRED");
    if (runtime.assessmentId === PINS.originalAssessmentId) fail("HISTORICAL_ASSESSMENT_FORBIDDEN");
    if (runtime.ruleSetDigest !== PINS.ruleSetDigest || runtime.auditRequestRevision !== 1 ||
        runtime.auditScopeMode !== RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET ||
        runtime.rootCommandKey !== "rule-audit:" + runtime.auditRequestId + ":start" ||
        canonicalRuleIdentities(runtime.auditRules).length !== 243 ||
        sha(JSON.stringify(canonicalRuleIdentities(runtime.auditRules))) !== runtime.auditMembershipSha256)
      fail("FROZEN_FULL_AUDIT_REQUIRED");
  }
  return runtime;
}

/**
 * Business purpose: Bind the legal baseline seed to the reviewed immutable export.
 * Business rules: Only the allowlisted legal tables and exact active baseline are importable.
 * Execution flow:
 * 1. Verify the expected file digest and export declarations.
 * 2. Check table membership, order, counts and original activation provenance.
 * Failure cases: Reject tampering, candidates, customer state, unknown tables or changed pins.
 * Side effects: None; parses and validates the supplied bytes.
 */
export function validateBaselineExport(bytes, expectedSha256) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 ?? "") || sha(bytes) !== expectedSha256)
    fail("BASELINE_EXPORT_DIGEST_MISMATCH");
  let data;
  try { data = JSON.parse(bytes.toString("utf8")); } catch { fail("BASELINE_EXPORT_INVALID"); }
  if (data.schemaVersion !== "LCSP_ACTIVE_BASELINE_EXPORT_V1" ||
      data.sourceReadOnly !== true || data.containsCandidate !== false ||
      data.containsAssessmentsFactsDecisionsEvidenceOrUsers !== false)
    fail("INHERITED_BASELINE_ONLY");
  if (JSON.stringify(data.insertOrder) !== JSON.stringify(TABLES) ||
      JSON.stringify(Object.keys(data.tables ?? {}).sort()) !== JSON.stringify([...TABLES].sort()))
    fail("BASELINE_TABLE_ALLOWLIST_MISMATCH");
  for (const key of ["ruleSetVersionId", "ruleSetDigest", "legalSourceVersionId", "preparationRunId"])
    if (data.pins?.[key] !== PINS[key]) fail("BASELINE_PIN_MISMATCH");
  for (const table of TABLES)
    if (!Array.isArray(data.tables[table]) || data.tables[table].length !== data.counts?.[table] ||
        !Array.isArray(data.columns?.[table]) || !data.columns[table].length)
      fail("BASELINE_ROW_COUNT_MISMATCH");
  if (data.counts.LegalRequirement !== 633 || data.counts.AssessmentRule !== 243 ||
      data.counts.LegalSourceDocument !== 8 || data.counts.LegalDocumentChunk !== 2915)
    fail("BASELINE_CORPUS_COUNT_MISMATCH");
  const ruleset = data.tables.ComplianceRuleSetVersion;
  const activation = data.tables.ComplianceRuleSetActivationRecord;
  if (ruleset.length !== 1 || ruleset[0].id !== PINS.ruleSetVersionId ||
      ruleset[0].ruleSetDigest !== PINS.ruleSetDigest || ruleset[0].lifecycleState !== "ACTIVE" ||
      activation.length !== 1 || activation[0].ruleSetVersionId !== PINS.ruleSetVersionId ||
      activation[0].requestDigest !== PINS.ruleSetDigest ||
      activation[0].validationOutcome !== "PASSED" || activation[0].previousActiveRuleSetVersionId !== null ||
      data.tables.ComplianceRuleSetReactivationRecord.length !== 0)
    fail("INHERITED_ACTIVATION_PROVENANCE_MISMATCH");
  if (data.foreignKeys.some((fk) => !TABLES.includes(fk.referencesTable)))
    fail("UNEXPORTED_FOREIGN_KEY_DEPENDENCY");
  return data;
}

/**
 * Business purpose: Preserve SQL null, JSON null and document bytes during exact baseline copying.
 * Business rules: Column names must be real export columns; no extra row fields may be inserted.
 * Execution flow:
 * 1. Require exact field coverage.
 * 2. Encode JSON columns and decode verified bytea payloads.
 * Failure cases: Reject unexpected fields, invalid byte encodings or malformed metadata.
 * Side effects: None; returns PostgreSQL bind values without constructing data SQL.
 */
export function encodeSeedRow(table, row, columns, jsonNullColumns = []) {
  const names = columns.map((c) => c.column_name);
  if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) ||
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...names].sort()))
    fail("BASELINE_COLUMN_MISMATCH");
  return columns.map((column) => {
    const value = row[column.column_name];
    if (column.data_type === "json" || column.data_type === "jsonb")
      return value === null && !jsonNullColumns.includes(column.column_name) ? null : JSON.stringify(value);
    if (column.data_type === "bytea") {
      if (table !== "LegalSourceDocumentBlob" || column.column_name !== "bytes" ||
          typeof value !== "string") fail("UNEXPECTED_BINARY_COLUMN");
      const bytes = Buffer.from(value, "base64");
      if (bytes.toString("base64") !== value || sha(bytes) !== row.sha256 ||
          bytes.length !== row.byteLength) fail("SOURCE_BLOB_HASH_MISMATCH");
      return bytes;
    }
    return value;
  });
}

/**
 * Business purpose: Prevent create-only preparation from adopting either existing database.
 * Business rules: Both requested names must be absent; this helper never drops or resets a database.
 * Execution flow:
 * 1. Query both names through the loopback administrator connection.
 * 2. Reject any collision before the shared stack helper can create anything.
 * Failure cases: Existing API or checkpoint databases block preparation.
 * Side effects: One read-only PostgreSQL query.
 */
export async function assertDatabaseNamesAvailable(query, runtime) {
  const found = await query("SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
    [[runtime.database, runtime.checkpointDatabase]]);
  if (found.rowCount !== 0) fail("CREATE_ONLY_DATABASE_ALREADY_EXISTS");
}

/**
 * Business purpose: Remove ambient deployment credentials from child-process configuration.
 * Business rules:
 * - Network services and artifacts are explicit loopback/task-private values.
 * - This T31 profile uses a finite 256 MiB compressed-archive cap, independent of ambient settings.
 * - The provider byte-limit guard and the production default remain unchanged.
 * Execution flow:
 * 1. Retain only essential OS process settings.
 * 2. Set local API, database, broker, optional Redis and private storage settings.
 * Failure cases: Invalid runtime pins are rejected before environment construction.
 * Side effects: None; returns a new environment without changing the caller's environment.
 */
export function isolatedEnvironment(ambient, runtime, directory, preloadPath, ghExecutable) {
  validateRuntime(runtime, { requireAssessment: false });
  const keep = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "WINDIR"];
  const env = Object.fromEntries(keep.filter((key) => ambient[key] !== undefined).map((key) => [key, ambient[key]]));
  return {
    ...env, TMPDIR: path.join(directory, "tmp"), TMP: path.join(directory, "tmp"), TEMP: path.join(directory, "tmp"),
    NODE_ENV: "test", NODE_OPTIONS: "--import=" + pathToFileURL(preloadPath).href,
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:" + runtime.dbPort + "/" + runtime.database + "?schema=public",
    LANGGRAPH_CHECKPOINT_DATABASE_URL: runtime.checkpointDatabaseUrl,
    PGOPTIONS: "", PGHOST: "127.0.0.1", PGPORT: String(runtime.dbPort), PGUSER: "postgres", PGPASSWORD: "postgres",
    PGDATABASE: runtime.database, LCSP_API_BASE_URL: runtime.apiBase,
    RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:55999",
    REDIS_URL: "redis://127.0.0.1:63999/0", REDIS_HOST: "127.0.0.1", REDIS_PORT: "63999", REDIS_PASSWORD: "",
    LCSP_AGENT_SERVER_URL: runtime.agentBase, OUTBOX_POLL_INTERVAL_MS: "600000",
    LCSP_ARTIFACT_STORAGE_PATH: path.join(directory, "storage"),
    LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR: path.join(directory, "snapshot-cache"),
    LCSP_DEV_UNSAFE_TRACE: "false", LCSP_DEV_UNSAFE_UNFILTERED: "false", ORCHESTRATION_DEBUG: "false",
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "",
    GITHUB_CLI_EXECUTABLE_PATH: ghExecutable, GH_HOST: "github.com",
    GITHUB_CLI_MAX_ARCHIVE_BYTES: String(T31_ARCHIVE_MAX_BYTES),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

/**
 * Business purpose: Isolate the real API child's environment, logs and network listener.
 * Business rules: Only the exact built API entrypoint is affected; application handlers remain real.
 * Execution flow:
 * 1. Move that child to its private runtime directory before application config loads.
 * 2. Bind its designated HTTP listener to loopback and identify its health responses.
 * Failure cases: A mismatched entrypoint receives no preload changes.
 * Side effects: The owned API child's cwd, umask, listener address and response header are configured.
 */
export function apiPreloadSource(directory, apiPort, instanceNonce, apiMain = API_MAIN) {
  return [
    'import path from "node:path";',
    'import net from "node:net";',
    'import http from "node:http";',
    "if (path.resolve(process.argv[1] ?? '') === " + JSON.stringify(apiMain) + ") {",
    "  process.chdir(" + JSON.stringify(directory) + ");",
    "  process.umask(0o077);",
    "  process.env.BILLING_SEPAY_QR_URL_TEMPLATE = 'https://127.0.0.1/qr?amount={amountVnd}&content={paymentCode}';",
    "  const listen = net.Server.prototype.listen;",
    "  net.Server.prototype.listen = function (...args) {",
    "    const first = args[0];",
    "    if ((typeof first === 'number' || typeof first === 'string') && Number(first) === " + apiPort + ") {",
    "      args = [{port: " + apiPort + ", host: '127.0.0.1'}, ...args.slice(1).filter((a) => typeof a === 'function')];",
    "    } else if (first && typeof first === 'object' && Number(first.port) === " + apiPort + ") {",
    "      args[0] = {...first, host: '127.0.0.1'};",
    "    }",
    "    return listen.apply(this, args);",
    "  };",
    "  const emit = http.Server.prototype.emit;",
    "  http.Server.prototype.emit = function (event, ...args) {",
    "    if (event === 'request') args[1].setHeader('x-lcsp-pilot-instance', " + JSON.stringify(instanceNonce) + ");",
    "    return emit.call(this, event, ...args);",
    "  };",
    "}",
    "",
  ].join("\n");
}

/**
 * Business purpose: Keep private runtime credentials out of public receipts and shared paths.
 * Business rules: Runtime files must be regular files inside the owned cache, with mode0600.
 * Execution flow:
 * 1. Validate containment and reject symlinks.
 * 2. Open privately and write the intended JSON or text.
 * Failure cases: Unsafe parents, symlinks or unowned paths are rejected.
 * Side effects: Writes only an explicitly owned task-cache file.
 */
export function writePrivate(file, content, { exclusive = false } = {}) {
  const parent = realpathSync(path.dirname(file));
  const cache = realpathSync(CACHE_ROOT);
  if (!parent.startsWith(cache + path.sep)) fail("PRIVATE_CACHE_PATH_REQUIRED");
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()))
    fail("PRIVATE_FILE_SYMLINK_FORBIDDEN");
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT |
    (exclusive ? fsConstants.O_EXCL : fsConstants.O_TRUNC) | (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(file, flags, 0o600);
  try {
    chmodSync(file, 0o600);
    writeFileSync(descriptor, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  } finally { closeSync(descriptor); }
}

/**
 * Business purpose: Establish a unique owned API port without reusing a configured deployment port.
 * Business rules: Port allocation uses loopback only; an instance header later proves process ownership.
 * Execution flow:
 * 1. Ask the OS for an unused loopback port.
 * 2. Release it for the owned API child.
 * Failure cases: Network allocation errors abort preparation.
 * Side effects: Briefly opens and closes one local listener.
 */
async function freePort() {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

/**
 * Business purpose: Capture a required local command without exposing command output.
 * Business rules: No shell is used and stdout is never printed by this helper.
 * Execution flow:
 * 1. Execute the fixed executable/arguments with a bounded timeout.
 * 2. Return captured text only on success.
 * Failure cases: Any process failure becomes the supplied stable prerequisite code.
 * Side effects: Starts the requested bounded local process.
 */
function capturedCommand(executable, args, code, env, timeout = 15000) {
  const result = spawnSync(executable, args, { cwd: ROOT, env, encoding: "utf8", timeout, maxBuffer: 1048576 });
  if (result.status !== 0 || result.error) fail(code);
  return result.stdout.trim();
}

/**
 * Business purpose: Copy the approved baseline exactly into the newly created empty pilot database.
 * Business rules: No activation command, synthetic approval, customer data or queue is imported.
 * Execution flow:
 * 1. Require each allowlisted target table to be empty.
 * 2. Insert parameterized batches with faithful JSON/null/bytea encodings.
 * 3. Stage the copied frontier unfrozen within this transaction, then restore its exact original timestamp after its inherited reviews are copied.
 * 4. Commit atomically and verify exact row counts; all database triggers remain enabled.
 * Failure cases: Any mismatch rolls back the copied rows; the unique database is retained.
 * Side effects: Inserts the inherited legal/source rows into the isolated pilot database only.
 */
async function seedBaseline(stack, data) {
  await stack.q("BEGIN");
  let seedTable;
  try {
    for (const table of TABLES) {
      seedTable = table;
      const count = (await stack.q('SELECT count(*)::int AS count FROM "' + table + '"')).rows[0].count;
      if (count !== 0) fail("SEED_REQUIRES_EMPTY_LEGAL_TABLES");
      const columns = data.columns[table];
      const names = columns.map((c) => c.column_name);
      const nulls = new Map((data.encoding.jsonNullFieldsByTableRow?.[table] ?? []).map((r) => [r.rowIndex, r.columns]));
      for (let offset = 0; offset < data.tables[table].length; offset += 100) {
        const batch = data.tables[table].slice(offset, offset + 100);
        const values = batch.flatMap((row, index) => encodeSeedRow(table,
          table === "RuleSetPreparationReviewFrontier" ? {...row, frozenAt: null} : row,
          columns, nulls.get(offset + index) ?? []));
        const placeholders = batch.map((_, row) => "(" + names.map((_, column) => "$" + (row * names.length + column + 1)).join(",") + ")").join(",");
        await stack.q('INSERT INTO "' + table + '" (' + names.map((name) => '"' + name + '"').join(",") + ") VALUES " + placeholders, values);
      }
    }
    for (const frontier of data.tables.RuleSetPreparationReviewFrontier) {
      await stack.q('UPDATE "RuleSetPreparationReviewFrontier" SET "frozenAt"=$1 WHERE "preparationRunId"=$2 AND "inventoryRevision"=$3',
        [frontier.frozenAt, frontier.preparationRunId, frontier.inventoryRevision]);
    }
    await stack.q("COMMIT");
  } catch (error) {
    error.seedTable = seedTable;
    await stack.q("ROLLBACK");
    throw error;
  }
  return await verifyBaseline(stack, data.counts, data);
}

/**
 * Business purpose: Prove imported baseline identity through real persisted-integrity code.
 * Business rules: A stored digest alone is insufficient; all rule/source relationships must reconstruct.
 * Execution flow:
 * 1. Read the seeded legal rows, blobs and canonical counts.
 * 2. Reconstruct the persisted shape used by the production integrity validator.
 * 3. Require the original activation and full633/243 corpus.
 * Failure cases: Any digest, blob, count or activation mismatch blocks customer setup/resume.
 * Side effects: Read-only target-database queries and pure validator execution.
 */
export async function verifyBaseline(stack, expectedCounts, exactExport) {
  const rows = {};
  const exactCopyDigests = {};
  for (const table of TABLES) {
    const jsonColumns = (exactExport?.columns?.[table] ?? []).filter((column) => ["json", "jsonb"].includes(column.data_type));
    const nullFields = jsonColumns.flatMap((column) => ["\'" + column.column_name + "\'", 't."' + column.column_name + '" IS NULL']);
    rows[table] = (await stack.q('SELECT t.*' + (nullFields.length ? ',jsonb_build_object(' + nullFields.join(",") + ') AS "__pilotSqlNull"' : "") + ' FROM "' + table + '" t')).rows;
    if (exactExport) exactCopyDigests[table] = verifyExactTableCopy(table, rows[table], exactExport);
    for (const row of rows[table]) delete row.__pilotSqlNull;
    if (expectedCounts && rows[table].length !== expectedCounts[table]) fail("SEEDED_TABLE_COUNT_MISMATCH");
  }
  const rsv = rows.ComplianceRuleSetVersion.find((r) => r.id === PINS.ruleSetVersionId);
  if (!rsv || rsv.ruleSetDigest !== PINS.ruleSetDigest || rsv.lifecycleState !== "ACTIVE" ||
      rows.LegalRequirement.length !== 633 || rows.AssessmentRule.length !== 243)
    fail("SEEDED_BASELINE_AUTHORITY_MISMATCH");
  for (const blob of rows.LegalSourceDocumentBlob)
    if (sha(blob.bytes) !== blob.sha256 || blob.bytes.length !== blob.byteLength) fail("SEEDED_SOURCE_BLOB_MISMATCH");
  for (const chunk of rows.LegalDocumentChunk)
    if ("sha256:" + sha(chunk.content) !== chunk.contentSha256) fail("SEEDED_SOURCE_CHUNK_MISMATCH");
  const ordinal = (a, b) => a.ordinal - b.ordinal;
  const graph = rows.LegalSemanticGraph.find((r) => r.ruleSetVersionId === PINS.ruleSetVersionId);
  const inventories = rows.RuleSetPreparationClaimInventory.filter((r) => r.preparationRunId === rsv.preparationRunId).sort((a, b) => b.revision - a.revision);
  const shape = {
    ...rsv,
    rules: rows.LegalRequirement.sort(ordinal).map((r) => ({...r,
      provenance: rows.LegalRequirementProvenance.filter((p) => p.legalRequirementRowId === r.id).sort(ordinal),
      claimBindings: rows.LegalRequirementClaimBinding.filter((b) => b.legalRequirementRowId === r.id).sort(ordinal),
    })),
    assessmentRules: rows.AssessmentRule.sort(ordinal).map((r) => ({...r,
      legalRequirementLinks: rows.AssessmentRuleLegalRequirement.filter((l) => l.assessmentRuleRowId === r.id),
    })),
    contextRelations: rows.LegalRequirementContextRelation.sort(ordinal),
    semanticGraph: {...graph,
      claims: rows.LegalSemanticClaim.sort(ordinal).map((c) => ({...c,
        sources: rows.LegalSemanticClaimSource.filter((x) => x.claimId === c.claimId).sort(ordinal),
      })),
      relations: rows.LegalSemanticClaimRelation.sort(ordinal),
    },
    preparationRun: {claimInventories: inventories},
  };
  const {storedRuleSetIntegrityValid} = await import(pathToFileURL(path.join(ROOT,
    "apps/api/dist/src/modules/compliance-rule-set/infrastructure/persistence/stored-rule-set-integrity.js")).href);
  if (!storedRuleSetIntegrityValid(shape, rows.LegalDocumentChunk)) fail("SEEDED_STORED_INTEGRITY_FAILED");
  const activation = rows.ComplianceRuleSetActivationRecord;
  if (activation.length !== 1 || activation[0].ruleSetVersionId !== PINS.ruleSetVersionId ||
      activation[0].requestDigest !== PINS.ruleSetDigest || activation[0].validationOutcome !== "PASSED")
    fail("SEEDED_ACTIVATION_MISMATCH");
  return {storedIntegrityValid: true, ruleSetDigest: rsv.ruleSetDigest,
    legalRequirements: 633, assessmentRules: 243, sourceChunks: rows.LegalDocumentChunk.length,
    sourceDocuments: rows.LegalSourceDocument.length, inheritedActivationId: activation[0].id,
    counts: Object.fromEntries(TABLES.map((table) => [table, rows[table].length])),
    ...(exactExport ? {exactInheritedRowsVerified: true, exactCopyDigests} : {})};
}


/**
 * Business purpose: Compare inherited legal rows without mistaking timestamp formatting for changed data.
 * Business rules: SQL null and JSON null remain distinct; object key order is not semantic.
 * Execution flow:
 * 1. Normalize typed values from the export and PostgreSQL.
 * 2. Serialize the same ordered columns, including explicit null-kind tags.
 * Failure cases: Invalid timestamps or mismatched data cannot produce a matching digest.
 * Side effects: None; computes in-memory canonical values.
 */
function canonicalSeedValue(value, column) {
  if (value === null) return null;
  if (column.data_type === "bytea") return Buffer.isBuffer(value) ? value.toString("base64") : value;
  if (column.data_type === "date") return value instanceof Date ?
    [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-") : String(value);
  if (column.data_type.startsWith("timestamp")) return new Date(value).toISOString();
  if (["smallint", "integer", "bigint", "numeric", "real", "double precision"].includes(column.data_type))
    return String(value);
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical(v[key])])) : v;
  return canonical(value);
}

/**
 * Business purpose: Prove all imported fields exactly preserve approved baseline provenance.
 * Business rules: All29 tables are compared, including inventory, review dispositions and activation records.
 * Execution flow:
 * 1. Hash each canonical row with its SQL-null/JSON-null distinction.
 * 2. Compare sorted row digests independently of query/export ordering.
 * Failure cases: Any field, null-kind, timestamp, byte or count difference rejects the copy.
 * Side effects: None; returns a non-secret per-table digest receipt.
 */
function verifyExactTableCopy(table, actualRows, data) {
  const columns = data.columns[table];
  const expectedJsonNulls = new Map((data.encoding.jsonNullFieldsByTableRow?.[table] ?? [])
    .map((row) => [row.rowIndex, row.columns]));
  const digestRow = (row, index, actual) => sha(JSON.stringify(columns.map((column) => {
    const name = column.column_name;
    const isJson = ["json", "jsonb"].includes(column.data_type);
    const sqlNull = row[name] === null && (!isJson || (actual ?
      row.__pilotSqlNull?.[name] === true : !(expectedJsonNulls.get(index) ?? []).includes(name)));
    return [name, sqlNull ? "SQL_NULL" : "VALUE", canonicalSeedValue(row[name], column)];
  })));
  const expected = sha(data.tables[table].map((row, index) => digestRow(row, index, false)).sort().join("\n"));
  const actual = sha(actualRows.map((row, index) => digestRow(row, index, true)).sort().join("\n"));
  if (expected !== actual || actualRows.length !== data.tables[table].length) {
    try { fail("IMPORTED_ROW_FIELDS_DIFFER"); } catch (error) { error.seedTable = table; throw error; }
  }
  return {rows: actualRows.length, sha256: actual, matchesExport: true};
}

/**
 * Business purpose: Send only supported customer requests to the proven owned API instance.
 * Business rules: No redirects, no raw error bodies, and no credentials in transcripts.
 * Execution flow:
 * 1. Check the owned-instance health marker.
 * 2. Send the requested JSON with its in-memory customer session.
 * 3. Record only method, route, status and a bounded problem code.
 * Failure cases: Instance mismatch or any non-success response aborts setup.
 * Side effects: Makes the explicitly requested customer API operation.
 */
async function customerCall(runtime, transcript, route, body, session, method = "POST") {
  const health = await fetch(runtime.apiBase + "/health", {redirect: "error", signal: AbortSignal.timeout(5000)});
  if (!health.ok || health.headers.get("x-lcsp-pilot-instance") !== runtime.instanceNonce)
    fail("OWNED_API_INSTANCE_NOT_PROVEN");
  const response = await fetch(runtime.apiBase + route, {
    method, redirect: "error", signal: AbortSignal.timeout(120000),
    headers: {"content-type": "application/json", "x-lcsp-locale": "en",
      ...(session ? {authorization: "Bearer " + session} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.headers.get("x-lcsp-pilot-instance") !== runtime.instanceNonce)
    fail("OWNED_API_INSTANCE_CHANGED");
  let payload;
  try { payload = await response.json(); } catch { fail("CUSTOMER_API_INVALID_ENVELOPE"); }
  const problemCode = payload.problem?.code;
  transcript.push({method, route, status: response.status, ok: payload.ok === true,
    ...(typeof problemCode === "string" && SAFE_CODE.test(problemCode) ? {problemCode} : {})});
  if (![200, 201].includes(response.status) || payload.ok !== true)
    fail("CUSTOMER_API_REQUEST_FAILED");
  return payload.data;
}

/**
 * Business purpose: Compare the exact approved rule/version membership independently of pagination order.
 * Business rules: A full T31 pilot has243 unique nonempty identities; duplicate rules never widen scope.
 * Execution flow:
 * 1. Validate and project each supplied rule identity.
 * 2. Sort by exact identifier and return the canonical pairs for equality and hashing.
 * Failure cases: Missing fields, duplicate IDs or a changed243-rule count reject preparation.
 * Side effects: Pure validation and projection; performs no API or database operation.
 */
export function canonicalRuleIdentities(rules) {
  if (!Array.isArray(rules) || rules.length !== 243) fail("FULL_RULE_MEMBERSHIP_COUNT_MISMATCH");
  const rows = rules.map((row) => {
    if (typeof row?.assessmentRuleId !== "string" || !row.assessmentRuleId ||
        typeof row.assessmentRuleVersion !== "string" || !row.assessmentRuleVersion)
      fail("FULL_RULE_IDENTITY_INVALID");
    return [row.assessmentRuleId, row.assessmentRuleVersion];
  }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (new Set(rows.map((row) => row[0])).size !== 243) fail("FULL_RULE_IDENTITY_DUPLICATE");
  return rows;
}

/**
 * Business purpose: Freeze the previously authorized complete243-rule audit through the owner API.
 * Business rules:
 * - Setup is CUSTOMER_SELECTED with zero existing requests; full scope is an explicit FULL_RULE_SET request.
 * - Every page must retain exact baseline/source pins and the same audit revision.
 * - Catalog and submitted membership must equal the approved export identities, never a smaller sample.
 * Execution flow:
 * 1. Read every owner catalog page and verify stable identities and pagination.
 * 2. Submit the exact server revision/pins with rules:[] so the server expands the full Rule Set.
 * 3. Verify all243 returned identities and bind the private runtime to the new canonical command.
 * Failure cases: Catalog drift, malformed pagination, non-pristine state or partial membership stops preparation.
 * Side effects: The injected owner call creates one frozen audit request and its canonical outbox command.
 */
export async function requestFullRuleAudit(runtime, call, approvedRules) {
  const approved = canonicalRuleIdentities(approvedRules);
  const expected = {
    assessmentId: runtime.assessmentId, auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
    ruleSetVersionId: PINS.ruleSetVersionId, ruleSetDigest: PINS.ruleSetDigest,
    repositorySnapshotId: runtime.repositorySnapshotId, repositoryCommit: PINS.repositoryCommit,
  };
  const rows = [];
  let offset = 0;
  let revision;
  for (let pageIndex = 0; pageIndex < 243; pageIndex++) {
    const page = await call("/assessments/" + runtime.assessmentId + "/rules?offset=" + offset + "&limit=100", undefined, "GET");
    if (Object.entries(expected).some(([key, value]) => page?.[key] !== value) ||
        page.total !== 243 || page.offset !== offset || !Array.isArray(page.rules) || !page.rules.length ||
        page.latestRequestId !== null || page.latestRequestStatus !== null ||
        !Number.isInteger(page.auditRevision) || page.auditRevision !== 0 ||
        (revision !== undefined && revision !== page.auditRevision))
      fail("OWNER_RULE_CATALOG_DRIFT");
    if (page.rules.some((rule) => rule.decisionId !== null || rule.progress !== "NOT_SELECTED"))
      fail("OWNER_RULE_CATALOG_NOT_PRISTINE");
    revision = page.auditRevision;
    rows.push(...page.rules);
    if (rows.length > 243) fail("OWNER_RULE_CATALOG_OVERFLOW");
    if (page.nextOffset === null) {
      if (rows.length !== 243) fail("OWNER_RULE_CATALOG_TRUNCATED");
      break;
    }
    if (!Number.isInteger(page.nextOffset) || page.nextOffset !== offset + page.rules.length ||
        page.nextOffset >= 243) fail("OWNER_RULE_CATALOG_CONTINUATION_INVALID");
    offset = page.nextOffset;
  }
  if (JSON.stringify(canonicalRuleIdentities(rows)) !== JSON.stringify(approved))
    fail("OWNER_RULE_CATALOG_MEMBERSHIP_MISMATCH");
  const request = await call("/assessments/" + runtime.assessmentId + "/rule-audits", {
    idempotencyKey: randomUUID(), expectedAuditRevision: revision,
    ruleSetVersionId: PINS.ruleSetVersionId, ruleSetDigest: PINS.ruleSetDigest,
    repositorySnapshotId: runtime.repositorySnapshotId, repositoryCommit: PINS.repositoryCommit,
    scopeMode: RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET, rules: [],
  }, "POST");
  if (!UUID.test(request?.requestId ?? "") || request.assessmentId !== runtime.assessmentId ||
      request.scopeMode !== RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET ||
      request.status !== RULE_AUDIT_STATUSES.QUEUED || request.requestRevision !== revision + 1 ||
      request.ruleSetVersionId !== PINS.ruleSetVersionId || request.ruleSetDigest !== PINS.ruleSetDigest ||
      request.repositorySnapshotId !== runtime.repositorySnapshotId || request.repositoryCommit !== PINS.repositoryCommit ||
      request.requested !== 243 || request.totalPinned !== 243 || request.ready !== 0 || request.notRequested !== 0 ||
      JSON.stringify(canonicalRuleIdentities(request.rules)) !== JSON.stringify(approved) ||
      request.rules.some((rule) => rule.decisionId !== null || rule.progress !== "QUEUED"))
    fail("FROZEN_FULL_AUDIT_RESPONSE_MISMATCH");
  Object.assign(runtime, {
    auditRequestId: request.requestId, auditRequestRevision: request.requestRevision,
    auditScopeMode: request.scopeMode, ruleSetDigest: PINS.ruleSetDigest,
    auditRules: approved.map(([assessmentRuleId, assessmentRuleVersion]) => ({assessmentRuleId, assessmentRuleVersion})),
    auditMembershipSha256: sha(JSON.stringify(approved)),
    rootCommandKey: "rule-audit:" + request.requestId + ":start",
  });
  return request;
}

/**
 * Business purpose: Create one genuinely fresh customer assessment with the approved subtree pin.
 * Business rules: Registration, credential configuration and source setup use public APIs only.
 * Execution flow:
 * 1. Sign up/sign in a fresh local customer and re-authenticate.
 * 2. Configure the already authorized GitHub credential held only in memory.
 * 3. Connect and pin the exact repository/commit/subdirectory, then complete setup with zero coverage.
 * 4. Freeze the complete approved243-rule request through the owner catalog/audit API.
 * Failure cases: Any identity, pin or response mismatch blocks readiness.
 * Side effects: Creates new customer/setup records only in the isolated API database; reads GitHub.
 */
async function prepareCustomer(runtime, transcript, ghExecutable, commandEnv, approvedRules) {
  const password = "T31!" + randomBytes(24).toString("hex");
  const fields = {email: "lcsp-t31-" + randomBytes(10).toString("hex") + "@acceptance.invalid",
    password, display_name: "Scoped T31 pilot customer"};
  const signup = await customerCall(runtime, transcript, "/auth/sign-up", fields);
  const signin = await customerCall(runtime, transcript, "/auth/sign-in", {email: fields.email, password});
  const session = signin.session_token;
  if (typeof session !== "string" || !session) fail("CUSTOMER_SESSION_REQUIRED");
  runtime.customerUserId = signup.user_id ?? signin.user_id;
  await customerCall(runtime, transcript, "/auth/re-auth/password", {password}, session);
  let credential = capturedCommand(ghExecutable, ["auth", "token", "--hostname", "github.com"],
    "GITHUB_AUTH_REQUIRED", commandEnv);
  if (!credential) fail("GITHUB_AUTH_REQUIRED");
  try {
    await customerCall(runtime, transcript, "/provider-credentials", {provider: "GITHUB", credential}, session);
  } finally { credential = ""; }
  const created = await customerCall(runtime, transcript, "/assessments", {
    name: "T31 scoped bounded pilot",
    description: "Fresh controlled pilot for the approved chatbot subdirectory at the exact pinned commit. No inherited customer operational facts; not a certified legal reassessment.",
  }, session);
  runtime.assessmentId = created.assessment_id;
  if (!UUID.test(runtime.assessmentId ?? "") || runtime.assessmentId === PINS.originalAssessmentId)
    fail("FRESH_ASSESSMENT_REQUIRED");
  const prefix = "/assessments/" + runtime.assessmentId;
  const connection = await customerCall(runtime, transcript, prefix + "/repository-connection",
    {repositoryUrl: "https://github.com/" + PINS.repositoryFullName}, session);
  if (connection.repositoryFullName !== PINS.repositoryFullName) fail("REPOSITORY_CONNECTION_MISMATCH");
  const snapshot = await customerCall(runtime, transcript, prefix + "/snapshots", {
    connection_id: connection.connectionId, branch: "main",
    commit_sha: PINS.repositoryCommit, source_path_prefix: PINS.sourcePathPrefix,
  }, session);
  if (snapshot.repository_full_name !== PINS.repositoryFullName ||
      snapshot.commit_sha !== PINS.repositoryCommit || snapshot.source_path_prefix !== PINS.sourcePathPrefix)
    fail("SNAPSHOT_SCOPE_PIN_MISMATCH");
  runtime.repositorySnapshotId = snapshot.snapshot_id;
  const completed = await customerCall(runtime, transcript, prefix + "/repository-setup/complete",
    {responseLanguage: "en"}, session);
  if (completed.snapshot_id !== runtime.repositorySnapshotId) fail("SETUP_SNAPSHOT_MISMATCH");
  const detail = await customerCall(runtime, transcript, prefix, undefined, session, "GET");
  runtime.repositoryScanJobId = detail.case?.repositoryScanJobId;
  if (detail.case?.repositorySnapshotId !== runtime.repositorySnapshotId ||
      detail.case?.repositoryCommit !== PINS.repositoryCommit ||
      detail.case?.ruleSetVersionId !== PINS.ruleSetVersionId ||
      detail.case?.coverage?.length !== 0 || detail.case?.caseRevision !== 0 ||
      detail.case?.auditMode !== ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED ||
      (detail.case?.facts ?? []).length || (detail.case?.evidence ?? []).length)
    fail("CUSTOMER_CASE_PIN_MISMATCH");
  if (detail.owner_id !== runtime.customerUserId) fail("CUSTOMER_OWNERSHIP_MISMATCH");
  await requestFullRuleAudit(runtime,
    (route, body, method) => customerCall(runtime, transcript, route, body, session, method), approvedRules);
  runtime.customerSessionToken = session;
  validateRuntime(runtime);
}

/**
 * Business purpose: Prove setup did not inherit or generate customer facts and decisions.
 * Business rules: Preparation requires a new zero-revision case; resume preserves existing pilot work.
 * Execution flow:
 * 1. Read the exact case and snapshot pins.
 * 2. Check persisted source scope, exact frozen audit membership, canonical outbox command and counts.
 * Failure cases: A changed pin, historical ID or non-pristine new case blocks readiness.
 * Side effects: Read-only target-database queries.
 */
async function verifyCase(stack, runtime, pristine) {
  validateRuntime(runtime);
  const result = await stack.q(
    'SELECT c.*,s."repositoryFullName",s."sourcePathPrefix" FROM "AssessmentCase" c JOIN "RepositorySnapshot" s ON s.id=c."repositorySnapshotId" WHERE c."assessmentId"=$1',
    [runtime.assessmentId]);
  if (result.rowCount !== 1) fail("PILOT_CASE_NOT_FOUND");
  const c = result.rows[0];
  if (c.repositorySnapshotId !== runtime.repositorySnapshotId || c.repositoryScanJobId !== runtime.repositoryScanJobId ||
      c.repositoryCommit !== PINS.repositoryCommit || c.ruleSetVersionId !== PINS.ruleSetVersionId ||
      c.repositoryFullName !== PINS.repositoryFullName ||
      c.sourcePathPrefix !== PINS.sourcePathPrefix) fail("PERSISTED_SCOPE_PIN_MISMATCH");
  const counts = {};
  for (const table of ["AssessmentCaseFact", "AssessmentRuleDecision", "AssessmentEvidence", "AssessmentDecisionCoverage"])
    counts[table] = (await stack.q('SELECT count(*)::int AS count FROM "' + table + '" WHERE "assessmentId"=$1',
      [runtime.assessmentId])).rows[0].count;
  if (counts.AssessmentDecisionCoverage !== 243 ||
      (pristine && (counts.AssessmentCaseFact !== 0 || counts.AssessmentRuleDecision !== 0 ||
        counts.AssessmentEvidence !== 0 || c.caseRevision !== 0))) fail("PILOT_NOT_PRISTINE");
  if (c.auditMode !== ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED ||
      c.auditRequestRevision !== runtime.auditRequestRevision) fail("PERSISTED_AUDIT_REVISION_MISMATCH");
  const audit = (await stack.q(
    'SELECT * FROM "AssessmentRuleAuditRequest" WHERE "requestId"=$1 AND "assessmentId"=$2',
    [runtime.auditRequestId, runtime.assessmentId])).rows[0];
  const members = (await stack.q(
    'SELECT "assessmentRuleId","assessmentRuleVersion" FROM "AssessmentRuleAuditItem" WHERE "requestId"=$1',
    [runtime.auditRequestId])).rows;
  const coverage = (await stack.q(
    'SELECT "assessmentRuleId","assessmentRuleVersion" FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=$1',
    [runtime.assessmentId])).rows;
  const expectedMembers = JSON.stringify(canonicalRuleIdentities(runtime.auditRules));
  if (!audit || audit.scopeMode !== RULE_AUDIT_SCOPE_MODES.FULL_RULE_SET ||
      audit.ruleSetVersionId !== PINS.ruleSetVersionId || audit.ruleSetDigest !== PINS.ruleSetDigest ||
      audit.repositorySnapshotId !== runtime.repositorySnapshotId || audit.repositoryCommit !== PINS.repositoryCommit ||
      audit.requestRevision !== runtime.auditRequestRevision ||
      (pristine && audit.status !== RULE_AUDIT_STATUSES.QUEUED) ||
      JSON.stringify(canonicalRuleIdentities(members)) !== expectedMembers ||
      JSON.stringify(canonicalRuleIdentities(coverage)) !== expectedMembers)
    fail("PERSISTED_FULL_AUDIT_MEMBERSHIP_MISMATCH");
  const commands = (await stack.q(
    'SELECT id,payload FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"=$2 AND payload->>\'idempotencyKey\'=$3',
    [runtime.assessmentId, ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED, runtime.rootCommandKey])).rows;
  if (commands.length !== 1 || commands[0].payload.assessmentId !== runtime.assessmentId ||
      commands[0].payload.auditRequestId !== runtime.auditRequestId) fail("CANONICAL_ROOT_COMMAND_REQUIRED");
  runtime.rootCommandPayload = commands[0].payload;
  runtime.rootCommandId = commands[0].id;
  return {caseRevision: c.caseRevision, ...counts, sourcePathPrefix: c.sourcePathPrefix,
    auditRequestId: runtime.auditRequestId, scopeMode: audit.scopeMode,
    ruleMembershipSha256: runtime.auditMembershipSha256, canonicalCommandId: runtime.rootCommandId};
}

/**
 * Business purpose: Prepare or restart only an owned isolated no-provider pilot stack.
 * Business rules:
 * - Preparation is create-only; resume requires a private saved manifest and existing databases.
 * - The fixed 256 MiB compressed-archive cap is recorded in both private runtime and safe public receipts.
 * Execution flow:
 * 1. Validate reviewed export or existing runtime and establish private environment files.
 * 2. Start the real built API with explicit local database settings.
 * 3. Copy/verify baseline, perform supported fresh setup, and save private/public receipts.
 * 4. Stop preparation's API; resume serves only for its bounded requested duration.
 * Failure cases: Stable sanitized failure codes are emitted; created databases are preserved, never reset.
 * Side effects: Creates isolated databases on prepare, starts/stops its own API, and writes private cache state.
 */
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs({args: argv, allowPositionals: true, options: {
    export: {type: "string"}, "export-sha256": {type: "string"}, runtime: {type: "string"},
    "db-port": {type: "string"}, "api-port": {type: "string"}, "agent-port": {type: "string"}, "serve-seconds": {type: "string"},
    "github-cli": {type: "string"},
  }});
  const mode = parsed.positionals[0] ?? "prepare";
  if (!["prepare", "resume", "check-export"].includes(mode) || parsed.positionals.length > 1)
    fail("INVALID_OPERATOR_MODE");
  const serveSeconds = Number(parsed.values["serve-seconds"] ?? 600);
  if (mode === "resume" && (!Number.isInteger(serveSeconds) || serveSeconds < 1 || serveSeconds > 3600))
    fail("INVALID_SERVE_DURATION");
  const exportFile = path.resolve(parsed.values.export ?? DEFAULT_EXPORT);
  const exportDigest = parsed.values["export-sha256"] ?? DEFAULT_EXPORT_SHA256;
  let corpus;
  if (mode !== "resume") {
    corpus = validateBaselineExport(readFileSync(exportFile), exportDigest);
    if (mode === "check-export") {
      const result = {status: "BASELINE_EXPORT_VERIFIED", sha256: exportDigest,
        legalRequirements: 633, assessmentRules: 243, tableCount: TABLES.length,
        candidateIncluded: false, providerCalls: 0, databaseWrites: 0};
      console.log(JSON.stringify(result));
      return result;
    }
  }
  process.umask(0o077);
  mkdirSync(CACHE_ROOT, {recursive: true});
  let directory, runtime;
  if (mode === "resume") {
    if (!parsed.values.runtime) fail("PRIVATE_RUNTIME_REQUIRED");
    const requested = path.resolve(parsed.values.runtime);
    if (lstatSync(requested).isSymbolicLink()) fail("PRIVATE_FILE_SYMLINK_FORBIDDEN");
    const file = realpathSync(requested);
    if (!file.startsWith(realpathSync(CACHE_ROOT) + path.sep) ||
        !lstatSync(file).isFile() || lstatSync(file).mode & 0o077) fail("PRIVATE_RUNTIME_MODE_REQUIRED");
    directory = path.dirname(file);
    runtime = validateRuntime(JSON.parse(readFileSync(file, "utf8")));
    if (!["PREPARED_NO_PROVIDER", "API_STOPPED", "API_RUNNING_NO_PROVIDER"].includes(runtime.status))
      fail("PREPARED_RUNTIME_REQUIRED");
  } else {
    const nonce = Date.now().toString(36) + "_" + randomBytes(6).toString("hex");
    directory = path.join(CACHE_ROOT, "scoped-pilot-" + nonce);
    mkdirSync(directory, {mode: 0o700});
    const dbPort = Number(parsed.values["db-port"] ?? 64303);
    runtime = {
      manifestVersion: "T31_SCOPED_PILOT_RUNTIME_V2", status: "PREPARING_NO_PROVIDER",
      database: "lcsp360_final_t31_" + nonce, checkpointDatabase: "lcsp_assessment_t31_" + nonce,
      dbPort, ruleSetVersionId: PINS.ruleSetVersionId, repositoryFullName: PINS.repositoryFullName,
      repositoryCommit: PINS.repositoryCommit, sourcePathPrefix: PINS.sourcePathPrefix,
      baselineExportSha256: exportDigest, createdAt: new Date().toISOString(), providerCalls: 0,
    };
  }
  runtime.apiPort = Number(parsed.values["api-port"] ?? (mode === "resume" ? runtime.apiPort : await freePort()));
  runtime.apiBase = "http://127.0.0.1:" + runtime.apiPort;
  runtime.agentPort = Number(parsed.values["agent-port"] ?? runtime.agentPort ?? await freePort());
  runtime.agentBase = "http://127.0.0.1:" + runtime.agentPort;
  runtime.checkpointDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:" + runtime.dbPort + "/" + runtime.checkpointDatabase;
  runtime.instanceNonce = randomBytes(20).toString("hex");
  runtime.archiveMaxBytes = T31_ARCHIVE_MAX_BYTES;
  runtime.bootstrapReceipt = path.join(directory, "bootstrap-receipt.json");
  const {startStack, workerKey} = await import("../tests/support/compliance-rule-set-stack.mjs");
  runtime.workerKey = workerKey;
  validateRuntime(runtime, {requireAssessment: mode === "resume"});
  const ambient = {...process.env};
  const baseCommandEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]
    .filter((key) => ambient[key] !== undefined).map((key) => [key, ambient[key]]));
  const ghExecutable = parsed.values["github-cli"] ? path.resolve(parsed.values["github-cli"]) :
    runtime.githubCliExecutable ?? capturedCommand("which", ["gh"], "GITHUB_CLI_REQUIRED", baseCommandEnv);
  if (!path.isAbsolute(ghExecutable) || !existsSync(ghExecutable)) fail("GITHUB_CLI_REQUIRED");
  if (!existsSync(API_MAIN)) fail("API_BUILD_REQUIRED");
  const {assertGitHubCliRuntime} = await import(pathToFileURL(path.join(ROOT,
    "apps/api/dist/src/modules/github-integration/infrastructure/github/github-cli-runtime.validator.js")).href);
  try { assertGitHubCliRuntime(ghExecutable, {cwd: directory}); }
  catch { fail("SUPPORTED_GITHUB_CLI_REQUIRED"); }
  runtime.githubCliExecutable = ghExecutable;
  const preload = path.join(directory, "api-isolation-preload.mjs");
  writePrivate(preload, apiPreloadSource(directory, runtime.apiPort, runtime.instanceNonce));
  for (const name of [".env", ".env.test", ".env.pm2"])
    writePrivate(path.join(directory, name), "# Isolated pilot: configuration comes from explicit process environment.\n");
  writePrivate(path.join(directory, "pnpm-workspace.yaml"), "packages: []\n");
  for (const name of ["storage", "snapshot-cache", "tmp"]) mkdirSync(path.join(directory, name), {recursive: true, mode: 0o700});
  const env = isolatedEnvironment(ambient, runtime, directory, preload, ghExecutable);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  const privatePath = path.join(directory, "private-runtime.json");
  writePrivate(privatePath, runtime);
  const requireApi = createRequire(path.join(ROOT, "apps/api/package.json"));
  const {Client} = requireApi("pg");
  const admin = new Client({connectionString: "postgresql://postgres:postgres@127.0.0.1:" + runtime.dbPort + "/postgres",
    connectionTimeoutMillis: 5000, query_timeout: 5000});
  let stack;
  let phase = "POSTGRES_CONNECT";
  const transcript = [];
  const controller = new AbortController();
  let summary = {mode, providerCalls: 0, candidateActivated: false, originalAssessmentTouched: false,
    privateRuntime: privatePath, baselineExportSha256: runtime.baselineExportSha256,
    archiveMaxBytes: runtime.archiveMaxBytes};
  try {
    try { await admin.connect(); } catch { fail("LOOPBACK_POSTGRES_UNAVAILABLE"); }
    phase = "DATABASE_NAME_GUARD";
    if (mode === "prepare") await assertDatabaseNamesAvailable(admin.query.bind(admin), runtime);
    else {
      const existing = await admin.query("SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
        [[runtime.database, runtime.checkpointDatabase]]);
      if (existing.rowCount !== 2) fail("RESUME_DATABASE_MISSING");
    }
    await admin.end();
    phase = "REAL_API_START";
    stack = await startStack({database: runtime.database, checkpointDatabase: runtime.checkpointDatabase,
      apiPort: runtime.apiPort, dbPort: runtime.dbPort, resetDatabase: false,
      createOnlyDatabase: mode === "prepare", signal: controller.signal, operationTimeoutMs: 120000});
    const health = await fetch(runtime.apiBase + "/health", {redirect: "error", signal: AbortSignal.timeout(5000)});
    if (!health.ok || health.headers.get("x-lcsp-pilot-instance") !== runtime.instanceNonce)
      fail("OWNED_API_INSTANCE_NOT_PROVEN");
    phase = "BASELINE_SEED_INTEGRITY";
    const baselineProof = mode === "prepare" ? await seedBaseline(stack, corpus) : await verifyBaseline(stack);
    phase = "SUPPORTED_CUSTOMER_SETUP";
    if (mode === "prepare") await prepareCustomer(runtime, transcript, ghExecutable, baseCommandEnv, corpus.tables.AssessmentRule);
    phase = "PERSISTED_CASE_VERIFICATION";
    const caseProof = await verifyCase(stack, runtime, mode === "prepare");
    runtime.status = mode === "prepare" ? "PREPARED_NO_PROVIDER" : "API_RUNNING_NO_PROVIDER";
    runtime.updatedAt = new Date().toISOString();
    writePrivate(privatePath, runtime);
    summary = {...summary, status: runtime.status, apiBase: runtime.apiBase, database: runtime.database,
      checkpointDatabase: runtime.checkpointDatabase, assessmentId: runtime.assessmentId,
      repositorySnapshotId: runtime.repositorySnapshotId, repositoryScanJobId: runtime.repositoryScanJobId,
      repositoryFullName: runtime.repositoryFullName, repositoryCommit: runtime.repositoryCommit,
      sourcePathPrefix: runtime.sourcePathPrefix, ruleSetVersionId: runtime.ruleSetVersionId,
      auditRequestId: runtime.auditRequestId, auditScopeMode: runtime.auditScopeMode,
      auditMembershipSha256: runtime.auditMembershipSha256, agentBase: runtime.agentBase,
      nativeAgentAdmission: "REQUIRED_BEFORE_DISPATCH", baselineProof, caseProof, customerApiTranscript: transcript,
      noProviderDispatch: true, outboxBroker: "UNREACHABLE_LOOPBACK",
      redis: "LOOPBACK_ONLY_NOT_REQUIRED_BY_API_BOOTSTRAP", dockerRequiredForModelDispatch: true};
    writePrivate(runtime.bootstrapReceipt, summary);
    console.log(JSON.stringify(summary));
    if (mode === "resume") {
      const seconds = serveSeconds;
      await new Promise((resolve) => {
        const finish = () => {clearTimeout(timer);process.removeListener("SIGINT", finish);process.removeListener("SIGTERM", finish);resolve();};
        const timer = setTimeout(finish, seconds * 1000);
        process.once("SIGINT", finish);process.once("SIGTERM", finish);
      });
      runtime.status = "API_STOPPED";
      writePrivate(privatePath, runtime);
    }
    return summary;
  } catch (error) {
    const code = SAFE_CODE.test(error?.operatorCode ?? "") ? error.operatorCode : "BOOTSTRAP_FAILED";
    runtime.status = mode === "resume" ? "API_STOPPED" : "PREPARATION_BLOCKED";
    writePrivate(privatePath, runtime);
    writePrivate(runtime.bootstrapReceipt, {...summary, status: "BLOCKED", code, phase,
      seedTable: TABLES.includes(error?.seedTable) ? error.seedTable : null,
      errorName: /^[A-Za-z]{1,40}$/.test(error?.name ?? "") ? error.name : "Error",
      errorCode: /^[A-Z0-9_]{1,50}$/.test(error?.code ?? "") ? error.code : null,
      stackLocations: String(error?.stack ?? "").split("\n").slice(1).filter((line) => /^\s*at /.test(line)).slice(0, 5),
      customerApiTranscript: transcript,
      databasesPreserved: true, providerCalls: 0});
    fail(code);
  } finally {
    try { await admin.end(); } catch { /* Already closed. */ }
    if (stack) await stack.stop();
    for (const key of Object.keys(process.env)) if (!(key in ambient)) delete process.env[key];
    Object.assign(process.env, ambient);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = SAFE_CODE.test(error?.operatorCode ?? "") ? error.operatorCode : "BOOTSTRAP_FAILED";
    console.log(JSON.stringify({status: "BLOCKED", code, providerCalls: 0, noResetOrDropPerformed: true}));
    process.exitCode = 1;
  });
}