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
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";

describe("LegalRuleCatalogService.filter", () => {
  const service = new LegalRuleCatalogService(
    {} as PrismaService,
    {} as AuditWriterService,
    // Filtering is isolated from source graph reads.
    {} as LegalDocumentGraphService,
  );
  const item = (
    id: string,
    state: LegalRuleListItem["state"],
    assessmentRuleCount: number,
  ): LegalRuleListItem => ({
    id,
    legalRuleId: id,
    title: id,
    description: "",
    citationLocatorRefs: [],
    state,
    ineligibleReason: null,
    lastResultId: null,
    lastRunId: null,
    lastResultRevision: null,
    lastOutcome: null,
    assessmentRuleCount,
  });
  const items = [
    item("with-rules", STATES.PREPARED, 3),
    item("without-rules", STATES.PREPARED, 0),
    item("failed", STATES.FAILED, 0),
    item("stale", STATES.STALE, 2),
    item("running", STATES.RUNNING, 1),
  ];

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
