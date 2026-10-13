import { BillingDomainError } from "./billing.errors.js";
import { assertEffectiveRuntimeModelAt } from "./effective-runtime-model.js";

const occurredAt = new Date("2026-10-14T00:00:00.000Z");

describe("assertEffectiveRuntimeModelAt", () => {
  it("accepts protocol as optional runtime route metadata", () => {
    expect(
      assertEffectiveRuntimeModelAt(
        {
          provider: "APX",
          protocol: "openai",
          model: "gpt-5.6-luna",
          policyVersion: "cfg-0123456789abcdef",
          effectiveAt: occurredAt.toISOString(),
        },
        occurredAt,
      ),
    ).toEqual(occurredAt);

    expect(
      assertEffectiveRuntimeModelAt(
        {
          provider: "OPENAI",
          model: "gpt-5.6-luna",
          policyVersion: "cfg-0123456789abcdef",
          effectiveAt: occurredAt.toISOString(),
        },
        occurredAt,
      ),
    ).toEqual(occurredAt);
  });

  it("bounds the optional protocol field", () => {
    expect(() =>
      assertEffectiveRuntimeModelAt(
        {
          provider: "APX",
          protocol: "p".repeat(201),
          model: "gpt-5.6-luna",
          policyVersion: "cfg-0123456789abcdef",
          effectiveAt: occurredAt.toISOString(),
        },
        occurredAt,
      ),
    ).toThrow(BillingDomainError);
  });
});
