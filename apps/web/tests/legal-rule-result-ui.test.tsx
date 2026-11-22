import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import type { PreparationRuleHistory } from "@lcsp/contracts/legal-rule-catalog";
import { setAppLocale } from "../src/lib/locale.ts";
import {
  LegalRuleResultRevision,
  LegalRuleRunActivity,
} from "../src/features/admin/components/molecules/legal-rule-catalog-result.tsx";
import { LegalSourceListCard } from "../src/features/admin/components/molecules/legal-source-list-card.tsx";
import {
  formatLegalProvisions,
  formatLocator,
  getRuleDisplayTitle,
  isIdOrSha,
} from "../src/features/admin/utils/legal-rule-formatter.ts";
import { installFetch, render, settle } from "./support/dom.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

setAppLocale("vi");

type ResultRevision = PreparationRuleHistory["results"][number];

const sampleResult = {
  id: "36900000-0000-4000-8000-000000000099",
  revision: 2,
  batchId: "71dc6100-4321-4a4b-9f22-ee7cef05fe9f",
  preparationRunId: "6873fa82-44a3-4997-b431-0aa49a075462",
  executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
  requestedBy: "226265dc-d705-43b9-88c3-d323ad6ee962",
  createdAt: "2026-11-18T13:57:38.612Z",
  startedAt: "2026-11-18T13:57:39.000Z",
  completedAt: "2026-11-18T13:58:10.000Z",
  inputFingerprint: "ad192eab6504e8062847d554f92565ea07f8bfd4eadefb0d89486704fe8d9a9d",
  input: {
    ruleId: "36900000-0000-4000-8000-000000000101",
    legalRuleId: "LR001",
    title: "Notice rule 1",
    description: "Notice rule description",
    catalogVersionId: "bbeb2e05-e48a-4f12-909b-dd8cf9cb45b1",
    catalogVersion: "law-set.v1-catalog",
    catalogRevision: 20,
    legalSourceVersionId: "bbeb2e05-e48a-4f12-909b-dd8cf9cb45b1",
    sourceVersion: "law-set-v1",
    indexId: "36900000-0000-4000-8000-000000000003",
    indexContentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    citations: [
      {
        chunkId: "chunk-secret-id-1",
        documentId: "LAW-DOC-1",
        locator: "dieu-1",
        contentSha256: "sha256:citationhash11111111111111111111111111111111111111111111",
        content: "Nội dung điều luật bảo mật nguồn dữ liệu.",
      },
    ],
  },
  instructionReceipt: {
    revision: "preparation.selected@sha256:4ec5ce3abb9dcb8736ec7e6f9ca8e87dd10644eff15609a6fcf211523f810d78",
    fingerprint: "4ec5ce3abb9dcb8736ec7e6f9ca8e87dd10644eff15609a6fcf211523f810d78",
    content: "SECRET_INSTRUCTION_CONTENT_DO_NOT_LEAK",
    bundleFingerprint: "5ec5ce3abb9dcb8736ec7e6f9ca8e87dd10644eff15609a6fcf211523f810d79",
  },
  output: {
    analysis: "Agent đã hoàn thành phân tích quy định và tạo 1 LegalRequirement cùng 1 AssessmentRule tương ứng.",
    legalRequirements: [
      {
        legalRequirementId: "req-11111111-1111-4111-8111-111111111111",
        title: "Yêu cầu lưu trữ nhật ký truy vết",
        proposition: "Doanh nghiệp phải duy trì nhật ký kiểm toán hệ thống trong ít nhất 12 tháng.",
        applicabilityConditions: ["Áp dụng cho mọi hệ thống xử lý dữ liệu cá nhân."],
        qualifiers: ["Thời hạn lưu trữ tối thiểu 12 tháng."],
        exceptions: ["Dữ liệu thử nghiệm phi cá nhân."],
        nonRepositoryDuty: false,
      },
    ],
    assessmentRules: [
      {
        assessmentRuleId: "rule-22222222-2222-4222-8222-222222222222",
        concept: "Kiểm tra cấu hình lưu log bảo mật",
        legalIntent: "Xác minh retention period của audit logging >= 365 ngày.",
        criteria: [
          {
            criterionId: "crit-33333333-3333-4333-8333-333333333333",
            statement: "Cấu hình log retention phải thiết lập tối thiểu 365 ngày.",
          },
        ],
        investigationGoals: ["Đọc file cấu hình logging.conf hoặc audit.yaml."],
        requiredEvidence: ["File cấu hình logging tồn tại và có thông số hợp lệ."],
        unresolvedConditions: [],
        sourceRefs: [],
      },
    ],
    contextRelations: [],
  },
  failureCode: null,
} as unknown as ResultRevision;

