import { describe, expect, it } from "@jest/globals";

import {
  sanitizeRuntimeSummaryText,
  sanitizeRuntimeSummaryValue,
} from "./runtime-summary-sanitizer.js";

describe("runtime-summary-sanitizer", () => {
  it("preserves prompt and token-like fields in structured summaries", () => {
    expect(
      sanitizeRuntimeSummaryValue({
        prompt: "full prompt body",
        apiKey: "sk-secret",
        safeCount: 3,
      }),
    ).toEqual({
      prompt: "full prompt body",
      apiKey: "sk-secret",
      safeCount: 3,
    });
  });

  it("preserves token-like text summaries", () => {
    expect(sanitizeRuntimeSummaryText("Bearer secret-token-value")).toBe(
      "Bearer secret-token-value",
    );
  });
});
