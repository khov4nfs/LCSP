import { describe, expect, it } from "@jest/globals";
import {
  LEGAL_RULE_PREPARATION_STATES as STATES,
  legalRuleFilterSchema,
  type LegalRuleFilter,
  type LegalRuleListItem,
} from "@lcsp/contracts/legal-rule-catalog";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { LegalRuleCatalogService } from "./legal-rule-catalog.service.js";

describe("LegalRuleCatalogService.filter", () => {
  const service = new LegalRuleCatalogService(
    {} as PrismaService,
    {} as AuditWriterService,
  );
  const items = [
    { id: "with-rules", state: STATES.PREPARED, assessmentRuleCount: 3 },
    { id: "without-rules", state: STATES.PREPARED, assessmentRuleCount: 0 },
    { id: "failed", state: STATES.FAILED, assessmentRuleCount: 0 },
    { id: "stale", state: STATES.STALE, assessmentRuleCount: 2 },
    { id: "running", state: STATES.RUNNING, assessmentRuleCount: 1 },
  ].map((item) => ({
    ...item,
    legalRuleId: item.id,
    title: item.id,
    description: "",
    citationLocatorRefs: [],
  })) as LegalRuleListItem[];

  it("returns only current prepared items with persisted assessment rules", () => {
    const query: LegalRuleFilter = {
      search: "",
      withAssessmentRules: true,
    };

    expect(service.filter(items, query).map((item) => item.id)).toEqual([
      "with-rules",
    ]);
  });

  it("keeps ordinary state and search filters when the assessment filter is off", () => {
    const query: LegalRuleFilter = {
      search: "with-rules",
      state: STATES.PREPARED,
      withAssessmentRules: false,
    };

    expect(service.filter(items, query).map((item) => item.id)).toEqual([
      "with-rules",
    ]);
  });

  it("parses the boolean query parameter used by the Admin filter", () => {
    expect(
      legalRuleFilterSchema.parse({ withAssessmentRules: "true" }),
    ).toMatchObject({ withAssessmentRules: true });
    expect(
      legalRuleFilterSchema.parse({ withAssessmentRules: "false" }),
    ).toMatchObject({ withAssessmentRules: false });
    expect(
      legalRuleFilterSchema.safeParse({ withAssessmentRules: "yes" }).success,
    ).toBe(false);
  });
});
