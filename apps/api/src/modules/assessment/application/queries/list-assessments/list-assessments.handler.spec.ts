import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { AssessmentDetailLoader } from "../../../infrastructure/persistence/assessment-detail.loader.js";
import { ListAssessmentsHandler } from "./list-assessments.handler.js";
import { ListAssessmentsQuery } from "./list-assessments.query.js";

describe("canonical assessment list filters", () => {
  it("passes validated lifecycle filters to the read loader", async () => {
    const list = jest.fn<AssessmentDetailLoader["list"]>().mockResolvedValue({
      assessments: [],
      total: 0,
      page: 1,
      page_size: 20,
      correlationId: "corr",
    });
    const query = new ListAssessmentsQuery(
      "owner",
      AUTH_USER_ROLES.customer,
      null,
      undefined,
      undefined,
      ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      "corr",
    );
    await new ListAssessmentsHandler({
      list,
    } as unknown as AssessmentDetailLoader).execute(query);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      }),
    );
  });
  it("rejects legacy stage/status filter vocabulary", () => {
    const handler = new ListAssessmentsHandler({} as AssessmentDetailLoader);
    expect(() =>
      handler.execute(
        new ListAssessmentsQuery(
          "owner",
          AUTH_USER_ROLES.customer,
          null,
          1,
          20,
          "WIZARD_SUBMITTED",
          "corr",
        ),
      ),
    ).toThrow();
  });
});
