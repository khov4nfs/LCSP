import { describe, expect, it } from "@jest/globals";
import type { AssessmentHumanRequest } from "@prisma/client";
import {
  AssessmentHumanRequestSupport,
  clearPresentationProjections,
  registerPresentationProjection,
} from "./assessment-human-request-support.service.js";

describe("AssessmentHumanRequestSupport read projection", () => {
  const service = new AssessmentHumanRequestSupport();

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

  it("projects customer-visible fields to VI while preserving technical invariants", () => {
    clearPresentationProjections();
    registerPresentationProjection(
      "What is the retention period?",
      "vi",
      "Thời hạn lưu giữ dữ liệu là bao lâu?",
    );
    registerPresentationProjection(
      "Retention period is not configured in code.",
      "vi",
      "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
    );
    registerPresentationProjection(
      "Determines GDPR compliance.",
      "vi",
      "Xác định mức độ tuân thủ GDPR.",
    );
    registerPresentationProjection(
      "Checked config.json and settings.py.",
      "vi",
      "Đã kiểm tra tệp config.json và settings.py.",
    );
    registerPresentationProjection("30 days", "vi", "30 ngày");
    registerPresentationProjection("90 days", "vi", "90 ngày");

    const viewVi = service.view(canonicalRow, "vi");

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

  it("preserves canonical English fields when reading with en or null locale", () => {
    const viewEn = service.view(canonicalRow, "en");
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

    const viewNull = service.view(canonicalRow, null);
    expect(viewNull.question).toBe("What is the retention period?");
  });

  it("supports same-thread EN <-> VI switching over the same canonical row", () => {
    // 1. Read in VI
    const viewVi = service.view(canonicalRow, "vi");
    expect(viewVi.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");

    // 2. Switch to EN
    const viewEn = service.view(canonicalRow, "en");
    expect(viewEn.question).toBe("What is the retention period?");

    // 3. Switch back to VI
    const viewVi2 = service.view(canonicalRow, "vi");
    expect(viewVi2.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");

    // Canonical row itself was never modified
    expect(canonicalRow.question).toBe("What is the retention period?");
  });
});
