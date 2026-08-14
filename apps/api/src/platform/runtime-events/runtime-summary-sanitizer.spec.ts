import { describe, expect, it } from "@jest/globals";

import {
  FALLBACK_SUMMARY,
  sanitizeRuntimeSummaryText,
  sanitizeRuntimeSummaryValue,
} from "./runtime-summary-sanitizer.js";

describe("runtime-summary-sanitizer", () => {
  it("redacts prompt and token-like fields from structured summaries", () => {
    expect(
      sanitizeRuntimeSummaryValue({
        prompt: "full prompt body",
        apiKey: "sk-secret",
        safeCount: 3,
      }),
    ).toEqual({
      prompt: "[REDACTED]",
      apiKey: "[REDACTED]",
      safeCount: 3,
    });
  });

  it("returns fallback summary when text contains forbidden secrets", () => {
    expect(sanitizeRuntimeSummaryText("Bearer secret-token-value")).toBe(
      FALLBACK_SUMMARY,
    );
  });
});
