import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { validateAnswerPacket, validateBrowserTarget } from "./resolve-last-hitl-playwright.mjs";

const assessmentId = randomUUID(), requestId = randomUUID();
const target = { cdp: "http://127.0.0.1:9222", pageUrl: "http://127.0.0.1:3000/en/assessments/" + assessmentId,
  assessmentId, requestId };
test("explicit preview target accepts one local assessment and question", () => {
  validateBrowserTarget(target);
});
for (const [name, change] of [
  ["historical default absent", { assessmentId: undefined }],
  ["request absent", { requestId: undefined }],
  ["remote page", { pageUrl: "http://external.invalid:3000/assessments/" + assessmentId }],
  ["wrong page", { pageUrl: "http://127.0.0.1:3000/assessments/" + randomUUID() }],
  ["CDP credentials", { cdp: "http://user:secret@127.0.0.1:9222" }],
  ["CDP extra path", { cdp: "http://127.0.0.1:9222/other" }],
]) {
  test("rejects " + name + " before connection", () => assert.throws(() => validateBrowserTarget({ ...target, ...change })));
}
const packet = { assessmentId, requestId, questionSha256: "d".repeat(64), answer: "Explicit operator answer" };
test("exact question packet preserves the operator text", () => {
  assert.equal(validateAnswerPacket(packet, assessmentId, requestId, packet.questionSha256), packet.answer);
});
for (const [name, change] of [
  ["changed assessment", { assessmentId: randomUUID() }],
  ["changed request", { requestId: randomUUID() }],
  ["changed visible question", { questionSha256: "changed" }],
  ["empty answer", { answer: " " }],
  ["unknown fact substitution", { doesNotKnow: true }],
]) {
  test("rejects " + name + " before filling", () =>
    assert.throws(() => validateAnswerPacket({ ...packet, ...change }, assessmentId, requestId, packet.questionSha256)));
}
