import { NotFoundException } from "@nestjs/common";
import { jest } from "@jest/globals";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { InternalWizardController } from "./internal-wizard.controller.js";

function buildController() {
  const wizardProfileFindUnique =
    jest.fn<(args?: unknown) => Promise<Record<string, unknown> | null>>();
  const prisma = {
    wizardProfile: { findUnique: wizardProfileFindUnique },
  } as unknown as PrismaService;
  return {
    controller: new InternalWizardController(prisma),
    wizardProfileFindUnique,
  };
}

describe("InternalWizardController", () => {
  it("returns WizardProfile in the worker contract shape", async () => {
    const { controller, wizardProfileFindUnique } = buildController();
    wizardProfileFindUnique.mockResolvedValue({
      id: "wizard-1",
      assessmentId: "assessment-1",
      organizationId: "org-1",
      ownerId: "user-1",
      version: 2,
      status: "SUBMITTED",
      answers: { businessProcess: "loan_approval", aiPurpose: "scoring" },
      submittedAt: new Date("2026-08-08T01:00:00.000Z"),
      createdAt: new Date("2026-08-07T00:00:00.000Z"),
      updatedAt: new Date("2026-08-08T01:00:00.000Z"),
    });

    const result = await controller.getWizardProfile("assessment-1");

    expect(wizardProfileFindUnique).toHaveBeenCalledTimes(1);
    const [findUniqueArgs] = wizardProfileFindUnique.mock.calls[0] ?? [];
    expect(findUniqueArgs).toEqual({
      where: { assessmentId: "assessment-1" },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        ownerId: true,
        version: true,
        status: true,
        answers: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual({
      id: "wizard-1",
      assessment_id: "assessment-1",
      organization_id: "org-1",
      owner_id: "user-1",
      version: 2,
      status: "submitted",
      answers: { businessProcess: "loan_approval", aiPurpose: "scoring" },
      submitted_at: "2026-08-08T01:00:00.000Z",
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: "2026-08-08T01:00:00.000Z",
    });
  });

  it("returns 404 when no WizardProfile is linked", async () => {
    const { controller, wizardProfileFindUnique } = buildController();
    wizardProfileFindUnique.mockResolvedValue(null);

    await expect(
      controller.getWizardProfile("missing-assessment"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
