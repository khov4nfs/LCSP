import { BadRequestException, HttpStatus } from "@nestjs/common";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { describe, expect, it } from "@jest/globals";

import { ArtifactStorageIntegrityError } from "../../../../platform/storage/artifact-storage.service.js";
import {
  classifyFinalReportFailure,
  finalReportFailureCode,
  withFinalReportDependencyDeadline,
} from "./final-report-error-classifier.js";

describe("classifyFinalReportFailure", () => {
  it("preserves a standardized non-storage BadRequest instead of rewriting it as integrity conflict", () => {
    const original = new BadRequestException("standardized validation failure");

    expect(
      classifyFinalReportFailure(
        original,
        "classifier-bad-request",
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      ),
    ).toBe(original);
    expect(original.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it("maps an explicit immutable-storage integrity marker to safe 409", () => {
    const classified = classifyFinalReportFailure(
      new ArtifactStorageIntegrityError("private chunk collision detail"),
      "classifier-integrity",
      ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
    );

    expect(classified.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(JSON.stringify(classified.getResponse())).not.toMatch(
      /private chunk collision detail/u,
    );
  });

  it.each(["P2028", "P2034", "EACCES", "ENOENT"])(
    "maps operational dependency code %s to safe 503",
    (code) => {
      const classified = classifyFinalReportFailure(
        Object.assign(new Error("private dependency detail"), { code }),
        "classifier-dependency",
        ASSESSMENT_DOMAIN_ERROR_CODES.FINAL_REPORT_INVALID,
      );

      expect(classified.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(JSON.stringify(classified.getResponse())).not.toMatch(
        /private dependency detail|P2028|P2034|EACCES|ENOENT/u,
      );
    },
  );

  it("bounds a dependency operation that never settles", async () => {
    const failure = await withFinalReportDependencyDeadline(
      new Promise<never>(() => undefined),
      1,
    ).catch((error: unknown) => error);

    expect(finalReportFailureCode(failure)).toBe("ETIMEDOUT");
  });
});
