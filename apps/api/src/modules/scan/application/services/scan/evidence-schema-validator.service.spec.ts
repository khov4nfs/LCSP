import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "@jest/globals";
import { SCAN_CALLBACK_STATUSES, SCAN_ERROR_CODES } from "@lcsp/contracts/scan";

import type { ScanCallbackRequest } from "../../contracts/scan/scan-callback.contract.js";
import { EvidenceSchemaValidatorService } from "./evidence-schema-validator.service.js";

const validator = new EvidenceSchemaValidatorService();

describe("EvidenceSchemaValidatorService", () => {
  it("accepts a clean supported payload", () => {
    expect(() =>
      validator.validate("job-1", payload(), "corr-1"),
    ).not.toThrow();
  });

  it.each([
    ["contains source", { containsSourceCode: true, secretsRedacted: true }],
    [
      "unredacted secrets",
      { containsSourceCode: false, secretsRedacted: false },
    ],
  ])("rejects invalid privacy flags: %s", (_name, privacyFlags) => {
    expectError(
      () =>
        validator.validate(
          "job-1",
          payload({ privacy_flags: privacyFlags }),
          "corr-1",
        ),
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
  });

  it("rejects an unknown schema version", () => {
    expectError(
      () =>
        validator.validate(
          "job-1",
          payload({ schema_version: "99.0" }),
          "corr-1",
        ),
      SCAN_ERROR_CODES.evidenceSchemaInvalid,
    );
  });

  it("requires error_code for a failed callback", () => {
    expectError(
      () =>
        validator.validate(
          "job-1",
          payload({ status: SCAN_CALLBACK_STATUSES.failed }),
          "corr-1",
        ),
      SCAN_ERROR_CODES.evidenceSchemaInvalid,
    );
  });

  it.each([
    { source_code: "const secret = true" },
    { nested: [{ raw_output: "scanner internals" }] },
    { description: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { token: "AKIAIOSFODNN7EXAMPLE" },
    { nested: { prompt: "do not persist" } },
    { nested: { ast_body: "Module(...)" } },
    { nested: { message: "def call_model():\n    return client.run()" } },
  ])("rejects unsafe evidence: %j", (evidencePayload) => {
    expectError(
      () =>
        validator.validate(
          "job-1",
          payload({ evidence_payload: evidencePayload }),
          "corr-1",
        ),
      SCAN_ERROR_CODES.privacyFlagsInvalid,
    );
  });
});

function payload(
  overrides: Partial<ScanCallbackRequest> = {},
): ScanCallbackRequest {
  return {
    scan_job_id: "job-1",
    tools_version: { semgrep: "1.0.0" },
    config_hash: { semgrep: "sha256:abc" },
    evidence_payload: { findings: [] },
    privacy_flags: {
      containsSourceCode: false,
      secretsRedacted: true,
    },
    schema_version: "1.0.0",
    status: SCAN_CALLBACK_STATUSES.success,
    ...overrides,
  };
}

function expectError(callback: () => void, errorCode: string): void {
  try {
    callback();
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      {
        ok: false,
        problem: { code: errorCode, correlationId: "corr-1" },
      },
    );
  }
}
