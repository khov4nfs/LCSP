import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatEngineeringConcept,
  formatEngineeringReason,
} from "@lcsp/i18n";

test("classification concepts render through the selected locale", () => {
  assert.equal(
    formatEngineeringConcept("vi", "CLASSIFICATION_DOSSIER_AND_NOTIFICATION"),
    "Hồ sơ phân loại và thông báo",
  );
  assert.equal(
    formatEngineeringConcept("en", "CLASSIFICATION_DOSSIER_AND_NOTIFICATION"),
    "Classification dossier and notification",
  );
  assert.equal(
    formatEngineeringConcept("vi", "MACHINE_READABLE_AI_MEDIA_MARK"),
    "Đánh dấu nội dung AI ở định dạng máy có thể đọc",
  );
  assert.equal(
    formatEngineeringConcept("en", "MACHINE_READABLE_AI_MEDIA_MARK"),
    "Machine-readable AI media marking",
  );
});

test("current Vietnamese classification catalog has explicit readable labels", () => {
  const cases: Array<[string, string]> = [
    [
      "RISK_RECLASSIFICATION_TRIGGER",
      "Kích hoạt phân loại lại khi rủi ro thay đổi",
    ],
    [
      "DIRECT_AI_INTERACTION_DISCLOSURE",
      "Thông báo khi tương tác trực tiếp với AI",
    ],
    [
      "PUBLIC_AI_CONTENT_NOTICE",
      "Thông báo nội dung do AI tạo ra khi cung cấp công khai",
    ],
    ["DEEPFAKE_VISIBLE_LABEL", "Gắn nhãn dễ nhận biết cho nội dung deepfake"],
    [
      "TRANSPARENCY_CONTINUITY",
      "Duy trì thông tin minh bạch trong suốt quá trình cung cấp",
    ],
    [
      "AI_INCIDENT_DETECTION_AND_REMEDIATION",
      "Phát hiện và khắc phục sự cố AI",
    ],
    [
      "SERIOUS_AI_INCIDENT_CONTAINMENT",
      "Khoanh vùng và xử lý sự cố AI nghiêm trọng",
    ],
    ["INCIDENT_RECORDING_AND_REPORTING", "Ghi nhận và báo cáo sự cố"],
    [
      "DIGITAL_INDUSTRY_IP_COMPLIANCE",
      "Tuân thủ sở hữu trí tuệ trong công nghiệp công nghệ số",
    ],
    [
      "CONTROLLED_TESTING_SUPPORT_FRAUD",
      "Gian dối để hưởng hỗ trợ hoặc loại trừ trách nhiệm trong thử nghiệm có kiểm soát",
    ],
  ];

  for (const [concept, expected] of cases) {
    assert.equal(formatEngineeringConcept("vi", concept), expected);
  }
});

test("unknown machine labels still use a locale-aware fallback", () => {
  assert.equal(
    formatEngineeringConcept("vi", "AI_SECURITY_RISK_ASSESSMENT"),
    "AI bảo mật rủi ro đánh giá",
  );
  assert.equal(
    formatEngineeringConcept("en", "AI_SECURITY_RISK_ASSESSMENT"),
    "AI Security Risk Assessment",
  );
});

test("deterministic evaluator reasons remain localized", () => {
  assert.equal(
    formatEngineeringReason(
      "vi",
      "Repository evidence demonstrates that the engineering requirement is met.",
    ),
    "Bằng chứng trong repository cho thấy yêu cầu kỹ thuật này đã được đáp ứng.",
  );
});
