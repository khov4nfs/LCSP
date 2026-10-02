import { describe, expect, it } from "@jest/globals";
import {
  assertEffectiveRuntimeModelAt,
  assertMatchesEffectiveRuntimeModel,
} from "../src/modules/billing/domain/effective-runtime-model.js";

describe("effective runtime model validation", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  it("rejects a runtime policy selection that is not active at invocation time", () => {
    expect(() =>
      assertEffectiveRuntimeModelAt(
        {
          provider: "openai",
          model: "future-model",
          policyVersion: "2",
          effectiveAt: "2026-01-02T00:00:00.000Z",
        },
        t0,
      ),
    ).toThrow("not active");
  });

  it("rejects a provider/model that differs from the server-selected policy", () => {
    expect(() =>
      assertMatchesEffectiveRuntimeModel(
        {
          role: "root",
          provider: "google_genai",
          model: "gemini-effective",
          policyVersion: "2",
          effectiveAt: t0,
        },
        {
          provider: "openai",
          model: "priced-but-not-effective",
          policyVersion: "2",
          effectiveAt: t0.toISOString(),
        },
      ),
    ).toThrow("not the effective runtime policy");
  });
});
