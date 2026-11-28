import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { LEGAL_RULE_PREPARATION_STATES as S } from "@lcsp/contracts/legal-rule-catalog";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import {
  FIXTURE_DOCUMENT_ID,
  legalSourceFactory,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const disposableDatabase = (() => {
  try {
    const url = new URL(databaseUrl);
    return (
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "55448" &&
      url.pathname === "/lcsp_r2_activation"
    );
  } catch {
    return false;
  }
})();

// Why: A small mocked page cannot prove bounded projection behavior at the 10,000-rule catalog ceiling.
// How: Run one isolated large-catalog read against the existing disposable PostgreSQL target.
// Invariant: Never seed or benchmark a non-disposable application database.
(disposableDatabase ? describe : describe.skip)(
  "large Legal Rule catalog pagination",
  () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
    const catalogService = new LegalRuleCatalogService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const runTag = randomUUID();
    let catalogId: string;
    let sourceId: string;

    beforeAll(async () => {
      await prisma.$connect();
      const source = await legalSourceFactory(prisma, runTag)();
      sourceId = source.id;
      const catalog = await prisma.legalRuleCatalogVersion.create({
        data: {
          version: `list-benchmark-${runTag}`,
          legalSourceVersionId: source.id,
          createdBy: "benchmark-admin",
          updatedBy: "benchmark-admin",
        },
      });
      catalogId = catalog.id;
      for (let start = 0; start < 10000; start += 1000) {
        await prisma.legalRule.createMany({
          data: Array.from({ length: 1000 }, (_, offset) => {
            const ordinal = start + offset;
            return {
              catalogVersionId: catalog.id,
              legalRuleId: `rule-${String(ordinal).padStart(5, "0")}`,
              title: `Rule ${ordinal}`,
              description: "Benchmark rule",
              citationLocatorRefs: [
                { documentId: FIXTURE_DOCUMENT_ID, locator: "art-1::cl-1" },
              ],
              authoredBy: "benchmark-admin",
              updatedBy: "benchmark-admin",
            };
          }),
        });
      }
    }, 120000);

    afterAll(async () => {
      if (catalogId) {
        await prisma.legalRule.deleteMany({
          where: { catalogVersionId: catalogId },
        });
        await prisma.legalRuleCatalogVersion.delete({
          where: { id: catalogId },
        });
      }
      if (sourceId)
        await prisma.legalSourceVersion.delete({ where: { id: sourceId } });
      await prisma.$disconnect();
    });

    it("returns exact first and last pages and compares the original full projection", async () => {
      const beforeHeap = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const first = await catalogService.list(
        catalogId,
        { page: 1, limit: 20, search: "", withAssessmentRules: false },
        "cid",
      );
      const elapsedMs = performance.now() - startedAt;
      const heapDeltaMb =
        (process.memoryUsage().heapUsed - beforeHeap) / (1024 * 1024);
      const last = await catalogService.list(
        catalogId,
        { page: 500, limit: 20, search: "", withAssessmentRules: false },
        "cid",
      );
      expect(first.total).toBe(10000);
      expect(first.eligibleTotal).toBe(10000);
      expect(first.items).toHaveLength(20);
      expect(first.items[0]?.legalRuleId).toBe("rule-00000");
      expect(last.total).toBe(10000);
      expect(last.items[0]?.legalRuleId).toBe("rule-09980");
      const prepared = await catalogService.list(
        catalogId,
        {
          page: 1,
          limit: 20,
          search: "",
          state: "NOT_PREPARED",
          withAssessmentRules: false,
        },
        "cid",
      );
      expect(prepared.total).toBe(10000);
      const withAssessment = await catalogService.list(
        catalogId,
        { page: 1, limit: 20, search: "", withAssessmentRules: true },
        "cid",
      );
      expect(withAssessment.total).toBe(0);
      const legacyStartedAt = performance.now();
      const legacy = await prisma.$transaction(
        async (tx) => {
          const { items } = await catalogService.entries(tx, catalogId, "cid");
          return catalogService.filter(items, {
            search: "",
            withAssessmentRules: false,
          }).length;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const legacyElapsedMs = performance.now() - legacyStartedAt;
      expect(legacy).toBe(10000);
      // Diagnostic only: wall time and heap vary by machine, so correctness is the stable assertion.
      console.info(
        `legal-rule-list-10000 boundedMs=${elapsedMs.toFixed(1)} fullProjectionMs=${legacyElapsedMs.toFixed(1)} heapDeltaMb=${heapDeltaMb.toFixed(1)}`,
      );
    }, 120000);

    it("keeps DB eligibility counts in parity with the derived-state filter", async () => {
      // Why: A fast SQL count must not mistake missing citations for eligible rules.
      // How: Invalidate ten persisted rule references, then compare unfiltered and derived-state totals.
      // Invariant: Page totals remain exact under the same RepeatableRead source snapshot.
      await prisma.legalRule.updateMany({
        where: {
          catalogVersionId: catalogId,
          legalRuleId: { startsWith: "rule-0000" },
        },
        data: { citationLocatorRefs: [] },
      });
      const unfiltered = await catalogService.list(
        catalogId,
        { page: 1, limit: 20, search: "", withAssessmentRules: false },
        "cid",
      );
      const ineligible = await catalogService.list(
        catalogId,
        {
          page: 1,
          limit: 20,
          search: "",
          state: S.INELIGIBLE,
          withAssessmentRules: false,
        },
        "cid",
      );
      expect(unfiltered.total).toBe(10000);
      expect(unfiltered.eligibleTotal).toBe(9990);
      expect(ineligible.total).toBe(10);
      expect(ineligible.eligibleTotal).toBe(0);
    }, 120000);
  },
);