test("LegalRuleResultRevision does not show any ID, catalog pins, or instruction fingerprint", async () => {
  const container = render(
    React.createElement(LegalRuleResultRevision, {
      result: sampleResult,
      current: true,
    }),
  );

  const text = container.textContent ?? "";

  // 1. Must NOT show IDs
  assert.equal(text.includes(sampleResult.preparationRunId), false, "Must not show preparationRunId");
  assert.equal(text.includes(sampleResult.requestedBy), false, "Must not show requestedBy ID");
  assert.equal(text.includes(sampleResult.batchId), false, "Must not show batchId");
  assert.equal(text.includes("req-11111111"), false, "Must not show legalRequirementId");
  assert.equal(text.includes("rule-22222222"), false, "Must not show assessmentRuleId");
  assert.equal(text.includes("crit-33333333"), false, "Must not show criterionId");
  assert.equal(text.includes("chunk-secret-id-1"), false, "Must not show chunkId");

  // 2. Must NOT show sourcePins (Catalog / nguồn đã ghim)
  assert.equal(text.includes("Catalog / nguồn đã ghim"), false, "Must not show sourcePins header");
  assert.equal(text.includes(sampleResult.inputFingerprint), false, "Must not show inputFingerprint");
  assert.equal(text.includes("Chunk nguồn đã ghim"), false, "Must not show Chunk nguồn đã ghim");
  assert.equal(text.includes("Nội dung điều luật bảo mật nguồn dữ liệu"), false, "Must not show input citation text");

  // 3. Must NOT show instruction / fingerprint
  assert.equal(text.includes("Revision / fingerprint instruction"), false, "Must not show instruction label");
  const historicalFingerprint = sampleResult.instructionReceipt?.fingerprint;
  if (historicalFingerprint) {
    assert.equal(text.includes(historicalFingerprint), false, "Must not show fingerprint");
  }
  assert.equal(text.includes("SECRET_INSTRUCTION_CONTENT_DO_NOT_LEAK"), false, "Must not show instruction content");
  assert.equal(text.includes("Nội dung instruction chính xác"), false, "Must not show instruction section");

  // 4. MUST show agent output: analysis, requirements, assessment rules
  assert.equal(text.includes("Agent đã hoàn thành phân tích quy định"), true, "Must show agent analysis");
  assert.equal(text.includes("Yêu cầu lưu trữ nhật ký truy vết"), true, "Must show requirement title");
  assert.equal(text.includes("Doanh nghiệp phải duy trì nhật ký kiểm toán"), true, "Must show proposition");
  assert.equal(text.includes("Áp dụng cho mọi hệ thống xử lý dữ liệu cá nhân."), true, "Must show conditions");
  assert.equal(text.includes("Kiểm tra cấu hình lưu log bảo mật"), true, "Must show rule concept");
  assert.equal(text.includes("Xác minh retention period"), true, "Must show legalIntent");
  assert.equal(text.includes("Cấu hình log retention phải thiết lập"), true, "Must show criteria");
});

test("LegalRuleResultDialog renders activity above regenerate button, with button right-aligned", async () => {
  const fs = await import("node:fs/promises");
  const fsSync = await import("node:fs");
  const path = await import("node:path");
  const candidates = [
    path.resolve(
      process.cwd(),
      "apps/web/src/features/admin/components/molecules/legal-rule-catalog-result.tsx",
    ),
    path.resolve(
      process.cwd(),
      "src/features/admin/components/molecules/legal-rule-catalog-result.tsx",
    ),
  ];
  const targetPath = candidates.find((c) => fsSync.existsSync(c))!;
  const fileContent = await fs.readFile(targetPath, "utf-8");

  // 1. Verify activity details appears before regenerate button
  const activityIdx = fileContent.indexOf("<LegalRuleRunActivity");
  const regenerateBtnIdx = fileContent.indexOf('{t("regenerate")}');
  assert.ok(activityIdx > 0, "LegalRuleRunActivity must be present");
  assert.ok(regenerateBtnIdx > 0, "Regenerate button must be present");
  assert.ok(
    activityIdx < regenerateBtnIdx,
    "LegalRuleRunActivity must be placed ABOVE the regenerate button",
  );

  // 2. Verify regenerate button is wrapped in a right-aligned container with size='sm'
  assert.ok(
    fileContent.includes('flex justify-end pt-2'),
    "Regenerate button must be wrapped in right-aligned flex justify-end container",
  );
  assert.ok(
    fileContent.includes('size="sm"'),
    "Regenerate button must be small (size='sm')",
  );

  // 3. Verify proper padding and spacing
  assert.ok(
    fileContent.includes("space-y-6"),
    "Dialog content must have proper spacing (space-y-6)",
  );
  assert.ok(
    fileContent.includes("p-6 sm:p-8"),
    "Dialog body must have generous padding (p-6 sm:p-8)",
  );
  assert.ok(
    fileContent.includes("flex flex-col gap-1.5"),
    "Dialog header must stack title and description in a column with flex flex-col gap-1.5",
  );
});

