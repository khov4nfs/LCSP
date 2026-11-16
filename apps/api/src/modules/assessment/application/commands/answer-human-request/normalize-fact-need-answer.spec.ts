import { describe, expect, it } from "@jest/globals";
import { FACT_NEED_VALUE_KINDS } from "@lcsp/contracts/assessment-domain";
import {
  AssessmentFactNeedEnvironment,
  AssessmentFactNeedStatus,
  AssessmentFactNeedSubjectKind,
  AssessmentFactNeedTimeframeKind,
  AssessmentFactNeedValueKind,
  type AssessmentFactNeed,
} from "@prisma/client";
import { normalizeFactNeedAnswer } from "./normalize-fact-need-answer.js";

function need(
  valueKind: AssessmentFactNeedValueKind,
  allowedValues: string[] = [],
): AssessmentFactNeed {
  return {
    factNeedId: "11111111-1111-4111-8111-111111111111",
    assessmentId: "assessment",
    tenantOwnerId: "owner",
    identityDigest: `sha256:${"a".repeat(64)}`,
    subjectKind: AssessmentFactNeedSubjectKind.DEPLOYMENT,
    subjectKey: "chatbot.production",
    predicate: "operator.value",
    operationalScope: "customer_support",
    environment: AssessmentFactNeedEnvironment.PRODUCTION,
    deploymentKey: "prod.eu.1",
    timeframeKind: AssessmentFactNeedTimeframeKind.CURRENT,
    timeframeFrom: null,
    timeframeTo: null,
    valueKind,
    valueSchemaVersion: "v1",
    allowedValues,
    sourceInvestigationAttempts: ["Inspected repository configuration."],
    acceptedEvidenceIds: [],
    investigatedRangeIds: [],
    investigationDiscoveryRefs: null,
    status: AssessmentFactNeedStatus.OPEN,
    resolvedFactId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    supersededAt: null,
  };
}

describe("normalizeFactNeedAnswer", () => {
  it.each([
    [AssessmentFactNeedValueKind.TEXT, " Example Ltd ", "Example Ltd"],
    [AssessmentFactNeedValueKind.BOOLEAN, "TRUE", true],
    [AssessmentFactNeedValueKind.INTEGER, "-42", -42],
    [AssessmentFactNeedValueKind.NUMBER, "1.25e2", 125],
    [AssessmentFactNeedValueKind.DATE, "2026-11-16", "2026-11-16"],
    [
      AssessmentFactNeedValueKind.DATE_TIME,
      "2026-11-16T10:00:00.000Z",
      "2026-11-16T10:00:00.000Z",
    ],
  ])("normalizes %s values", (kind, raw, expected) => {
    expect(normalizeFactNeedAnswer(need(kind), raw)).toEqual({
      kind,
      value: expected,
    });
  });

  it("maps enum casing to the persisted canonical value", () => {
    expect(
      normalizeFactNeedAnswer(
        need(AssessmentFactNeedValueKind.ENUM, ["PRODUCTION", "DEVELOPMENT"]),
        "production",
      ),
    ).toEqual({
      kind: FACT_NEED_VALUE_KINDS.enumeration,
      value: "PRODUCTION",
    });
  });

  it("parses complete JSON without executing source syntax", () => {
    expect(
      normalizeFactNeedAnswer(
        need(AssessmentFactNeedValueKind.JSON),
        '{"retentionDays":30}',
      ),
    ).toEqual({
      kind: FACT_NEED_VALUE_KINDS.json,
      value: { retentionDays: 30 },
    });
  });

  it.each([
    [AssessmentFactNeedValueKind.BOOLEAN, "yes"],
    [AssessmentFactNeedValueKind.INTEGER, "1.5"],
    [AssessmentFactNeedValueKind.INTEGER, "9007199254740992"],
    [AssessmentFactNeedValueKind.NUMBER, "Infinity"],
    [AssessmentFactNeedValueKind.DATE, "2026-02-30"],
    [AssessmentFactNeedValueKind.DATE_TIME, "2026-11-16"],
    [AssessmentFactNeedValueKind.ENUM, "STAGING"],
    [AssessmentFactNeedValueKind.JSON, "{bad json}"],
  ])("rejects invalid %s input", (kind, raw) => {
    expect(() => normalizeFactNeedAnswer(need(kind), raw)).toThrow();
  });
});
