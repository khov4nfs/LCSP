import { describe, expect, it } from "@jest/globals";

import { decisionFingerprint } from "./decision-fingerprint.js";

describe("decisionFingerprint", () => {
  it("preserves the supplied canonical rule order", () => {
    const first = [
      {
        decisionId: "decision-a",
        decisionRevision: 1,
        decision: { rule: "A" },
      },
      {
        decisionId: "decision-b",
        decisionRevision: 1,
        decision: { rule: "B" },
      },
    ];
    const permuted = [first[1], first[0]];

    expect(decisionFingerprint(first)).not.toBe(decisionFingerprint(permuted));
  });
});