test("legal-rule-formatter suppresses IDs/SHAs and formats Vietnamese legal provisions into separate lines", () => {
  // 1. isIdOrSha
  const sourceSha =
    "src-059eecc35b768ab115bfe3db290fc0d740cbd205ebb2a7dfa5f1a401bb7a4097";
  const uuid = "71dc6100-4321-4a4b-9f22-ee7cef05fe9f";
  const hexSha =
    "ad192eab6504e8062847d554f92565ea07f8bfd4eadefb0d89486704fe8d9a9d";
  assert.equal(isIdOrSha(sourceSha), true, "src- prefix sha must be detected as id/sha");
  assert.equal(isIdOrSha(uuid), true, "UUID must be detected as id/sha");
  assert.equal(isIdOrSha(hexSha), true, "Hex SHA must be detected as id/sha");
  assert.equal(isIdOrSha("LR001"), false, "Readable code LR001 is not an id/sha");
  assert.equal(isIdOrSha(""), false, "Empty string is not an id/sha");

  // 2. formatLocator
  assert.equal(
    formatLocator("art-6::cl-1::pt-đ"),
    "Điều 6, Khoản 1, Điểm đ",
    "Locator must translate to Vietnamese legal hierarchy",
  );

  // 3. getRuleDisplayTitle
  const ruleWithSha = {
    legalRuleId: sourceSha,
    title: "2026_18_356_2025_NĐ-CP - art-6::cl-1::pt-đ",
  };
  const displayTitle = getRuleDisplayTitle(ruleWithSha);
  assert.equal(
    displayTitle.includes(sourceSha),
    false,
    "Display title must NEVER include raw SHA",
  );
  assert.equal(
    displayTitle,
    "2026_18_356_2025_NĐ-CP - Điều 6, Khoản 1, Điểm đ",
    "Display title must format locators cleanly without SHA prefix",
  );

  const readableRule = {
    legalRuleId: "LR001",
    title: "Quy định bảo vệ dữ liệu cá nhân",
  };
  assert.equal(
    getRuleDisplayTitle(readableRule),
    "LR001 · Quy định bảo vệ dữ liệu cá nhân",
  );

  // 4. formatLegalProvisions (breaking Điều, Khoản, Điểm into newlines)
  const rawProvision =
    "Điều 6. Phương thức thể hiện sự đồng ý của chủ thể dữ liệu cá nhân 1. Các phương thức xin sự đồng ý của chủ thể dữ liệu cá nhân phải bảo đảm khả năng kiểm chứng được về việc xác định chủ thể dữ liệu cá nhân đã thực hiện sự đồng ý, thời điểm và nội dung được đồng ý, bao gồm: đ) Bằng các phương thức khác phù hợp có thể in, sao chép bằng văn bản, bao gồm cả dưới dạng điện tử hoặc định dạng kiểm chứng được.";

  const formatted = formatLegalProvisions(rawProvision);

  // Verify Điều is on its own paragraph
  assert.ok(
    formatted.startsWith("Điều 6. Phương thức thể hiện sự đồng ý"),
    "Must preserve Điều 6 title at start",
  );

  // Verify Khoản 1. is broken into a new paragraph
  assert.ok(
    formatted.includes("\n\n1. Các phương thức xin sự đồng ý"),
    "Must break clause 1 into a separate paragraph",
  );

  // Verify Điểm đ) is broken into a new paragraph
  assert.ok(
    formatted.includes("\n\nđ) Bằng các phương thức khác phù hợp"),
    "Must break point đ) into a separate paragraph",
  );

  // Verify no erroneous break between Điều and 6
  assert.equal(
    formatted.includes("Điều\n\n6."),
    false,
    "Must not split article number from word Điều",
  );
});

test("LegalRuleRunActivity renders flat, clean timeline without nested disclaimers or NOT_REPORTED", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const container = render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(LegalRuleRunActivity, {
        result: sampleResult,
      }),
    ),
  );

  const text = container.textContent ?? "";

  // 1. Must NOT show technical disclaimers or notes
  assert.equal(
    text.includes("NOT_REPORTED"),
    false,
    "Must not show NOT_REPORTED jargon",
  );
  assert.equal(
    text.includes("chưa có bằng chứng"),
    false,
    "Must not show 'chưa có bằng chứng'",
  );
  assert.equal(
    text.includes("Sự kiện chưa có giai đoạn được xác minh"),
    false,
    "Must not show nested unclassified group",
  );
  assert.equal(
    text.includes("Chỉ là usage quan sát từ stream"),
    false,
    "Must not show disclaimer notes",
  );
  assert.equal(
    text.includes("Dòng activity hiển thị"),
    false,
    "Must not show count disclaimers",
  );

  // 2. Must show clean execution status badge
  assert.equal(text.includes("Thành công"), true, "Must show Succeeded badge");

  // 3. Must NOT have nested details inside the component
  const detailsElements = container.querySelectorAll("details");
  assert.equal(
    detailsElements.length,
    0,
    "LegalRuleRunActivity must not contain nested <details> elements",
  );
});

