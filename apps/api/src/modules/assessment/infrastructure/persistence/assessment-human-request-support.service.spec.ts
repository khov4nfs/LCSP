import { authoredLocalizationFixture } from "../../../../../test/support/authored-localization.fixture.js";
import { describe, expect, it } from "@jest/globals";
import type { AssessmentHumanRequest } from "@prisma/client";
import { AssessmentHumanRequestSupport } from "./assessment-human-request-support.service.js";

describe("AssessmentHumanRequestSupport read projection", () => {
  const localization = authoredLocalizationFixture();
  const service = new AssessmentHumanRequestSupport(localization.projection);

  const canonicalRow: AssessmentHumanRequest = {
    assessmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestId: "11111111-1111-4111-8111-111111111111",
    requestRevision: 1,
    caseRevision: 2,
    status: "OPEN",
    assessmentRuleId: "RULE-DATA-01",
    criterionIds: ["CRIT-1", "CRIT-2"],
    question: "What is the retention period?",
    unresolvedFact: "Retention period is not configured in code.",
    decisionImpact: ["Determines GDPR compliance."],
    resolutionAttempts: ["Checked config.json and settings.py."],
    controlType: "CHOICE",
    choices: [
      { value: "CHOICE_30D", label: "30 days" },
      { value: "CHOICE_90D", label: "90 days" },
    ],
    threadId: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: null,
    requestDigest: null,
    checkpointId: null,
    resolvedFactId: null,
    answers: [],
    createdAt: new Date("2026-10-13T10:00:00Z"),
    resolvedAt: null,
  };

  it("projects customer-visible fields to VI while preserving technical invariants", async () => {
    localization.seed(
      "What is the retention period?",
      "Thời hạn lưu giữ dữ liệu là bao lâu?",
    );
    localization.seed(
      "Retention period is not configured in code.",
      "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
    );
    localization.seed(
      "Determines GDPR compliance.",
      "Xác định mức độ tuân thủ GDPR.",
    );
    localization.seed(
      "Checked config.json and settings.py.",
      "Đã kiểm tra tệp config.json và settings.py.",
    );
    localization.seed("30 days", "30 ngày");
    localization.seed("90 days", "90 ngày");

    const viewVi = await service.view(canonicalRow, "vi");

    // Localized customer-visible text
    expect(viewVi.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");
    expect(viewVi.unresolvedFact).toBe(
      "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
    );
    expect(viewVi.decisionImpact).toEqual(["Xác định mức độ tuân thủ GDPR."]);
    expect(viewVi.resolutionAttempts).toEqual([
      "Đã kiểm tra tệp config.json và settings.py.",
    ]);
    expect(viewVi.choices).toEqual([
      { value: "CHOICE_30D", label: "30 ngày" },
      { value: "CHOICE_90D", label: "90 ngày" },
    ]);

    // Technical invariants strictly preserved
    expect(viewVi.requestId).toBe(canonicalRow.requestId);
    expect(viewVi.requestRevision).toBe(canonicalRow.requestRevision);
    expect(viewVi.openedCaseRevision).toBe(canonicalRow.caseRevision);
    expect(viewVi.status).toBe(canonicalRow.status);
    expect(viewVi.assessmentRuleId).toBe(canonicalRow.assessmentRuleId);
    expect(viewVi.criterionIds).toEqual(canonicalRow.criterionIds);
    expect(viewVi.controlType).toBe(canonicalRow.controlType);
    expect(viewVi.checkpointId).toBe(canonicalRow.checkpointId);
    expect(viewVi.resolvedFactId).toBe(canonicalRow.resolvedFactId);
  });

  it("projects all rule dependencies while retaining the original primary rule", async () => {
    const view = await service.view({
      ...canonicalRow,
      dependencies: [
        {
          requestId: canonicalRow.requestId,
          assessmentId: canonicalRow.assessmentId,
          assessmentRuleId: "RULE-SECONDARY",
          criterionIds: ["CRIT-SECONDARY"],
        },
      ],
    });
    expect(view.assessmentRuleId).toBe(canonicalRow.assessmentRuleId);
    expect(view.dependencies).toEqual([
      {
        assessmentRuleId: canonicalRow.assessmentRuleId,
        criterionIds: ["CRIT-1", "CRIT-2"],
      },
      { assessmentRuleId: "RULE-SECONDARY", criterionIds: ["CRIT-SECONDARY"] },
    ]);
    const legacy = await service.view(canonicalRow);
    expect(legacy.dependencies).toEqual([
      {
        assessmentRuleId: canonicalRow.assessmentRuleId,
        criterionIds: ["CRIT-1", "CRIT-2"],
      },
    ]);
  });

  it("preserves canonical English fields when reading with en or null locale", async () => {
    const viewEn = await service.view(canonicalRow, "en");
    expect(viewEn.question).toBe("What is the retention period?");
    expect(viewEn.unresolvedFact).toBe(
      "Retention period is not configured in code.",
    );
    expect(viewEn.decisionImpact).toEqual(["Determines GDPR compliance."]);
    expect(viewEn.resolutionAttempts).toEqual([
      "Checked config.json and settings.py.",
    ]);
    expect(viewEn.choices).toEqual([
      { value: "CHOICE_30D", label: "30 days" },
      { value: "CHOICE_90D", label: "90 days" },
    ]);

    const viewNull = await service.view(canonicalRow, null);
    expect(viewNull.question).toBe("What is the retention period?");
  });

  it("supports same-thread EN <-> VI switching over the same canonical row", async () => {
    // 1. Read in VI
    const viewVi = await service.view(canonicalRow, "vi");
    expect(viewVi.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");

    // 2. Switch to EN
    const viewEn = await service.view(canonicalRow, "en");
    expect(viewEn.question).toBe("What is the retention period?");

    // 3. Switch back to VI
    const viewVi2 = await service.view(canonicalRow, "vi");
    expect(viewVi2.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");

    // Canonical row itself was never modified
    expect(canonicalRow.question).toBe("What is the retention period?");
  });

  it("returns explicit incomplete localization without provider calls or answer mutation", async () => {
    const empty = authoredLocalizationFixture();
    const reader = new AssessmentHumanRequestSupport(empty.projection);
    const before = structuredClone(canonicalRow);
    await expect(reader.view(canonicalRow, "vi")).rejects.toThrow();
    expect(canonicalRow).toEqual(before);
  });
});
