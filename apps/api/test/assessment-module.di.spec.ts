import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "@jest/globals";

import { AssessmentModule } from "../src/modules/assessment/assessment.module.js";
import { ASSESSMENT_BILLING_RETENTION } from "../src/modules/assessment/application/ports/billing/assessment-billing-retention.port.js";
import { DeleteAssessmentHandler } from "../src/modules/assessment/application/commands/delete-assessment/delete-assessment.handler.js";

describe("AssessmentModule dependency injection", () => {
  let moduleRef: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it("resolves the delete handler together with its billing retention port", async () => {
    const compiled = await Test.createTestingModule({
      imports: [AssessmentModule],
    }).compile();
    moduleRef = compiled;

    expect(compiled.get(ASSESSMENT_BILLING_RETENTION)).toBeDefined();
    expect(compiled.get(DeleteAssessmentHandler)).toBeInstanceOf(
      DeleteAssessmentHandler,
    );
  });
});
