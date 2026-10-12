#!/usr/bin/env node
// User-run Playwright acceptance driver for ONE owned disposable staging run (see tests/staging-stack.py).
// Every product interaction is a real browser action; SQL/docker are used only for preconditions and
// post-action verification and are recorded as BACKEND_VERIFICATION, never as UI evidence.
// Usage: node tests/staging-browser-flow.mjs <runId> <phase> [args...]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright"));

export const KINDS = { action: "UI_ACTION", observation: "UI_OBSERVATION", backend: "BACKEND_VERIFICATION" };
const [runId, phaseName, ...phaseArgs] = process.argv.slice(2);
if (!/^[0-9a-f]{16}$/.test(runId ?? "")) throw new Error("owned staging run ID required");
const prefix = `lcsp-release-staging-${runId}`;
const privateDir = path.join(ROOT, "tmp/staging", runId);
const evidenceDir = path.join(ROOT, "reports/staging", runId);
const receiptPath = path.join(evidenceDir, "browser-full-flow.json");
const statePath = path.join(privateDir, "browser-state.json");
const access = JSON.parse(readFileSync(path.join(privateDir, "access.json"), "utf8"));
const stagingReceipt = JSON.parse(readFileSync(path.join(evidenceDir, "report.json"), "utf8"));
const candidateId = path.basename(path.dirname(stagingReceipt.imageReceipt));
if (!["READY_FOR_ACCEPTANCE", "PASS"].includes(stagingReceipt.status) || stagingReceipt.runId !== runId || !/^\d{14}_[a-f0-9]{12}$/.test(candidateId))
  throw new Error("accepted exact-candidate staging receipt required");
mkdirSync(path.join(evidenceDir, "screenshots"), { recursive: true });
mkdirSync(path.join(privateDir, "aria"), { recursive: true });
mkdirSync(path.join(privateDir, "sessions"), { recursive: true });
mkdirSync(path.join(privateDir, "downloads"), { recursive: true });

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const state = readJson(statePath, {});
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
const receipt = readJson(receiptPath, {
  scope: "EXACT_IMAGE_PLAYWRIGHT_FULL_FLOW", runId, candidateId, workers: 1, imageReceipt: stagingReceipt.imageReceipt, status: "IN_PROGRESS", phases: {},
  note: "UI_ACTION and UI_OBSERVATION were performed/observed in Playwright; BACKEND_VERIFICATION is SQL/docker only.",
});
if (receipt.candidateId !== candidateId) throw new Error("browser receipt candidate mismatch");
const phaseId = `${phaseName}-${phaseArgs[0]?.replace(/[^a-zA-Z0-9_-]/g, "_") ?? "default"}-${Date.now()}`;
const phase = (receipt.phases[phaseId] = { name: phaseName, args: phaseArgs, startedAt: new Date().toISOString(), steps: [], console: [], failedRequests: [], abortedRequests: [], apiStatuses: [], navigations: [], screenshots: [] });
const saveReceipt = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");

export function record(kind, name, detail = {}) {
  phase.steps.push({ at: new Date().toISOString(), kind, name, ...detail });
  console.log(`${kind} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail).slice(0, 220) : ""}`);
  saveReceipt();
}
const must = (condition, reason) => { if (!condition) { record("FAILURE", reason); throw new Error(reason); } };

export function sql(query, database = "lcsp_staging") {
  return execFileSync("docker", ["exec", "-i", `${prefix}-postgres`, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"],
    { input: query, encoding: "utf8" }).trim();
}
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";

const openBrowsers = [];
async function open(role, { fresh = false } = {}) {
  const browser = await chromium.launch();
  openBrowsers.push(browser);
  const storage = path.join(privateDir, "sessions", `${role}.json`);
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true,
    ...(!fresh && existsSync(storage) ? { storageState: storage } : {}) });
  const page = await context.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) phase.console.push({ role, type: m.type(), text: m.text().slice(0, 300), page: new URL(page.url() || "about:blank", access.web).pathname }); });
  page.on("requestfailed", (r) => {
    const item = { role, method: r.method(), path: new URL(r.url()).pathname, error: r.failure()?.errorText };
    (item.error === "net::ERR_ABORTED" ? phase.abortedRequests : phase.failedRequests).push(item);
  });
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) phase.apiStatuses.push({ role, method: r.request().method(), path: u.pathname, status: r.status() }); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) phase.navigations.push({ role, path: new URL(f.url()).pathname }); });
  return { browser, context, page, role, storage };
}

async function shot(session, name) {
  const file = `${phaseId}-${session.role}-${name}.png`;
  await session.page.screenshot({ path: path.join(evidenceDir, "screenshots", file), fullPage: true });
  phase.screenshots.push(`screenshots/${file}`);
  return file;
}
async function aria(session, name) {
  const text = await session.page.locator("body").ariaSnapshot();
  const file = path.join(privateDir, "aria", `${phaseId}-${session.role}-${name}.txt`);
  writeFileSync(file, text);
  (phase.snapshots ??= []).push(path.relative(ROOT, file));
  saveReceipt();
  return text;
}

async function login(session, { reuse = true } = {}) {
  const { page, role } = session;
  if (reuse && existsSync(session.storage)) {
    await page.goto(access.web + "/workspace");
    if (!page.url().includes("/sign-in")) { record(KINDS.observation, `${role} session reused`, { path: new URL(page.url()).pathname }); return; }
  }
  await page.goto(access.web + "/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(access.accounts[role].email);
  await page.getByRole("textbox", { name: "Password" }).fill(access.accounts[role].password);
  record(KINDS.action, `${role} submits sign-in form`);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }), page.getByRole("button", { name: "Sign in" }).click()]);
  record(KINDS.observation, `${role} authenticated`, { landedOn: new URL(page.url()).pathname });
  await session.context.storageState({ path: session.storage });
}