test("LegalSourceListCard suppresses duplicate active status when latest version equals active version", () => {
  setAppLocale("vi");

  const activeVersionSummary = {
    id: "ver-1111",
    version: "law-set.v1",
    status: "ACTIVE" as const,
    basedOnVersionId: null,
    createdAt: "2026-11-18T10:00:00Z",
    activatedAt: "2026-11-18T10:00:00Z",
    documentCount: 9,
    readyDocumentCount: 9,
    chunkCount: 150,
  };

  const sourceWithSameLatest = {
    id: "src-1111",
    slug: "law-set",
    name: "Luật an ninh mạng",
    description: null,
    createdAt: "2026-11-18T10:00:00Z",
    versionCount: 1,
    activeVersion: activeVersionSummary,
    latestVersion: activeVersionSummary,
  };

  const container = render(
    React.createElement(LegalSourceListCard, {
      source: sourceWithSameLatest,
    }),
  );

  const text = container.textContent ?? "";

  // Must render the active version badge
  assert.equal(
    text.includes("Đang hoạt động vlaw-set.v1"),
    true,
    "Must show active version badge",
  );

  // Must NOT repeat 'Mới nhất vlaw-set.v1 · Đang hoạt động'
  assert.equal(
    text.includes("Mới nhất vlaw-set.v1"),
    false,
    "Must not duplicate latest status when identical to active version",
  );

  // Case 2: latestVersion is different (e.g. newer DRAFT)
  const draftVersionSummary = {
    id: "ver-2222",
    version: "law-set.v2",
    status: "DRAFT" as const,
    basedOnVersionId: "ver-1111",
    createdAt: "2026-11-18T12:00:00Z",
    activatedAt: null,
    documentCount: 2,
    readyDocumentCount: 0,
    chunkCount: 10,
  };

  const sourceWithNewerDraft = {
    ...sourceWithSameLatest,
    versionCount: 2,
    latestVersion: draftVersionSummary,
  };

  const container2 = render(
    React.createElement(LegalSourceListCard, {
      source: sourceWithNewerDraft,
    }),
  );

  const text2 = container2.textContent ?? "";
  assert.equal(
    text2.includes("Đang hoạt động vlaw-set.v1"),
    true,
    "Must show active version",
  );
  assert.equal(
    text2.includes("Mới nhất vlaw-set.v2"),
    true,
    "Must show newer distinct draft version",
  );
});

test("resolvePreparationFailureDetails resolves structured diagnostic info from events and codes", async () => {
  const { resolvePreparationFailureDetails } = await import(
    "../src/features/admin/utils/legal-rule-formatter"
  );
  const t = (k: string) => k;

  // 1. TerminalCredentialError
  const credDetails = resolvePreparationFailureDetails({
    failureCode: "SELECTED_RULE_PREPARATION_FAILED",
    executionState: "FAILED",
    events: [
      {
        eventType: "MODEL_CALL_FAILED",
        data: {
          error_type: "TerminalCredentialError",
          last_attempt_error_class: "AnthropicConnectionError",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
        },
      },
    ],
    t,
  });
  assert.ok(credDetails);
  assert.equal(credDetails.title, "failureCredentialTitle");
  assert.equal(credDetails.provider, "anthropic");
  assert.equal(credDetails.model, "claude-sonnet-4-6");
  assert.equal(credDetails.technicalCode, "SELECTED_RULE_PREPARATION_FAILED");

  // 2. Rate limit
  const rateLimitDetails = resolvePreparationFailureDetails({
    failureCode: "TOKEN_LIMIT_EXCEEDED",
    executionState: "FAILED",
    t,
  });
  assert.ok(rateLimitDetails);
  assert.equal(rateLimitDetails.title, "failureRateLimitTitle");

  // 3. Ineligible source
  const ineligDetails = resolvePreparationFailureDetails({
    failureCode: "LEGAL_RULE_SOURCE_INELIGIBLE",
    executionState: "FAILED",
    t,
  });
  assert.ok(ineligDetails);
  assert.equal(ineligDetails.title, "failureSourceTitle");

  // 4. Returns null for non-failed state
  const notFailed = resolvePreparationFailureDetails({
    failureCode: null,
    executionState: "SUCCEEDED",
    t,
  });
  assert.equal(notFailed, null);
});
