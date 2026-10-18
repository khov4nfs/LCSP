import { describe, expect, it, jest } from "@jest/globals";
import {
  AssessmentArtifactController,
  buildPdfResponseHeaders,
} from "./assessment-artifact.controller.js";

describe("assessment PDF response headers", () => {
  it("distinguishes source JSON integrity from the generated PDF entity", () => {
    const headers = buildPdfResponseHeaders("artifact-1", "a".repeat(64), 1234);
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["Content-Length"]).toBe("1234");
    expect(headers["Content-Disposition"]).toContain("artifact-1.pdf");
    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["X-LCSP-Source-Artifact-SHA256"]).toBe("a".repeat(64));
    expect(headers).not.toHaveProperty("ETag");
  });

  it("rejects historical V1 bytes before invoking the PDF renderer", async () => {
    const queries = {
      execute: jest.fn(() => ({
        artifactId: "artifact-1",
        contentSha256: "a".repeat(64),
        content: Buffer.from(
          JSON.stringify({ schemaVersion: "ASSESSMENT_FINAL_REPORT_V1" }),
        ),
      })),
    };
    const renderer = { render: jest.fn() };
    const controller = new AssessmentArtifactController(
      queries as never,
      renderer as never,
    );
    const response = { setHeader: jest.fn() };
    const request = {
      rbacContext: { userId: "user-1", role: "CUSTOMER" },
      correlationId: "corr-1",
    };
    await expect(
      controller.downloadPdf(
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111",
        request as never,
        response as never,
      ),
    ).rejects.toThrow();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