async function finish(session, status) {
  phase.finishedAt = new Date().toISOString();
  phase.status = status;
  phase.consoleErrorCount = phase.console.filter((c) => c.type === "error").length;
  saveReceipt();
  await session.browser.close();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The assessment page keeps a live stream open, so networkidle never fires; wait for the loading state to clear.
async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("Loading assessment…").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(750);
}
const LEGAL_THREAD_NAMESPACE = "b7b26975-09de-44e5-a7d5-c996523fd289";
function uuid5(name, namespace) {
  const hash = createHash("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}


// What an owner can see on the assessment page right now.
async function view(page) {
  const main = page.locator("[data-assessment-id][data-lifecycle-state]").first();
  if (!(await main.count()))
    return { surface: (await page.locator("[data-surface='repository-setup']").count()) ? "repository-setup" : "other" };
  const attrs = await main.evaluate((el) => ({ lifecycle: el.dataset.lifecycleState, execution: el.dataset.executionState }));
  return {
    surface: "assessment", ...attrs,
    forms: await page.locator("[data-human-request][data-request-state='OPEN']").count(),
    activity: await page.locator("[data-slot='work-disclosure'] > summary").allInnerTexts(),
    decisions: await page.locator("[data-decision-id]").count(),
    stop: await page.getByRole("button", { name: "Stop", exact: true }).count(),
    resume: await page.locator("[data-runtime-action='continue']").count(),
    report: await page.locator("[data-assessment-id] [data-report-action='download']").count(),
  };
}

// Poll the live page (the app streams updates; a reload every minute is a UI action too) until `done`.
async function waitView(s, done, { timeoutMs, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = "", lastReload = Date.now(), current;
  while (Date.now() < deadline) {
    current = await view(s.page);
    const key = JSON.stringify(current);
    if (key !== last) { last = key; console.log(`  ${label}: ${key.slice(0, 260)}`); }
    if (done(current)) return current;
    if (Date.now() - lastReload > 60000) { await s.page.reload(); await settle(s.page); lastReload = Date.now(); }
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label}; last view ${JSON.stringify(current)}`);
}

// Ordered tool calls/results the Root made on its native checkpoint thread (read from LangGraph's own tables).
const TIMELINE_SCRIPT = `
import os, sys, json, psycopg
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
serde = JsonPlusSerializer()
with psycopg.connect(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as conn:
    rows = conn.execute("SELECT checkpoint_id, idx, type, blob FROM checkpoint_writes WHERE thread_id=%s AND channel='messages' ORDER BY checkpoint_id, idx", (sys.argv[1],)).fetchall()
out = []
for _cp, _idx, typ, blob in rows:
    val = serde.loads_typed((typ, bytes(blob)))
    for m in (val if isinstance(val, list) else [val]):
        kind = type(m).__name__
        if kind == "AIMessage":
            out.extend({"kind": "call", "tool": c["name"], "id": c["id"]} for c in (m.tool_calls or []))
        elif kind == "ToolMessage":
            out.append({"kind": "result", "tool": m.name, "status": getattr(m, "status", None), "chars": len(str(m.content))})
print(json.dumps(out))
`;
function rootTimeline(threadId) {
  const raw = execFileSync("docker", ["exec", "-i", `${prefix}-server`, "python", "-", threadId], { input: TIMELINE_SCRIPT, encoding: "utf8" });
  return JSON.parse(raw.trim().split("\n").pop());
}
const runtimeRow = (assessmentId) => JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT a."lifecycleState",r."executionState",r."threadId",r."currentExecutionId",r."eventSequence",(SELECT count(*) FROM "AssessmentRuntime" WHERE "assessmentId"=a.id) "runtimeRows" FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id WHERE a.id=${q(assessmentId)}) r;`));

async function pauseThroughUi(s, key) {
    const { page } = s;
    const { assessmentId } = state[key];
    const before = runtimeRow(assessmentId);
    record(KINDS.backend, "runtime before Stop", before);
    await shot(s, "running");
    record(KINDS.action, "owner clicks Stop");
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/runtime/stop") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Stop", exact: true }).click(),
    ]);
    must(response.ok(), `Stop rejected with HTTP ${response.status()}`);
    record(KINDS.observation, "Stop accepted", { status: response.status() });
    const paused = await waitView(s, (v) => (v.lifecycle === "PAUSED" && v.execution === "PAUSED") || v.lifecycle === "COMPLETE" || v.execution === "FAILED", { timeoutMs: 3 * 60000, label: "PAUSED" });
    must(paused.lifecycle === "PAUSED" && paused.execution === "PAUSED", `execution became terminal before the requested pause: ${JSON.stringify(paused)}`);
    await shot(s, "paused");
    record(KINDS.observation, "UI shows PAUSED with a Continue control", paused);
    await page.reload();
    await settle(page);
    const reloaded = await view(page);
    must(reloaded.lifecycle === "PAUSED" && reloaded.execution === "PAUSED" && reloaded.resume === 1, `PAUSED did not survive reload: ${JSON.stringify(reloaded)}`);
    await shot(s, "paused-after-reload");
    record(KINDS.observation, "PAUSED persists after reload", reloaded);
    const runtime = runtimeRow(assessmentId);
    const checkpoints = Number(sql(`SELECT count(*) FROM checkpoints WHERE thread_id=${q(runtime.threadId)};`, "lcsp_langgraph"));
    must(runtime.threadId === before.threadId && runtime.runtimeRows === 1 && runtime.executionState === "PAUSED", "persisted PAUSED projection mismatch");
    state[key].stop = { threadId: runtime.threadId, executionId: runtime.currentExecutionId, checkpoints };
    saveState();
    record(KINDS.backend, "persisted PAUSED projection on the same thread with native checkpoints", { runtime, nativeCheckpointCount: checkpoints });
 }

// Reload the page until `read` returns a truthy value or the deadline passes (reload is itself a UI action).
async function reloadUntil(session, read, { timeoutMs, intervalMs = 15000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    await session.page.reload();
    await session.page.waitForLoadState("networkidle").catch(() => {});
    last = await read();
    if (last.done) return last;
    console.log(`  waiting for ${label}: ${JSON.stringify(last.view)}`);
    await sleep(intervalMs);
  }
  return { ...last, done: false, timedOut: true };
}

