#!/usr/bin/env node
/**
 * Explicit text-answer helper for an already open local assessment page.
 * Default mode prints a question fingerprint only. Submission requires an operator
 * answer file bound to that exact assessment, request and current visible question.
 * This helper never supplies scenario facts or answers a historical request by default.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
/**
 * Business purpose: Identify the exact question or answer without printing its contents.
 * Business rules: Hash UTF8 text with SHA256; the digest grants no answer authority itself.
 * Execution flow: Compute the deterministic digest of the supplied text.
 * Failure cases: Unsupported input propagates without a submission.
 * Side effects: Pure in-memory digest calculation.
 */
const sha = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Business purpose: Bind the browser operation to an explicit local page and request.
 * Business rules: Remote targets, URL credentials and ambiguous IDs are forbidden.
 * Execution flow: Validate both loopback URLs and the assessment path segment.
 * Failure cases: Invalid input raises before any browser connection.
 * Side effects: Pure argument validation.
 */
export function validateBrowserTarget({ cdp, pageUrl, assessmentId, requestId }) {
  for (const value of [assessmentId, requestId]) if (!UUID.test(value ?? "")) throw new Error("EXPLICIT_UUID_REQUIRED");
  for (const value of [cdp, pageUrl]) {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        !url.port || Number(url.port) < 1024 || url.username || url.password || url.hash)
      throw new Error("EXPLICIT_LOOPBACK_URL_REQUIRED");
  }
  const endpoint = new URL(cdp);
  if (endpoint.pathname !== "/" || endpoint.search) throw new Error("CDP_ORIGIN_REQUIRED");
  if (!new URL(pageUrl).pathname.split("/").includes(assessmentId)) throw new Error("PAGE_ASSESSMENT_MISMATCH");
}

/**
 * Business purpose: Prevent a prepared answer from being applied to another question.
 * Business rules: Exact four-field text packets are required; unknown answers use the normal UI.
 * Execution flow: Compare identities and the current visible-question fingerprint, then return explicit text.
 * Failure cases: Missing, changed or empty input stops before filling or clicking.
 * Side effects: Pure validation; never invents or summarizes the operator's answer.
 */
export function validateAnswerPacket(packet, assessmentId, requestId, questionSha256) {
  const keys = ["answer", "assessmentId", "questionSha256", "requestId"];
  if (!packet || typeof packet !== "object" || Array.isArray(packet) ||
      JSON.stringify(Object.keys(packet).sort()) !== JSON.stringify(keys) ||
      packet.assessmentId !== assessmentId || packet.requestId !== requestId ||
      packet.questionSha256 !== questionSha256 || typeof packet.answer !== "string" || !packet.answer.trim())
    throw new Error("ANSWER_PACKET_BINDING_MISMATCH");
  return packet.answer;
}

/**
 * Business purpose: Preview or explicitly submit one operator-provided text answer through the existing UI.
 * Business rules:
 * - Default is read-only; no hardcoded assessment, request, answer or automatic retry is available.
 * - Submission uses the current UI revision/CAS and requires exact question binding.
 * - Question/answer contents, session values and response bodies are never printed.
 * Execution flow:
 * 1. Locate the one already open explicit page and request card; fingerprint its visible text.
 * 2. Preview metadata, or validate a private answer file and fill the single text control.
 * 3. Observe the exact answer POST response; report acknowledgement separately from queued execution.
 * Failure cases: Missing/duplicate pages, changed cards, unsupported controls or uncertain responses fail visibly.
 * Side effects: Explicit --submit may create one human answer and enqueue the existing governed continuation.
 */
export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      cdp: { type: "string" }, "page-url": { type: "string" },
      "assessment-id": { type: "string" }, "request-id": { type: "string" },
      "answer-file": { type: "string" }, submit: { type: "boolean", default: false },
    },
    allowPositionals: false, strict: true,
  });
  const target = { cdp: values.cdp, pageUrl: values["page-url"],
    assessmentId: values["assessment-id"], requestId: values["request-id"] };
  validateBrowserTarget(target);
  let packet;
  if (values.submit) {
    if (!values["answer-file"]) throw new Error("PRIVATE_ANSWER_FILE_REQUIRED");
    const metadata = lstatSync(values["answer-file"]);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
        (metadata.mode & 0o077) || (typeof process.getuid === "function" && metadata.uid !== process.getuid()))
      throw new Error("PRIVATE_REGULAR_ANSWER_FILE_REQUIRED");
    packet = JSON.parse(readFileSync(values["answer-file"], "utf8"));
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.connectOverCDP(target.cdp, { timeout: 10000 });
  try {
    const pages = browser.contexts().flatMap((context) => context.pages())
      .filter((page) => page.url() === target.pageUrl);
    if (pages.length !== 1) throw new Error("ONE_EXPLICIT_OPEN_PAGE_REQUIRED");
    const page = pages[0];
    const card = page.locator('[data-human-request="' + target.requestId + '"]');
    if (await card.count() !== 1 || !await card.isVisible()) throw new Error("ONE_VISIBLE_REQUEST_REQUIRED");
    const questionSha256 = sha((await card.innerText()).replace(/\r\n/gu, "\n").trim());
    if (!values.submit) {
      console.log(JSON.stringify({ status: "PREVIEW", assessmentId: target.assessmentId,
        requestId: target.requestId, questionSha256, submitted: false }));
      return;
    }
    const answer = validateAnswerPacket(packet, target.assessmentId, target.requestId, questionSha256);
    const textarea = card.locator("textarea");
    const submit = card.locator('button[type="submit"]');
    if (await textarea.count() !== 1 || await submit.count() !== 1 || !await textarea.isEditable())
      throw new Error("ONE_EDITABLE_TEXT_ANSWER_REQUIRED");
    await textarea.fill(answer);
    if (!await submit.isEnabled()) throw new Error("ANSWER_FORM_NOT_READY");
    const expectedPath = "/assessments/" + target.assessmentId + "/human-requests/" + target.requestId + "/answers";
    const [response] = await Promise.all([
      page.waitForResponse((result) => {
        const url = new URL(result.url());
        return result.request().method() === "POST" && url.pathname === expectedPath &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      }, { timeout: 15000 }),
      submit.click(),
    ]);
    const envelope = await response.json();
    if (!response.ok() || envelope?.ok !== true || envelope.data?.requestId !== target.requestId)
      throw new Error("ANSWER_ACKNOWLEDGEMENT_NOT_CONFIRMED");
    console.log(JSON.stringify({ status: "ANSWER_ACKNOWLEDGED", assessmentId: target.assessmentId,
      requestId: target.requestId, questionSha256, answerSha256: sha(answer), submitted: true,
      answerStatus: envelope.data.status, resumed: envelope.data.resumed,
      executionCompletion: "NOT_CLAIMED" }));
  } finally {
    // For a Browser obtained via connectOverCDP, close disconnects this client.
    // The helper never launches or shuts down the user's browser process.
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = /^[A-Z_]{1,80}$/u.test(error?.message ?? "") ? error.message : "OPERATION_NOT_CONFIRMED";
    console.error(JSON.stringify({ status: "BLOCKED_OR_UNCONFIRMED", code, automaticRetry: false }));
    process.exitCode = 2;
  });
}
