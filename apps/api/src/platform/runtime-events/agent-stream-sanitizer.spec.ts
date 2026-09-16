import { describe, expect, it } from "@jest/globals";

import {
  sanitizeAgentStreamIdentifier,
  sanitizeAgentStreamText,
  sanitizeAgentStreamValue,
} from "./agent-stream-sanitizer.js";

describe("agent stream sanitizer", () => {
  it("preserves whitespace and text beyond runtime-summary length", () => {
    const text = `  ${"x".repeat(500)}\n`;
    expect(sanitizeAgentStreamText(text)).toBe(text);
  });

  it("redacts secret-like values without hiding rule/tool metadata", () => {
    const text = sanitizeAgentStreamText(
      "result Bearer abc.def.ghi api_key=super-secret-value",
    );
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("super-secret-value");
    expect(
      sanitizeAgentStreamText('{"api_key":"another-secret-value"}'),
    ).not.toContain("another-secret-value");

    expect(
      sanitizeAgentStreamValue({
        api_key: "hidden",
        selectedRuleId: "ER-42",
        toolCallId: "call-1",
      }),
    ).toEqual({
      api_key: "[REDACTED]",
      selectedRuleId: "ER-42",
      toolCallId: "call-1",
    });
  });

  it("normalizes identifiers without changing streamed text semantics", () => {
    expect(sanitizeAgentStreamIdentifier("  planner  ")).toBe("planner");
    expect(sanitizeAgentStreamText(" ")).toBe(" ");
  });
});
