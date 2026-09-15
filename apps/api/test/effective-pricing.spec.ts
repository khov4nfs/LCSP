import { describe, expect, it } from "@jest/globals";
import { selectEffectivePricingSnapshot } from "../src/modules/billing/domain/effective-pricing.js";

describe("effective pricing snapshot selection", () => {
  it("selects the snapshot effective exactly at the boundary", () => {
    const boundary = new Date("2026-01-01T00:00:00.000Z");
    const selected = selectEffectivePricingSnapshot(
      [
        { id: "old", effectiveAt: new Date("2025-12-31T23:59:59.999Z") },
        { id: "new", effectiveAt: boundary },
      ],
      boundary,
    );
    expect(selected?.id).toBe("new");
  });

  it("fails closed when two snapshots have the selected effective time", () => {
    const boundary = new Date("2026-01-01T00:00:00.000Z");
    expect(() =>
      selectEffectivePricingSnapshot(
        [
          { id: "first", effectiveAt: boundary },
          { id: "second", effectiveAt: boundary },
        ],
        boundary,
      ),
    ).toThrow("Ambiguous pricing snapshot");
  });
});
