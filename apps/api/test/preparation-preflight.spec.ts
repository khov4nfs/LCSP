import { describe, it, expect, jest } from "@jest/globals";
import { LegalRetrievalIndexStatus, type Prisma } from "@prisma/client";
import { collectPreparationPreflight } from "../scripts/lib/preparation-preflight.js";

const required = [
  ["ComplianceRuleSetVersion", "targetActivityScope"],
  ["RuleSetPreparationRun", "targetActivityScope"],
  ["RuleSetPreparationRun", "executionContract"],
  ["RuleSetPreparationRun", "claimPhase"],
  ["RuleSetPreparationRun", "claimInventoryRevision"],
].map(([table_name, column_name]) => ({ table_name, column_name }));

function fixture() {
  const source = {
    id: "source-fixture",
    integrityManifestRef: "integrity:fixture",
    sourceManifest: {},
    _count: { documents: 1, chunks: 2 },
    activations: [
      {
        integrityManifestRef: "integrity:fixture",
        retrievalValidationRef: "retrieval:fixture",
      },
    ],
    retrievalIndexes: [
      {
        status: LegalRetrievalIndexStatus.VALID as LegalRetrievalIndexStatus,
        validatedAt: new Date(),
        validationManifestRef: "retrieval:fixture",
      },
    ],
    documents: [{ _count: { chunks: 2 } }],
  };
  const tx = {
    legalSourceVersion: {
      findMany: jest
        .fn<() => Promise<(typeof source)[]>>()
        .mockResolvedValue([source]),
    },
    complianceRuleSetVersion: {
      findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
      findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    },
    ruleSetPreparationRun: {
      findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
      findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    },
    $queryRaw: jest
      .fn<() => Promise<typeof required>>()
      .mockResolvedValue(required),
  };
  return {
    source,
    tx,
    inspect: () =>
      collectPreparationPreflight(
        tx as unknown as Prisma.TransactionClient,
        new URL("postgresql://localhost:55438/disposable"),
      ),
  };
}

describe("Read-only Preparation readiness evidence", () => {
  it("reports missing columns without running incompatible availability queries", async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue(required.slice(2));
    const result = await f.inspect();
    expect(result.schemaGaps).toContain(
      "RuleSetPreparationRun.targetActivityScope",
    );
    expect(result.preflightState).toBe("BLOCKED_RUNTIME_CONFIGURATION");
    expect(result.availability).toBeNull();
    expect(f.tx.ruleSetPreparationRun.findFirst).not.toHaveBeenCalled();
    expect(result.canDispatch).toBe(false);
  });
  it.each([0, 2])(
    "blocks ambiguous or missing ACTIVE source count %i",
    async (count) => {
      const f = fixture();
      f.tx.legalSourceVersion.findMany.mockResolvedValue(
        Array.from({ length: count }, (_, i) => ({
          ...f.source,
          id: `source-${i}`,
        })),
      );
      const result = await f.inspect();
      expect(result.blockers).toContain(
        "ACTIVE_SOURCE_SELECTION_AMBIGUOUS_OR_MISSING",
      );
      expect(result.availability?.canStart).toBe(false);
    },
  );
  it.each(["integrity", "retrieval", "index"])(
    "blocks missing or mismatched %s evidence",
    async (kind) => {
      const f = fixture();
      if (kind === "integrity")
        f.source.activations[0].integrityManifestRef = "foreign";
      if (kind === "retrieval")
        f.source.activations[0].retrievalValidationRef = "foreign";
      if (kind === "index")
        f.source.retrievalIndexes[0].status = LegalRetrievalIndexStatus.INVALID;
      if (kind === "index")
        f.tx.legalSourceVersion.findMany
          .mockResolvedValueOnce([f.source])
          .mockResolvedValue([{ ...f.source, retrievalIndexes: [] }]);
      const result = await f.inspect();
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.availability?.canStart).toBe(false);
      expect(result.canDispatch).toBe(false);
    },
  );
  it("does not turn eligible source metadata into runtime or spending authorization", async () => {
    const result = await fixture().inspect();
    expect(result.blockers).toEqual([]);
    expect(result.availability?.canStart).toBe(true);
    expect(result.canDispatch).toBe(false);
    expect(
      Object.values(result.runtimePrerequisites).every(
        (state) => state === "NOT_PROVEN",
      ),
    ).toBe(true);
  });
});
