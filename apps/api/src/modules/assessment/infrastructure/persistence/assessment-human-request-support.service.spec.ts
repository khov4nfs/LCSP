import { describe, expect, it, jest } from "@jest/globals";
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

  it("projects customer-visible fields to VI while preserving technical invariants", async () => {
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

  it("unseeded cache invokes upstream projection service on cache miss and preserves canonical domain row", async () => {
    clearPresentationProjections();

    const originalFetch = globalThis.fetch;
    const capturedCalls: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = jest
      .fn()
      .mockImplementation((input: unknown, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : "";
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        const parsedBody = bodyStr
          ? (JSON.parse(bodyStr) as Record<string, unknown>)
          : {};
        capturedCalls.push({ url, body: parsedBody });
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              projected: {
                "What is the retention period?":
                  "Thời hạn lưu giữ dữ liệu là bao lâu?",
                "Retention period is not configured in code.":
                  "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
                "Determines GDPR compliance.": "Xác định mức độ tuân thủ GDPR.",
                "Checked config.json and settings.py.":
                  "Đã kiểm tra tệp config.json và settings.py.",
                "30 days": "30 ngày",
                "90 days": "90 ngày",
              },
            }),
        } as Response);
      }) as typeof fetch;

    process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
    process.env.WORKER_API_KEY = "test-worker-key";

    try {
      // 1. First turn: Read with VI over completely unseeded cache
      const viewVi = await service.view(canonicalRow, "vi");
      expect(viewVi.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");
      expect(viewVi.unresolvedFact).toBe(
        "Thời hạn lưu giữ chưa được định cấu hình trong mã nguồn.",
      );
      expect(viewVi.choices[0].label).toBe("30 ngày");
      expect(capturedCalls.length).toBe(1);
      expect(capturedCalls[0].url).toContain("/internal/project-locale");

      // 2. Second turn: Same session switch to EN
      const viewEn = await service.view(canonicalRow, "en");
      expect(viewEn.question).toBe("What is the retention period?");
      expect(viewEn.choices[0].label).toBe("30 days");

      // 3. Third turn: Switch back to VI - served from populated cache without second network call
      const viewVi2 = await service.view(canonicalRow, "vi");
      expect(viewVi2.question).toBe("Thời hạn lưu giữ dữ liệu là bao lâu?");
      expect(capturedCalls.length).toBe(1);

      // Canonical row and invariants are completely unmodified
      expect(canonicalRow.question).toBe("What is the retention period?");
      expect(
        (canonicalRow.choices as Array<{ value: string }> | null)?.[0]?.value,
      ).toBe("CHOICE_30D");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.LCSP_AGENT_SERVER_URL;
      delete process.env.WORKER_API_KEY;
    }
  });
});
