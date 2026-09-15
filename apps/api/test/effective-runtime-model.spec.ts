import { describe, expect, it } from "@jest/globals";
import {
  assertEffectiveRuntimeModelAt,
  assertMatchesEffectiveRuntimeModel,
  resolveEffectiveRuntimeModel,
} from "../src/modules/billing/domain/effective-runtime-model.js";

describe("effective runtime model resolution", () => {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  it("selects the latest config at the boundary", () => {
    const selected = resolveEffectiveRuntimeModel(
      [
        {
          role: "root",
          provider: "openai",
          model: "old",
          policyVersion: "1",
          effectiveAt: t0,
        },
        {
          role: "root",
          provider: "google_genai",
          model: "new",
          policyVersion: "2",
          effectiveAt: new Date("2026-01-02T00:00:00.000Z"),
        },
      ],
      "root",
      new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(selected.model).toBe("new");
  });
  it("fails closed when same-time configs are ambiguous", () => {
    expect(() =>
      resolveEffectiveRuntimeModel(
        [
          {
            role: "root",
            provider: "openai",
            model: "a",
            policyVersion: "1",
            effectiveAt: t0,
          },
          {
            role: "root",
            provider: "openai",
            model: "b",
            policyVersion: "2",
            effectiveAt: t0,
          },
        ],
        "root",
        t0,
      ),
    ).toThrow("Ambiguous");
  });

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
