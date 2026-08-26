import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";

@Controller("internal/assessments")
@UseGuards(WorkerApiKeyGuard)
export class InternalWizardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":assessmentId/wizard-profile")
  async getWizardProfile(@Param("assessmentId") assessmentId: string) {
    const profile = await this.prisma.wizardProfile.findUnique({
      where: { assessmentId },
      select: {
        id: true,
        assessmentId: true,
        ownerId: true,
        version: true,
        status: true,
        answers: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!profile) {
      throw new NotFoundException("WizardProfile not found");
    }

    return {
      id: profile.id,
      assessment_id: profile.assessmentId,
      owner_id: profile.ownerId,
      version: profile.version,
      status: String(profile.status).toLowerCase(),
      answers: profile.answers,
      submitted_at: profile.submittedAt?.toISOString() ?? null,
      created_at: profile.createdAt.toISOString(),
      updated_at: profile.updatedAt.toISOString(),
    };
  }
}
