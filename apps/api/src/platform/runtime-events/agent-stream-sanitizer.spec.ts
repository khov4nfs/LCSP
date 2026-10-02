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
        input_tokens: 11,
        output_tokens: 13,
        selectedRuleId: "ER-42",
        toolCallId: "call-1",
      }),
    ).toEqual({
      api_key: "[REDACTED]",
      input_tokens: 11,
      output_tokens: 13,
      selectedRuleId: "ER-42",
      toolCallId: "call-1",
    });
  });

  it("normalizes identifiers without changing streamed text semantics", () => {
    expect(sanitizeAgentStreamIdentifier("  planner  ")).toBe("planner");
    expect(sanitizeAgentStreamText(" ")).toBe(" ");
  });

  it("hides private prompts, customer context, and hidden reasoning keys", () => {
    expect(
      sanitizeAgentStreamValue({
        schemaVersion: "AGENT_STREAM_SEMANTIC_V1",
        kind: "MODEL_REQUEST",
        systemPrompt: "never expose system prompt",
        developer_prompt: "never expose developer prompt",
        privateContext: { customer: "private interview context" },
        hiddenReasoning: "chain of thought",
        messages: ["raw message state"],
        model: "gpt-test",
      }),
    ).toEqual({
      schemaVersion: "AGENT_STREAM_SEMANTIC_V1",
      kind: "MODEL_REQUEST",
      systemPrompt: "[HIDDEN_PRIVATE_RUNTIME_STATE]",
      developer_prompt: "[HIDDEN_PRIVATE_RUNTIME_STATE]",
      privateContext: "[HIDDEN_PRIVATE_RUNTIME_STATE]",
      hiddenReasoning: "[HIDDEN_PRIVATE_RUNTIME_STATE]",
      messages: "[HIDDEN_PRIVATE_RUNTIME_STATE]",
      model: "gpt-test",
    });
  });

  it("keeps numeric provider usage details but still redacts secrets outside usage", () => {
    expect(
      sanitizeAgentStreamValue({
        usage: {
          input_tokens: 3,
          details: { reasoning_tokens: 7, thinking_tokens: 2, reasoning: 1 },
        },
        api_key: "x",
        reasoning_tokens: 9,
      }),
    ).toEqual({
      usage: {
        input_tokens: 3,
        details: { reasoning_tokens: 7, thinking_tokens: 2, reasoning: 1 },
      },
      api_key: "[REDACTED]",
      reasoning_tokens: "[REDACTED]",
    });
  });

  it("does not exempt a nested model-authored usage object from redaction", () => {
    expect(
      sanitizeAgentStreamValue({
        parameters: { usage: { password: 123456, api_key: 99 } },
      }),
    ).toEqual({
      parameters: { usage: { password: "[REDACTED]", api_key: "[REDACTED]" } },
    });
  });

  it("only exempts top-level usage when the event is allowed to carry provider usage", () => {
    expect(
      sanitizeAgentStreamValue(
        { usage: { reasoning_tokens: 7 } },
        0,
        false,
        false,
      ),
    ).toEqual({ usage: { reasoning_tokens: "[REDACTED]" } });
  });
});
