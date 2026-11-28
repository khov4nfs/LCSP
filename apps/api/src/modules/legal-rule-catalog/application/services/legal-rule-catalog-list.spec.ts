import { describe, expect, it, jest } from "@jest/globals";
import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";
import { LEGAL_RULE_PREPARATION_STATES as S } from "@lcsp/contracts/legal-rule-catalog";

describe("LegalRuleCatalogService.list bounded projection", () => {
  it("counts exact filtered results across bounded rule batches without loading the entire catalog", async () => {
    const all = Array.from({ length: 2001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      legalRuleId: `rule-${String(index).padStart(4, "0")}`,
      title: `Rule ${index}`,
      description: "",
      citationLocatorRefs: [],
      state: index % 2 === 0 ? S.PREPARED : S.INELIGIBLE,
      ineligibleReason: index % 2 === 0 ? null : "CITATION_INVALID",
      lastResultId: null,
      lastRunId: null,
      lastResultRevision: null,
      lastOutcome: null,
      assessmentRuleCount: index % 2 === 0 ? 1 : 0,
      input: null,
    }));
    const transaction = jest
      .fn<(callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
      .mockImplementation((callback) => callback({}));
    const service = new LegalRuleCatalogService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
    );
    const entries = jest
      .spyOn(service, "entries")
      .mockImplementation((...args) => {
        const window = args[3];
        return Promise.resolve({
          catalog: {
            id: "catalog",
            version: "v1",
            revision: 1,
            legalSourceVersionId: "source",
          } as never,
          items: (window
            ? all.slice(window.skip, window.skip + window.take)
            : all) as never,
        });
      });

    const page = await service.list(
      "catalog",
      {
        page: 2,
        limit: 20,
        search: "",
        state: S.PREPARED,
        withAssessmentRules: true,
      },
      "cid",
    );

    expect(page.total).toBe(1001);
    expect(page.eligibleTotal).toBe(1001);
    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.legalRuleId).toBe("rule-0040");
    expect(entries.mock.calls.length).toBeGreaterThan(1);
    expect(
      entries.mock.calls.every(
        (call) => (call[3] as { take: number }).take <= 2000,
      ),
    ).toBe(true);

    const lastPage = await service.list(
      "catalog",
      { page: 101, limit: 20, search: "Rule", withAssessmentRules: false },
      "cid",
    );
    expect(lastPage.total).toBe(2001);
    expect(lastPage.eligibleTotal).toBe(1001);
    expect(lastPage.items.map((item) => item.legalRuleId)).toEqual([
      "rule-2000",
    ]);
  });
});