const PHASES = {
  async "admin-retry"() {
    const mode = phaseArgs[0] ?? "supersession";
    const attempt = state.legalAttempts?.[mode];
    must(Boolean(attempt), "failed preparation identity is required");
    const s = await open("admin");
    await login(s);
    await s.page.goto(access.web + "/admin/compliance-rule-sets");
    const before = await s.page.locator("[data-compliance-rule-set-active]").getAttribute("data-compliance-rule-set-active");
    const failed = s.page.locator("[data-preparation-state='FAILED']").first();
    await failed.waitFor();
    await shot(s, "failed-preserves-active");
    record(KINDS.observation, "failed next preparation preserves the shared ACTIVE rule set", { active: before });
    record(KINDS.action, "administrator retries the failed run through its bounded recovery action", { preparationRunId: attempt.preparationRunId });
    const [response] = await Promise.all([
      s.page.waitForResponse(r => new URL(r.url()).pathname.endsWith(`/preparations/${attempt.preparationRunId}/retries`) && r.request().method() === "POST"),
      failed.getByRole("button", { name: "Retry failed Rule Set Preparation", exact: true }).click(),
    ]);
    must(response.status() === 202, `bounded retry rejected: HTTP ${response.status()}`);
    const body = await response.json();
    must(body.ok && body.data.preparationRunId !== attempt.preparationRunId, "retry did not create a new bounded attempt");
    state.legalAttempts[mode] = { ...attempt, preparationRunId: body.data.preparationRunId, previousFailedRunId: attempt.preparationRunId };
    saveState();
    record(KINDS.observation, "bounded retry accepted for the same Legal Source Version", { preparationRunId: body.data.preparationRunId });
    await shot(s, "retry-accepted");
    await finish(s, "PASS");
  },
  // The browser observes automatic preparation after governed Legal Source activation.
  async "admin-legal"() {
    const mode = phaseArgs[0] ?? "initial";
    must(["initial", "supersession"].includes(mode), "unknown rule set preparation scenario");
    const priorAttempt = state.legalAttempts?.[mode];
    const priorRuleSetExists = priorAttempt && Number(sql(`SELECT count(*) FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=${q(priorAttempt.preparationRunId)};`)) === 1;
    const legalSource = JSON.parse(readFileSync(path.join(privateDir, `legal-source-precondition${mode === "initial" ? "" : `-${mode}`}.json`), "utf8"));
    const s = await open("admin");
    await login(s);
    const { page } = s;
    await page.goto(access.web + "/admin/compliance-rule-sets");
    await page.waitForLoadState("networkidle");
    const controls = [
      ...(await page.getByRole("button").allInnerTexts()),
      ...(await page.getByRole("link").allInnerTexts()),
      ...(await page.getByRole("menuitem").allInnerTexts()),
    ].map((text) => text.trim()).filter(Boolean);
    const forbidden = controls.filter((text) => /approv|publish|discard|reject|sign.?off|review/i.test(text));
    must(forbidden.length === 0, `human approval control rendered: ${forbidden.join(", ")}`);
    record(KINDS.observation, "Compliance Rule Set page renders no approve/publish/discard/review control", { controls });
    must(await page.getByRole("button", { name: /start preparation/i }).count() === 0 && await page.getByRole("combobox").count() === 0, "generic Admin Start or source selection is present");
    const before = await page.locator("[data-compliance-rule-set-active]").getAttribute("data-compliance-rule-set-active");
    must(priorAttempt || (mode === "initial" ? before === "NONE" : before !== "NONE"), `unexpected ACTIVE precondition: ${before}`);
    const historyBefore = await page.locator("[data-rule-set-state]").allInnerTexts();
    const runCountBefore = await page.locator("[data-preparation-state]").count();
    record(KINDS.observation, "canonical ACTIVE state before preparation", { mode, label: before });
    await shot(s, "before-start");
    await aria(s, "before-start");

    execFileSync(path.join(ROOT, "deepagents/.venv/bin/python"), ["tests/staging-legal-evidence.py", runId, "activate", mode], { cwd: ROOT, encoding: "utf8" });
    record(KINDS.backend, "Legal Source activation and idempotent replay use the governed API", { version: legalSource.version });
    let preparationRunId = priorAttempt?.preparationRunId;
    const deliveryDeadline = Date.now() + 60000;
    while (!preparationRunId && Date.now() < deliveryDeadline) {
      const runs = JSON.parse(sql(`SELECT coalesce(json_agg(id),'[]') FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"=${q(legalSource.legalSourceVersionId)};`));
      must(runs.length <= 1, "activation created duplicate preparation runs");
      if (runs.length === 1) { preparationRunId = runs[0]; break; }
      await sleep(1000);
    }
    must(/^[0-9a-f-]{36}$/.test(preparationRunId ?? ""), "activation event did not start preparation");
    state.legalAttempts ??= {};
    state.legalAttempts[mode] = { ...priorAttempt, preparationRunId, legalSourceVersionId: legalSource.legalSourceVersionId };
    saveState();
    record(KINDS.backend, "one automatic system preparation persisted", { preparationRunId });
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot(s, "started");
    await aria(s, "started");

    const runs = page.locator("[data-preparation-state]");
    const view = async () => ({
      active: await page.locator("[data-compliance-rule-set-active]").getAttribute("data-compliance-rule-set-active"),
      runs: await runs.allInnerTexts(),
    });
    const terminal = await reloadUntil(s, async () => {
      const v = await view();
      const latest = v.runs[0] ?? "";
      return { done: (priorAttempt || v.runs.length > runCountBefore) && /Succeeded|Failed|Cancelled/.test(latest), view: v };
    }, { timeoutMs: 25 * 60 * 1000, label: "preparation terminal state" });
    await shot(s, "terminal");
    await aria(s, "terminal");
    must(terminal.done, "preparation did not reach a terminal state before the observer deadline");
    must(terminal.view.active !== "NONE", `preparation ended without an ACTIVE ruleSet: ${JSON.stringify(terminal.view)}`);
    must(priorAttempt || mode === "initial" || terminal.view.active !== before, "supersession did not activate a new ruleSet");
    record(KINDS.observation, "ACTIVE ruleSet visible after real preparation", terminal.view);
    const rows = await page.locator("[data-rule-set-state]").allInnerTexts();
    must(rows.length === historyBefore.length + (priorRuleSetExists ? 0 : 1) && rows.filter((row) => /\bActive\b/.test(row)).length === 1, `ruleSet history does not contain exactly one ACTIVE row: ${JSON.stringify(rows)}`);
    record(KINDS.observation, "ruleSet history shows exactly one ACTIVE row and no approval step", { rows });

    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    const reloaded = await page.locator("[data-compliance-rule-set-active]").getAttribute("data-compliance-rule-set-active");
    must(reloaded === terminal.view.active, "ACTIVE ruleSet did not survive reload");
    record(KINDS.observation, "ACTIVE ruleSet persists after reload", { label: reloaded });

    const run = JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT p.id,p."requestedBy",p."executionState",p."failureReason",p."correlationId",v.id AS "ruleSetId",v."lifecycleState",v."validationOutcome",o.status AS "outboxStatus" FROM "RuleSetPreparationRun" p LEFT JOIN "ComplianceRuleSetVersion" v ON v."preparationRunId"=p.id LEFT JOIN "OutboxMessage" o ON o.id=p."outboxEventId" WHERE p.id=${q(preparationRunId)}) r;`));
    const thread = uuid5(`event:rule_set_preparation_requested:${run.correlationId}`, LEGAL_THREAD_NAMESPACE);
    const checkpoints = Number(sql(`SELECT count(*) FROM checkpoints WHERE thread_id=${q(thread)};`, "lcsp_langgraph"));
    const activations = Number(sql(`SELECT count(*) FROM "ComplianceRuleSetActivationRecord" WHERE "preparationRunId"=${q(run.id)};`));
    must(run.executionState === "SUCCEEDED" && run.lifecycleState === "ACTIVE" && run.validationOutcome === "PASSED" && run.outboxStatus === "PUBLISHED", `persisted preparation state mismatch: ${JSON.stringify(run)}`);
    must(checkpoints > 0 && activations === 1, "native checkpoint or single governed activation missing");
    must(run.requestedBy === (priorAttempt?.previousFailedRunId ? access.accounts.admin.userId : RULE_SET_PREPARATION_SYSTEM_ACTOR), "preparation actor differs from automatic activation or bounded retry owner");
    state.legal = { legalSourceVersionId: legalSource.legalSourceVersionId, preparationRunId: run.id, ruleSetVersionId: run.ruleSetId, activeLabel: reloaded };
    saveState();
    record(KINDS.backend, "persisted preparation matches the UI: SUCCEEDED, ACTIVE, PASSED, outbox PUBLISHED, one activation, native checkpoints", {
      preparationRunId: run.id, ruleSetVersionId: run.ruleSetId, nativeCheckpointCount: checkpoints, activationCount: activations });
    await finish(s, "PASS");
  },

  // Owner signs in, creates an assessment through the form, and lands on the repository setup surface.
  async "owner-create"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const actor = phaseArgs[3] ?? "owner";
    must(["owner", "other"].includes(actor), "unknown synthetic account role");
    const s = await open(actor, { fresh: true });
    await login(s, { reuse: false });
    const { page } = s;
    await page.waitForLoadState("networkidle").catch(() => {});
    const workspace = await aria(s, "workspace");
    must(/Workspace dashboard/.test(workspace), "authenticated workspace did not render");
    record(KINDS.observation, "authenticated workspace renders for the owner", { totals: /Total assessments \d+/.exec(workspace)?.[0] });
    await shot(s, "workspace");
    record(KINDS.action, "owner clicks Create Assessment on the workspace dashboard");
    await Promise.all([page.waitForURL("**/assessments/new"), page.getByRole("button", { name: "Create Assessment" }).first().click()]);
    await page.getByRole("heading", { name: "Create Assessment" }).waitFor();
    await shot(s, "create-form");
    const name = phaseArgs[2] ?? `Notice retention review ${key}`;
    const description = phaseArgs[1] ?? "Synthetic notice service; review the retention duty.";
    await page.getByRole("textbox", { name: "Assessment name" }).fill(name);
    await page.getByRole("textbox", { name: "Description" }).fill(description);
    record(KINDS.action, "owner fills the Create Assessment form and clicks the submit button", { name, descriptionLength: description.length });
    const [created] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/assessments" && r.request().method() === "POST"),
      page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30000 }),
      page.getByRole("button", { name: "Create Assessment" }).click(),
    ]);
    must(created.ok(), `create rejected with HTTP ${created.status()}`);
    const assessmentId = new URL(page.url()).pathname.split("/").pop();
    record(KINDS.observation, "browser navigated to the created assessment", { assessmentId, createStatus: created.status() });
    await settle(page);
    await shot(s, "created");
    const tree = await aria(s, "created");
    const surface = await page.locator("[data-surface='repository-setup']").count();
    record(KINDS.observation, "post-create surface", { repositorySetupSurface: surface === 1, assessmentTitleVisible: tree.includes(name) });
    const row = JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT a."ownerId",a."lifecycleState",a.name,r."executionState",r."threadId",r."eventSequence" FROM "Assessment" a LEFT JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id WHERE a.id=${q(assessmentId)}) r;`));
    must(row.ownerId === access.accounts[actor].userId, "assessment owner mismatch");
    state[key] = { assessmentId, name, ownerId: row.ownerId, threadId: row.threadId, actor };
    saveState();
    record(KINDS.backend, "persisted assessment is owned by the owner and has not started", row);
    await finish(s, "PASS");
  },

  // All repository setup uses the visible connector. Credentials stay in memory and the secure UI.
  async "owner-repository"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const repositoryUrl = phaseArgs[1];
    must(Boolean(repositoryUrl?.startsWith("https://github.com/")), "approved GitHub repository URL required");
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    record(KINDS.action, "owner selects the GitHub provider in the repository setup conversation");
    await page.getByRole("radio", { name: "GitHub" }).click();
    const needsCredential = await page.getByRole("button", { name: "Configure secure connection" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    await shot(s, "provider-selected");
    if (needsCredential) {
      const composerDisabled = await page.getByRole("textbox", { name: /Connect a provider to continue/ }).isDisabled();
      must(composerDisabled, "repository URL composer is enabled without a provider credential");
      record(KINDS.observation, "repository composer requires a configured provider credential",
        { configureSecureConnectionShown: true, repositoryUrlComposerDisabled: composerDisabled });
      record(KINDS.action, "owner opens Configure secure connection");
      await page.getByRole("button", { name: "Configure secure connection" }).click();
      const dialog = page.locator("[data-component='ProviderCredentialDialog']");
      await dialog.waitFor();
      await shot(s, "credential-dialog-empty");
      const credential = process.env.GH_TOKEN || (existsSync(path.join(ROOT, ".env")) ? require("dotenv").parse(readFileSync(path.join(ROOT, ".env"))).GH_TOKEN : undefined);
      must(Boolean(credential), "GH_TOKEN unavailable in the local environment");
      await dialog.getByLabel("Personal Access Token", { exact: true }).fill(credential);
      record(KINDS.action, "owner enters local GH_TOKEN in the secure credential field and clicks Connect");
      const [configured] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === "/api/provider-credentials" && r.request().method() === "POST", { timeout: 60000 }),
        dialog.getByRole("button", { name: "Connect", exact: true }).click(),
      ]);
      let configuredStatus = configured.status();
      if (!configured.ok() && await page.getByRole("dialog", { name: "Confirm access", exact: true }).count()) {
        const reauth = page.getByRole("dialog", { name: "Confirm access", exact: true });
        await reauth.getByLabel("Password", { exact: true }).fill(access.accounts[s.role].password);
        record(KINDS.action, "owner confirms access through the password reauthentication dialog");
        const [retried] = await Promise.all([
          page.waitForResponse((r) => new URL(r.url()).pathname === "/api/provider-credentials" && r.request().method() === "POST", { timeout: 60000 }),
          reauth.getByRole("button", { name: "Confirm", exact: true }).click(),
        ]);
        configuredStatus = retried.status();
        must(retried.ok(), `credential configuration rejected with HTTP ${configuredStatus}`);
      } else {
        must(configured.ok(), `credential configuration rejected with HTTP ${configuredStatus}`);
      }
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      record(KINDS.observation, "provider credential configured through the product UI", { status: configuredStatus });
    } else {
      const composerEnabled = await page.getByRole("textbox", { name: /repository URL/i }).isEnabled();
      must(composerEnabled, "neither the credential prompt nor an enabled repository composer is shown");
      record(KINDS.observation, "repository composer is enabled for the owner's configured credential",
        { configureSecureConnectionShown: false, repositoryUrlComposerEnabled: composerEnabled });
    }
    await page.getByRole("textbox", { name: /Paste a repository URL/i }).fill(repositoryUrl);
    await shot(s, "repository-url");
    record(KINDS.action, "owner submits the approved repository URL through the repository composer", { repositoryUrl });
    const [connected, complete] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/repository-connection") && r.request().method() === "POST", { timeout: 120000 }),
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/repository-setup/complete") && r.request().method() === "POST", { timeout: 120000 }),
      page.getByRole("button", { name: "Send message", exact: true }).click(),
    ]);
    must(connected.ok(), `repository connection rejected with HTTP ${connected.status()}`);
    must(complete.ok(), `repository setup completion rejected with HTTP ${complete.status()}`);
    record(KINDS.observation, "repository setup completion accepted", { status: complete.status() });
    await page.locator("[data-assessment-id][data-lifecycle-state]").waitFor({ timeout: 60000 });
    await settle(page);
    const surface = await page.locator("[data-assessment-id][data-lifecycle-state]").first().evaluate((el) => ({ lifecycle: el.dataset.lifecycleState, execution: el.dataset.executionState }));
    record(KINDS.observation, "assessment left PREPARING after setup completion", surface);
    await shot(s, "after-continue-setup");
    await aria(s, "repository-connected");
    const snapshot = JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT id,"repositoryFullName","commitSha",branch FROM "RepositorySnapshot" WHERE "assessmentId"=${q(assessmentId)} ORDER BY "createdAt" DESC LIMIT 1) r;`));
    must(Boolean(snapshot?.commitSha), "real provider acquisition did not persist a pinned snapshot");
    const fixturePublication = readJson(path.join(ROOT, "reports/synthetic-notice-service-publication.json"), {});
    if (repositoryUrl === fixturePublication.url) {
      must(snapshot.commitSha === fixturePublication.commit && snapshot.repositoryFullName === fixturePublication.repository,
        "repository setup did not pin the approved immutable fixture commit");
    }
    state[key].snapshotId = snapshot.id;
    state[key].commitSha = snapshot.commitSha;
    saveState();
    record(KINDS.backend, "real Git provider setup persisted a pinned repository snapshot", { snapshot, connectionStatus: connected.status(), noRepositoryRowsSeeded: true });
    const row = JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT a."lifecycleState",r."executionState",r."threadId",r."currentExecutionId",r."eventSequence",(SELECT count(*) FROM "AssessmentRuntime" WHERE "assessmentId"=a.id) "runtimeRows" FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id WHERE a.id=${q(assessmentId)}) r;`));
    must(row.threadId === state[key].threadId && row.runtimeRows === 1, "Root thread identity changed or duplicated");
    record(KINDS.backend, "one runtime row, same pre-allocated Root thread", row);
    await finish(s, "PASS");
  },


  // Wait (read-only) for the Root's first human question, then capture it from the UI and the database.
  async "owner-question"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const seen = await waitView(s, (v) => v.forms >= 1 || v.lifecycle === "COMPLETE" || v.execution === "FAILED", { timeoutMs: 15 * 60000, label: "first human question" });
    must(seen.execution !== "FAILED", `Root failed before asking: ${JSON.stringify(seen)}`);
    must(seen.forms === 1, `expected exactly one human request form, saw ${seen.forms}`);
    const form = page.locator("[data-human-request][data-request-state='OPEN']").first();
    const question = (await form.locator("p").first().innerText()).trim();
    const control = (await form.locator("textarea").count()) ? "TEXT" : "SINGLE_SELECT";
    record(KINDS.observation, "exactly one Human Resolution request is shown", { question, control, lifecycle: seen.lifecycle, execution: seen.execution });
    await shot(s, "question");
    await aria(s, "question");
    const requests = JSON.parse(sql(`SELECT coalesce(json_agg(r),'[]') FROM (SELECT "requestId",status,"controlType",question,"decisionImpact","criterionIds","assessmentRuleId",choices,"threadId" FROM "AssessmentHumanRequest" WHERE "assessmentId"=${q(assessmentId)}) r;`));
    const runtime = runtimeRow(assessmentId);
    must(requests.length === 1 && requests[0].status === "OPEN", `expected one OPEN request: ${JSON.stringify(requests)}`);
    must(requests[0].threadId === runtime.threadId && runtime.runtimeRows === 1, "request is not bound to the one Root thread");
    const timeline = rootTimeline(runtime.threadId);
    const calls = timeline.filter((item) => item.kind === "call").map((item) => item.tool);
    const askAt = calls.findIndex((tool) => /human/.test(tool));
    const repoTools = new Set(["ls", "read_file", "grep", "glob", "search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture", "cite_repository_source"]);
    const before = calls.slice(0, askAt).filter((tool) => repoTools.has(tool));
    must(askAt > -1 && before.length > 0, `Root asked without inspecting the repository first: ${JSON.stringify(calls)}`);
    const counts = before.reduce((acc, tool) => ({ ...acc, [tool]: (acc[tool] ?? 0) + 1 }), {});
    state[key].question = { requestId: requests[0].requestId, text: question, control, criterionIds: requests[0].criterionIds, decisionImpact: requests[0].decisionImpact, choices: requests[0].choices };
    saveState();
    record(KINDS.backend, "one OPEN request on the Root thread; the Root inspected the repository with tools before asking", {
      request: requests[0], runtime, repositoryToolCallsBeforeAsk: counts, toolCallOrder: calls });
    await finish(s, "PASS");
  },

  // Answer the open question through the form, then confirm the same Root thread resumed.
  async "owner-answer"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const answer = phaseArgs[1];
    const { assessmentId, question } = state[key];
    must(Boolean(answer), "answer text or option pattern required");
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const form = page.locator("[data-human-request][data-request-state='OPEN']").first();
    await form.waitFor({ timeout: 30000 });
    const before = runtimeRow(assessmentId);
    let chosen = answer;
    const choiceButtons = question.control === "SINGLE_SELECT" && await form.getByRole("combobox").count() === 0;
    if (choiceButtons) {
      const options = (await form.getByRole("button").allInnerTexts()).filter(text => !/don't know/i.test(text));
      chosen = options.find(text => new RegExp(answer, "i").test(text));
      must(Boolean(chosen), `no choice button matches /${answer}/: ${JSON.stringify(options)}`);
      record(KINDS.action, "owner selects an inline answer choice", { options, chosen });
    } else if (question.control === "SINGLE_SELECT") {
      await form.getByRole("combobox").click();
      const options = await page.getByRole("option").allInnerTexts();
      chosen = options.find((text) => new RegExp(answer, "i").test(text));
      must(Boolean(chosen), `no option matches /${answer}/: ${JSON.stringify(options)}`);
      record(KINDS.action, "owner opens the answer list and selects an option", { options, chosen });
      await page.getByRole("option", { name: chosen }).click();
    } else {
      record(KINDS.action, "owner types the answer into the free-text field", { length: answer.length });
      await form.locator("textarea").fill(answer);
    }
    await shot(s, "answer-filled");
    record(KINDS.action, "owner submits the inline answer");
    const [response] = await Promise.all([
      page.waitForResponse((r) => /\/human-requests\/[^/]+\/answers$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"),
      form.getByRole("button", { name: choiceButtons ? chosen : question.control === "SINGLE_SELECT" ? "Submit" : "Send", exact: true }).click(),
    ]);
    must(response.ok(), `answer rejected with HTTP ${response.status()}`);
    record(KINDS.observation, "answer accepted", { status: response.status() });
    const after = await waitView(s, (v) => v.forms === 0, { timeoutMs: 120000, label: "question closed" });
    await shot(s, "answer-accepted");
    const runtime = runtimeRow(assessmentId);
    const facts = Number(sql(`SELECT count(*) FROM "AssessmentCaseFact" WHERE "assessmentId"=${q(assessmentId)};`));
    const requests = JSON.parse(sql(`SELECT coalesce(json_agg(r),'[]') FROM (SELECT status,"resolvedFactId" FROM "AssessmentHumanRequest" WHERE "assessmentId"=${q(assessmentId)}) r;`));
    must(runtime.threadId === before.threadId && runtime.runtimeRows === 1, "Root thread changed or duplicated after the answer");
    must(requests.length === 1, `duplicate human request after the answer: ${JSON.stringify(requests)}`);
    must(await page.locator(`[data-answer-for=${q(question.requestId)}]`).count() === 1, "accepted answer is absent from conversation history");
    record(KINDS.observation, "form closed after the answer", { view: after });
    record(KINDS.backend, "same Root thread, one runtime row, one request, answer stored as a case fact", { before, runtime, caseFacts: facts, requests });
    if (phaseArgs[2] === "pause-after-decision") {
      // Read-only timing observation; the pause itself always uses the visible product control.
      const deadline = Date.now() + 10 * 60000;
      let accepted = 0;
      while (Date.now() < deadline) {
        accepted = Number(sql(`SELECT count(*) FROM "AssessmentRuleDecision" WHERE "assessmentId"=${q(assessmentId)} AND state='ACCEPTED';`));
        if (accepted > 0) break;
        await sleep(200);
      }
      must(accepted > 0, "no Root-authored decision appeared within the bounded observation");
      record(KINDS.backend, "Root-authored decision is persisted before the UI pause", { accepted });
      await pauseThroughUi(s, key);
    }
    await finish(s, "PASS");
  },

  // Click Stop while the Root is running, then prove PAUSED survives a reload.
  async "owner-stop"() {
    const key = phaseArgs[0] ?? "assessmentB";
    const afterDecision = phaseArgs[1] === "after-decision";
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const seen = await waitView(s, (v) => (v.stop === 1 && (!afterDecision || v.decisions > 0)) || v.lifecycle === "COMPLETE" || v.execution === "FAILED", { timeoutMs: 10 * 60000, label: afterDecision ? "accepted decision and Stop available" : "Stop available" });
    must(seen.stop === 1, `Root was not running long enough to Stop: ${JSON.stringify(seen)}`);
    must(!afterDecision || seen.decisions > 0, "no accepted decision was visible before Stop");
    await pauseThroughUi(s, key);
    await finish(s, "PASS");
  },

  // Click Continue and prove the same Root thread resumed with no duplicate request/decision.
  async "owner-continue"() {
    const key = phaseArgs[0] ?? "assessmentB";
    const { assessmentId, stop } = state[key];
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const seen = await view(page);
    must(seen.resume === 1 && seen.lifecycle === "PAUSED", `Continue is not offered: ${JSON.stringify(seen)}`);
    const requestsBefore = Number(sql(`SELECT count(*) FROM "AssessmentHumanRequest" WHERE "assessmentId"=${q(assessmentId)};`));
    record(KINDS.action, "owner clicks Continue");
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/runtime/continue") && r.request().method() === "POST"),
      page.locator("[data-runtime-action='continue']").click(),
    ]);
    must(response.ok(), `Continue rejected with HTTP ${response.status()}`);
    record(KINDS.observation, "Continue accepted", { status: response.status() });
    const resumed = await waitView(s, (v) => v.lifecycle !== "PAUSED" && v.execution !== "PAUSED", { timeoutMs: 3 * 60000, label: "resumed" });
    await shot(s, "resumed");
    record(KINDS.observation, "UI left PAUSED", resumed);
    const runtime = runtimeRow(assessmentId);
    const requestsAfter = Number(sql(`SELECT count(*) FROM "AssessmentHumanRequest" WHERE "assessmentId"=${q(assessmentId)};`));
    const duplicateDecisions = Number(sql(`SELECT count(*) FROM (SELECT "assessmentRuleId" FROM "AssessmentRuleDecision" WHERE "assessmentId"=${q(assessmentId)} AND state='ACCEPTED' AND "supersededAt" IS NULL AND "invalidatedAt" IS NULL GROUP BY 1 HAVING count(*)>1) d;`));
    must(runtime.threadId === stop.threadId && runtime.runtimeRows === 1, "Continue changed or duplicated the Root thread");
    must(requestsAfter >= requestsBefore && duplicateDecisions === 0, "duplicate decision after Continue");
    record(KINDS.backend, "same Root thread, one runtime row, no duplicate decisions", { stoppedThread: stop.threadId, runtime, requestsBefore, requestsAfter, duplicateDecisions });
    await finish(s, "PASS");
  },


  // Wait for COMPLETE, inspect the decisions, reload, download the report and reconcile it with storage.
  async "owner-complete"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    const { page } = s;
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const done = await waitView(s, (v) => (v.lifecycle === "COMPLETE" && v.execution === "SUCCEEDED") || v.execution === "FAILED" || v.forms > 0, { timeoutMs: 25 * 60000, label: "COMPLETE and execution success" });
    must(done.lifecycle === "COMPLETE" && done.execution === "SUCCEEDED", `assessment did not complete successfully: ${JSON.stringify(done)}`);
    await shot(s, "complete");
    const text = await page.locator("[data-assessment-id]").innerText();
    const banned = /\b(UNKNOWN|PARTIAL|NEEDS[_ ]CONTEXT|open question|pending decision)\b/i.exec(text);
    must(!banned, `unresolved language visible on the completed assessment: ${banned?.[0]}`);
    const decisions = await page.locator("[data-decision-id]").evaluateAll((els) => els.map((el) => ({ id: el.dataset.decisionId, text: el.innerText.replace(/\s+/g, " ").trim() })));
    record(KINDS.observation, "completed assessment shows accepted decisions and no unresolved language", { lifecycle: done.lifecycle, execution: done.execution, decisions });
    await page.reload();
    await settle(page);
    const again = await view(page);
    must(again.lifecycle === "COMPLETE" && again.execution === "SUCCEEDED", `COMPLETE and terminal success did not survive reload: ${JSON.stringify(again)}`);
    must(again.report >= 1, "Download final report action is required");
    await shot(s, "complete-after-reload");
    record(KINDS.observation, "COMPLETE persists after reload with one report action", again);

    const links = page.locator("[data-assessment-id] [data-report-action='download']");
    must(new Set(await links.evaluateAll(els => els.map(el => el.getAttribute("href")))).size === 1, "report actions disagree on the canonical artifact");
    const link = links.first();
    record(KINDS.action, "owner clicks Download final report");
    await link.scrollIntoViewIfNeeded();
    await shot(s, "report-action");
    await aria(s, "report-action");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), link.click()]);
    const file = path.join(privateDir, "downloads", `${key}-${download.suggestedFilename()}`);
    await download.saveAs(file);
    const bytes = readFileSync(file);
    const browserSha = createHash("sha256").update(bytes).digest("hex");
    must(bytes.length > 0, "downloaded report is empty");
    const downloadedPath = path.relative(ROOT, file);
    record(KINDS.observation, "browser download completed", { filename: download.suggestedFilename(), downloadedPath, bytes: bytes.length, sha256: browserSha });

    const artifact = JSON.parse(sql(`SELECT row_to_json(r) FROM (SELECT "artifactId",kind,"lifecycleState","contentSha256","sizeBytes" FROM "AssessmentArtifact" WHERE "assessmentId"=${q(assessmentId)} AND "lifecycleState"='ACTIVE') r;`));
    must(artifact.contentSha256.replace(/^sha256:/, "") === browserSha && Number(artifact.sizeBytes) === bytes.length, `browser bytes differ from the stored artifact: ${JSON.stringify(artifact)}`);
    record(KINDS.backend, "browser download SHA-256 equals the immutable stored artifact", { artifact, browserSha });

    const rules = JSON.parse(sql(`SELECT coalesce(json_agg(e."assessmentRuleId"),'[]') FROM "AssessmentCase" c JOIN "AssessmentRule" e ON e."ruleSetVersionId"=c."ruleSetVersionId" WHERE c."assessmentId"=${q(assessmentId)};`));
    const current = JSON.parse(sql(`SELECT coalesce(json_agg(r),'[]') FROM (SELECT "assessmentRuleId" AS "assessmentRuleId",state,applicability,compliance,decision FROM "AssessmentRuleDecision" WHERE "assessmentId"=${q(assessmentId)} AND state='ACCEPTED' AND "supersededAt" IS NULL AND "invalidatedAt" IS NULL) r;`));
    const outcomes = current.map((row) => ({ rule: row.assessmentRuleId, applicability: row.applicability, compliance: row.compliance,
      criteria: (row.decision.criteria ?? []).map((c) => `${c.criterionId}:${c.outcome}`) }));
    for (const ruleId of rules) must(current.filter((row) => row.assessmentRuleId === ruleId).length === 1, `rule ${ruleId} lacks exactly one current ACCEPTED decision`);
    for (const row of current) {
      const valid = row.applicability === "NOT_APPLICABLE" ? !row.compliance
        : row.applicability === "APPLICABLE" && ["COMPLIANT", "NON_COMPLIANT"].includes(row.compliance) && (row.decision.criteria ?? []).every((c) => ["MET", "NOT_MET"].includes(c.outcome));
      must(valid, `decision is not a final outcome: ${JSON.stringify(outcomes)}`);
    }
    const openRequests = Number(sql(`SELECT count(*) FROM "AssessmentHumanRequest" WHERE "assessmentId"=${q(assessmentId)} AND status='OPEN';`));
    must(openRequests === 0, "an OPEN human request remains after COMPLETE");
    state[key].complete = { artifactId: artifact.artifactId, browserSha, downloadedPath, outcomes };
    saveState();
    record(KINDS.backend, "every pinned AssessmentRule has exactly one final accepted decision and no request is open", { pinnedRules: rules, outcomes });
    await finish(s, "PASS");
  },

  async "owner-stale"() {
    const key = phaseArgs[0] ?? "assessmentC";
    const { assessmentId } = state[key];
    const invalidation = readJson(path.join(evidenceDir, `advance-case-${key}.json`));
    must(invalidation?.invalidatedDecisionIds?.length > 0, "canonical Case invalidation receipt is required");
    const s = await open(state[key].actor ?? "owner");
    await login(s); await s.page.goto(`${access.web}/assessments/${assessmentId}`); await settle(s.page);
    const observed = await view(s.page);
    must(observed.lifecycle === "PAUSED" && observed.report === 0, "stale case is presented as final");
    const presented = await s.page.locator("[data-decision-id]").evaluateAll(els => els.map(el => el.dataset.decisionId));
    must(!presented.some(id => invalidation.invalidatedDecisionIds.includes(id)), "invalidated decision is still presented as accepted");
    await shot(s, "invalidated-case"); await aria(s, "invalidated-case");
    record(KINDS.observation, "reloaded UI no longer presents the invalidated result as final", { assessmentId, invalidatedDecisionIds: invalidation.invalidatedDecisionIds, presentedDecisionIds: presented, view: observed });
    await finish(s, "PASS");
  },

  async "owner-canary"() {
    const key = phaseArgs[0] ?? "assessmentB";
    const { assessmentId } = state[key];
    must(assessmentId !== state.assessmentA.assessmentId, "canary observation requires an independent assessment");
    const positive = readJson(path.join(evidenceDir, "cross-assessment-canary.json"));
    must(positive?.canaryOccurrences > 0, "Root A canary exposure positive control is missing");
    const s = await open(state[key].actor ?? "owner");
    await login(s); await s.page.goto(`${access.web}/assessments/${assessmentId}`); await settle(s.page);
    const text = await s.page.locator("body").innerText();
    must(!text.includes(positive.canary), "foreign raw canary appeared in the assessment UI");
    await shot(s, "canary-isolation"); await aria(s, "canary-isolation");
    record(KINDS.observation, "independent assessment UI contains no A-only raw canary", { assessmentId, actor: s.role, positiveControl: "ROOT_A_RESOLVED_HUMAN_FACT_TOOL_RESULT" });
    await finish(s, "PASS");
  },

  async "owner-delete"() {
    const key = phaseArgs[0] ?? "assessmentB";
    const { assessmentId, name } = state[key];
    const otherId = state.assessmentA.assessmentId;
    must(assessmentId !== otherId, "the preservation control must be a different assessment");
    const rootThread = sql(`SELECT "threadId" FROM "AssessmentRuntime" WHERE "assessmentId"=${q(assessmentId)};`);
    const transportThread = uuid5(`assessment:${assessmentId}`, LEGAL_THREAD_NAMESPACE);
    const inventory = () => ({ ...JSON.parse(sql(`SELECT json_build_object(
      'assessment', (SELECT count(*) FROM "Assessment" WHERE id=${q(assessmentId)}),
      'case', (SELECT count(*) FROM "AssessmentCase" WHERE "assessmentId"=${q(assessmentId)}),
      'evidence', (SELECT count(*) FROM "AssessmentEvidence" WHERE "assessmentId"=${q(assessmentId)}),
      'facts', (SELECT count(*) FROM "AssessmentCaseFact" WHERE "assessmentId"=${q(assessmentId)}),
      'decisions', (SELECT count(*) FROM "AssessmentRuleDecision" WHERE "assessmentId"=${q(assessmentId)}),
      'artifacts', (SELECT count(*) FROM "AssessmentArtifact" WHERE "assessmentId"=${q(assessmentId)}),
      'otherAssessment', (SELECT count(*) FROM "Assessment" WHERE id=${q(otherId)}),
      'otherArtifact', (SELECT count(*) FROM "AssessmentArtifact" WHERE "assessmentId"=${q(otherId)})
    );`)), ...JSON.parse(sql(`SELECT json_build_object(
      'checkpoints', (SELECT count(*) FROM checkpoints WHERE thread_id IN (${q(rootThread)},${q(transportThread)})),
      'journal', (SELECT count(*) FROM store WHERE prefix LIKE ${q(`%${transportThread}%`)}),
      'learning', (SELECT count(*) FROM store WHERE prefix LIKE '%lcsp-assessment-learning%')
    );`, "lcsp_langgraph")) });
    const before = inventory();
    must(before.checkpoints > 0 && before.journal > 0, "erasure precondition has no native state");
    const s = await open(state[key].actor ?? "owner");
    await login(s);
    await s.page.goto(`${access.web}/assessments/${assessmentId}`); await settle(s.page);
    await s.page.getByRole("link", { name, exact: true }).hover();
    await s.page.getByRole("button", { name: `Assessment options: ${name}`, exact: true }).click();
    record(KINDS.action, "owner opens the visible assessment options menu");
    await s.page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await shot(s, "delete-confirmation"); await aria(s, "delete-confirmation");
    const response = s.page.waitForResponse(r => r.request().method() === "DELETE" && new URL(r.url()).pathname === `/api/assessments/${assessmentId}`);
    await s.page.getByRole("button", { name: "Delete assessment", exact: true }).click();
    record(KINDS.action, "owner confirms Delete assessment through the dialog");
    must((await response).ok(), "assessment deletion request failed");
    await s.page.waitForURL(u => !u.pathname.includes(assessmentId)); await settle(s.page);
    await s.page.reload(); await settle(s.page);
    must(!(await s.page.locator("body").innerText()).includes(name), "deleted assessment remains visible after reload");
    await shot(s, "deleted");
    record(KINDS.observation, "deleted assessment is absent after reload");
    const after = inventory();
    for (const field of ["assessment", "case", "evidence", "facts", "decisions", "artifacts", "checkpoints", "journal"])
      must(after[field] === 0, `assessment-owned ${field} survived explicit deletion`);
    must(after.otherAssessment === 1 && after.otherArtifact === before.otherArtifact && after.learning === before.learning,
      "deletion affected the control assessment or generic learning");
    const evidence = { scope: "EXACT_IMAGE_UI_EXPLICIT_DELETE_ERASURE", status: "PASS", runId, assessmentId,
      rootThread, transportThread, before, after, accountingCapturedBeforeDelete: existsSync(path.join(evidenceDir, `assessment-accounting-${key}.json`)) };
    must(evidence.accountingCapturedBeforeDelete, "accounting receipt was not preserved before deletion");
    writeFileSync(path.join(evidenceDir, `assessment-erasure-${key}.json`), JSON.stringify(evidence, null, 2) + "\n");
    record(KINDS.backend, "explicit UI deletion erased native state and preserved the control assessment and generic learning", { before, after });
    await finish(s, "PASS");
  },

  // A different tenant must not see the owner's assessment through any visible route.
  async "other-isolation"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const { assessmentId, name, complete } = state[key];
    const s = await open("other", { fresh: true });
    await login(s, { reuse: false });
    const { page } = s;
    await page.waitForLoadState("domcontentloaded");
    await settle(page);
    const home = await aria(s, "workspace");
    must(!home.includes(name), "owner's assessment name is visible to another tenant");
    record(KINDS.observation, "other tenant's workspace lists none of the owner's assessments", { totals: /Total assessments \d+/.exec(home)?.[0] });
    await shot(s, "workspace");
    record(KINDS.action, "other tenant clicks Open assessment list");
    await Promise.all([page.waitForURL("**/assessments"), page.getByRole("button", { name: "Open assessment list", exact: true }).click()]);
    await settle(page);
    const listText = await page.locator("body").innerText();
    for (const owned of Object.values(state).filter(item => item?.ownerId === access.accounts.owner.userId))
      must(!listText.includes(owned.name), "owner assessment exposed in the dedicated foreign-user list");
    await shot(s, "assessment-list"); await aria(s, "assessment-list");
    record(KINDS.observation, "dedicated assessment list exposes no owner assessment names");
    record(KINDS.action, "other tenant navigates to the owner's assessment URL");
    await page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(page);
    const foreign = await page.locator("body").innerText();
    must(!foreign.includes(name) && !/Accepted decisions|Download final report|A fact is needed/.test(foreign), "foreign assessment content was rendered");
    await shot(s, "foreign-assessment");
    await aria(s, "foreign-assessment");
    const statuses = phase.apiStatuses.filter((r) => r.role === "other" && r.path.includes(assessmentId));
    record(KINDS.observation, "foreign assessment route renders no owner data", { api: statuses, visibleText: foreign.replace(/\s+/g, " ").slice(0, 200) });
    for (const route of [`/api/assessments/${assessmentId}/human-requests`, ...(complete ? [`/api/assessments/${assessmentId}/artifacts/${complete.artifactId}/download`] : [])]) {
      const response = await page.goto(access.web + route);
      const body = await page.locator("body").innerText().catch(() => "");
      must(!response.ok() && !body.includes(name), `foreign route ${route} answered HTTP ${response.status()}`);
      record(KINDS.observation, `browser navigation to ${route.replace(assessmentId, "<id>")} is refused`, { status: response.status() });
    }
    await finish(s, "PASS");
  },


  // Which model actually ran the Root, from the deployed image's own configuration and persisted usage.
  async "root-model-evidence"() {
    const key = phaseArgs[0] ?? "assessmentA";
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    const configured = JSON.parse(execFileSync("docker", ["exec", "-i", `${prefix}-server`, "python", "-c",
      "import json,sys; sys.path.insert(0,'/app/deepagents'); from model_policy import resolve_role; c=resolve_role('assessment-root'); print(json.dumps({'routeId':c.route_id,'provider':c.provider,'model':c.model,'fallbackRouteIds':list(c.fallback_route_ids)}))"], { encoding: "utf8" }).trim().split("\n").pop());
    const usage = JSON.parse(sql(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT "agentRole",provider,model,status,count(*)::int n FROM "LlmUsageEvent" WHERE "assessmentId"=${q(assessmentId)} GROUP BY 1,2,3,4 ORDER BY 1,2,3,4) t;`));
    const runIds = sql(`SELECT string_agg(DISTINCT "runId"::text, ' ') FROM "AssessmentRuntimeEvent" WHERE "assessmentId"=${q(assessmentId)};`).split(" ").filter(Boolean);
    const logs = ["server", "bridge"].map((role) => { const r = spawnSync("docker", ["logs", `${prefix}-${role}`], { encoding: "utf8", maxBuffer: 1 << 28 }); return r.stdout + r.stderr; }).join("\n");
    const marks = (event) => logs.split("\n").filter((line) => line.includes(event) && runIds.some((id) => line.includes(id))).length;
    const fallbackLines = logs.split("\n").filter((line) => line.includes("MODEL_PROVIDER_FALLBACK_ATTEMPT")).length;
    const rootRows = usage.filter((row) => row.agentRole === "assessment-root");
    const actualProviders = [...new Set(rootRows.map((row) => row.provider.toLowerCase()))];
    const actualModels = [...new Set(rootRows.map((row) => row.model))];
    const evidence = { configuredRole: "assessment-root", configuredProvider: configured.provider, configuredModel: configured.model, configuredFallbackRouteIds: configured.fallbackRouteIds,
      actualProviders, actualModels, usageByRoleProviderModel: usage, circuitOpenedForThisRun: marks("MODEL_PROVIDER_CIRCUIT_OPENED"), providerFallbackLogLines: fallbackLines,
      primaryFallbackUsed: !(actualProviders.length === 1 && actualProviders[0] === configured.provider && actualModels.length === 1 && actualModels[0] === configured.model) || fallbackLines > 0 };
    state[key].modelEvidence = evidence; saveState();
    writeFileSync(path.join(evidenceDir, `root-model-evidence-${key}.json`), JSON.stringify({ scope: "EXACT_IMAGE_ROOT_MODEL_IDENTITY", runId, assessmentId, ...evidence }, null, 2) + "\n");
    record(KINDS.backend, "configured Root model versus the model that actually ran it", evidence);
    must(rootRows.length > 0, "no persisted Root usage to attribute");
    await finish(s, "PASS");
  },

  // Reconcile persisted usage, reservations and ledger, then replay a usage callback to prove idempotency.
  async accounting() {
    const key = phaseArgs[0] ?? "assessmentA";
    const { assessmentId } = state[key];
    const s = await open(state[key].actor ?? "owner");
    const j = (query) => JSON.parse(sql(query));
    const totals = () => j(`SELECT row_to_json(t) FROM (SELECT count(*)::int "usageRows", count(DISTINCT "invocationId")::int "distinctInvocations", coalesce(sum("inputTokens"),0)::text "inputTokens", coalesce(sum("outputTokens"),0)::text "outputTokens", coalesce(sum("totalTokens"),0)::text "totalTokens", coalesce(sum("chargedCredits"),0)::text "chargedCredits", count("reservationId")::int "withReservation" FROM "LlmUsageEvent" WHERE "assessmentId"=${q(assessmentId)}) t;`);
    const before = totals();
    must(before.usageRows > 0 && before.usageRows === before.distinctInvocations, `usage rows are not one per invocation: ${JSON.stringify(before)}`);
    await login(s);
    await s.page.goto(`${access.web}/assessments/${assessmentId}`);
    await settle(s.page);
    record(KINDS.action, "owner opens the assessment to inspect token accounting");
    const expectedTotal = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(Number(before.totalTokens));
    const totalLabels = await s.page.locator("[data-usage-total]").allInnerTexts();
    must(totalLabels.length > 0 && totalLabels.every((text) => text.includes(expectedTotal)), `visible token total differs from persisted usage: ${JSON.stringify({ expectedTotal, totalLabels })}`);
    record(KINDS.observation, "visible token total matches canonical persisted usage", { totalLabels, persistedTotal: before.totalTokens });
    await shot(s, "token-accounting");
    await aria(s, "token-accounting");
    const statuses = j(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT status,count(*)::int n FROM "LlmUsageEvent" WHERE "assessmentId"=${q(assessmentId)} GROUP BY 1) t;`);
    const reservations = j(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT status,count(*)::int n,coalesce(sum("amountCredits"),0)::text amount,coalesce(sum("remainingCredits"),0)::text remaining FROM "BillingReservation" WHERE "assessmentId"=${q(assessmentId)} GROUP BY 1) t;`);
    const ledger = j(`SELECT row_to_json(t) FROM (SELECT count(*)::int "entries", coalesce(sum("deltaCredits"),0)::text "delta" FROM "CreditLedgerEntry" WHERE "referenceId" IN (SELECT id FROM "BillingReservation" WHERE "assessmentId"=${q(assessmentId)})) t;`);
    const tokenEvents = j(`SELECT row_to_json(t) FROM (SELECT count(*) FILTER (WHERE "tokenUsage" IS NOT NULL)::int "withTokenUsage", count(*) FILTER (WHERE "tokenUsage"::text ~* '"(content|prompt|messages|text|raw)"')::int "withRawContentKeys" FROM "AssessmentEvent" WHERE "assessmentId"=${q(assessmentId)}) t;`);
    must(tokenEvents.withRawContentKeys === 0, "raw provider/customer content keys found in AssessmentEvent token usage");
    must(tokenEvents.withTokenUsage > 0, "canonical activity has no persisted invocation usage");
    const mismatches = Number(sql(`SELECT count(*) FROM "AssessmentEvent" e LEFT JOIN "LlmUsageEvent" u ON u."assessmentId"=e."assessmentId" AND u."invocationId"=e."tokenUsage"->>'invocationId' WHERE e."assessmentId"=${q(assessmentId)} AND e."tokenUsage" IS NOT NULL AND (u.id IS NULL OR (e."tokenUsage"->>'promptTokens')::bigint IS DISTINCT FROM u."inputTokens" OR (e."tokenUsage"->>'completionTokens')::bigint IS DISTINCT FROM u."outputTokens" OR (e."tokenUsage"->>'totalTokens')::bigint IS DISTINCT FROM u."totalTokens");`));
    must(mismatches === 0, "canonical activity counters differ from trusted invocation usage");
    record(KINDS.backend, "persisted usage reconciles: one row per invocation, reservations and ledger inventoried", { before, statuses, reservations, ledger, tokenEvents });
    // Replay one settled-usage callback for an existing invocation: it must not create or change a row.
    const sample = j(`SELECT row_to_json(r) FROM (SELECT "runId","invocationId","agentRole",provider,model,"providerResponseId","inputTokens"::text "inputTokens","cachedInputTokens"::text "cachedInputTokens","cacheWriteTokens"::text "cacheWriteTokens","outputTokens"::text "outputTokens","reasoningTokens"::text "reasoningTokens","totalTokens"::text "totalTokens","occurredAt" FROM "LlmUsageEvent" WHERE "assessmentId"=${q(assessmentId)} AND status='SETTLED' ORDER BY "occurredAt" LIMIT 1) r;`);
    const body = { assessmentId, runId: sample.runId, invocationId: sample.invocationId, agentRole: sample.agentRole, provider: sample.provider, model: sample.model,
      ...(sample.inputTokens ? { inputTokens: sample.inputTokens } : {}), ...(sample.outputTokens ? { outputTokens: sample.outputTokens } : {}), ...(sample.totalTokens ? { totalTokens: sample.totalTokens } : {}),
      ...Object.fromEntries(["providerResponseId", "cachedInputTokens", "cacheWriteTokens", "reasoningTokens"].filter((field) => sample[field] !== null).map((field) => [field, sample[field]])), occurredAt: new Date(sample.occurredAt.endsWith("Z") ? sample.occurredAt : sample.occurredAt + "Z").toISOString() };
    const replay = await fetch(`${access.api}/internal/billing/usage`, { method: "POST", headers: { "content-type": "application/json", "x-worker-api-key": access.workerKey }, body: JSON.stringify(body) });
    const after = totals();
    must(replay.status === 201, `exact usage replay was rejected: HTTP ${replay.status}`);
    record(KINDS.backend, "duplicate usage callback replay is idempotent", { replayStatus: replay.status, before, after });
    must(JSON.stringify(after) === JSON.stringify(before), `duplicate callback changed usage totals: ${JSON.stringify({ before, after })}`);
    record(KINDS.action, "owner reloads after the duplicate callback");
    await s.page.reload();
    await settle(s.page);
    const afterReload = await s.page.locator("[data-usage-total]").allInnerTexts();
    must(JSON.stringify(afterReload) === JSON.stringify(totalLabels), "browser reload changed the persisted token display");
    await shot(s, "token-accounting-reloaded");
    writeFileSync(path.join(evidenceDir, `assessment-accounting-${key}.json`), JSON.stringify({ scope: "EXACT_IMAGE_LIVE_ACCOUNTING_RECONCILIATION", runId, assessmentId, usage: before, statuses, reservations, ledger, tokenEvents, mismatches, duplicateCallback: { status: replay.status, totalsUnchanged: true }, uiTokenDisplay: { totalLabels, afterReload, expectedTotal } }, null, 2) + "\n");
    await finish(s, "PASS");
  },

  // Safe discovery: sign in as a role, open a path, dump accessible tree + screenshot. Not acceptance evidence.
  async inspect() {
    const [role, route] = phaseArgs;
    const s = await open(role);
    await login(s);
    await s.page.goto(access.web + route);
    await settle(s.page);
    console.log(await aria(s, route.replaceAll("/", "_")));
    await shot(s, route.replaceAll("/", "_"));
    await finish(s, "INSPECTED");
  },
};

if (!PHASES[phaseName]) throw new Error(`unknown phase ${phaseName}; known: ${Object.keys(PHASES).join(", ")}`);
try { await PHASES[phaseName](); } catch (error) { phase.status = "FAIL"; phase.error = String(error.message).slice(0, 500); saveReceipt(); console.error("PHASE FAIL:", error.message); process.exitCode = 1; }
finally { await Promise.all(openBrowsers.map((b) => b.close().catch(() => {}))); }
