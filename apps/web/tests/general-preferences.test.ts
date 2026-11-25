import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const testWindow = dom.window;
for (const name of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Node",
  "Event",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const {
  CHAT_FONTS,
  getChatFontSnapshot,
  setChatFont,
  subscribeToChatFont,
  getAssessmentCompletionNotificationSnapshot,
  setAssessmentCompletionNotificationPreference,
  subscribeToAssessmentCompletionNotification,
} = await import("../src/lib/general-preferences.ts");

test("general preferences persist and notify subscribers", () => {
  let fontChanges = 0;
  const unsubFont = subscribeToChatFont(() => {
    fontChanges++;
  });

  assert.equal(getChatFontSnapshot(), CHAT_FONTS.inter);
  setChatFont(CHAT_FONTS.mono);
  assert.equal(getChatFontSnapshot(), CHAT_FONTS.mono);
  assert.equal(fontChanges, 1);
  assert.ok(document.cookie.includes("lcsp_chat_font=mono"));

  // Reset font
  setChatFont(CHAT_FONTS.inter);
  assert.equal(getChatFontSnapshot(), CHAT_FONTS.inter);
  unsubFont();

  let notifyChanges = 0;
  const unsubNotify = subscribeToAssessmentCompletionNotification(() => {
    notifyChanges++;
  });

  assert.equal(getAssessmentCompletionNotificationSnapshot(), true);
  setAssessmentCompletionNotificationPreference(false);
  assert.equal(getAssessmentCompletionNotificationSnapshot(), false);
  assert.equal(notifyChanges, 1);
  assert.ok(document.cookie.includes("lcsp_notify_assessment_completion=false"));

  // Reset notification preference
  setAssessmentCompletionNotificationPreference(true);
  assert.equal(getAssessmentCompletionNotificationSnapshot(), true);
  unsubNotify();
});
