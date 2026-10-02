import { EvidenceRedactorService } from "./evidence-redactor.service.js";

const finding = {
  finding_id: "finding-1",
  tool: "repository-analysis",
  finding_type: "AI_MODEL_INVOCATION",
  severity: "HIGH",
  description: "Model invocation detected",
  file_path: "src/ai-client.ts",
  line_number: 42,
};

describe("EvidenceRedactorService", () => {
  const service = new EvidenceRedactorService();

  it("projects only allowlisted fields and keeps locations for full reads", () => {
    const result = service.projectFindings(
      {
        findings: [
          {
            ...finding,
            raw_output: "must never escape",
            source_code: "const secret = process.env.KEY",
            metadata: { api_key: "hidden" },
          },
        ],
      },
      false,
    );

    expect(result).toEqual([finding]);
    expect(Object.keys(result[0] ?? {})).toEqual([
      "finding_id",
      "tool",
      "finding_type",
      "severity",
      "description",
      "file_path",
      "line_number",
    ]);
  });

  it("nulls every location for redacted reads", () => {
    expect(service.projectFindings({ findings: [finding] }, true)).toEqual([
      { ...finding, file_path: null, line_number: null },
    ]);
  });

  it("omits malformed findings and findings containing secret patterns", () => {
    const result = service.projectFindings(
      {
        findings: [
          { ...finding, finding_id: "" },
          {
            ...finding,
            finding_id: "finding-secret",
            description: "Token ghp_123456789012345678901234567890 leaked",
          },
          { ...finding, finding_id: "finding-safe", severity: "LOW" },
        ],
      },
      false,
    );

    expect(result).toEqual([
      { ...finding, finding_id: "finding-safe", severity: "LOW" },
    ]);
  });

  it("returns an empty projection when findings is not an array", () => {
    expect(service.projectFindings({ findings: {} }, false)).toEqual([]);
    expect(service.projectFindings(null, false)).toEqual([]);
  });
});
