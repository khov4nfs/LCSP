import { Injectable } from "@nestjs/common";
import type { PersistedWizardStatusCode } from "@lcsp/contracts/assessment";
import {
  fromPrismaWizardStatus,
  toPrismaWizardStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { WizardProfileRepository } from "../../application/ports/persistence/wizard-profile.repository.js";
import { WizardProfileEntity } from "../../domain/entities/wizard-profile.entity.js";
import type { WizardAnswer } from "@lcsp/contracts/wizard";

@Injectable()
export class PrismaWizardRepository implements WizardProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async verifyAssessmentOwnership(
    assessmentId: string,
    ownerId: string,
  ): Promise<boolean> {
    const count = await this.prisma.assessment.count({
      where: {
        id: assessmentId,
        ownerId: ownerId,
      },
    });
    return count > 0;
  }

  async findByAssessmentId(
    assessmentId: string,
  ): Promise<WizardProfileEntity | null> {
    const data = await this.prisma.wizardProfile.findUnique({
      where: { assessmentId },
    });
    if (!data) return null;
    return WizardProfileEntity.rehydrate({
      id: data.id,
      assessmentId: data.assessmentId,
      ownerId: data.ownerId,
      version: data.version,
      status: fromPrismaWizardStatus(data.status) as PersistedWizardStatusCode,
      answers: data.answers as unknown as WizardAnswer[],
      submittedAt: data.submittedAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async upsertDraft(
    profile: WizardProfileEntity,
  ): Promise<WizardProfileEntity> {
    const data = await this.prisma.wizardProfile.upsert({
      where: { assessmentId: profile.assessmentId },
      update: {
        answers: (profile.answers as unknown as Prisma.InputJsonArray) ?? [],
        version: profile.version,
        status: toPrismaWizardStatus(profile.status),
      },
      create: {
        id: profile.id, // Or let DB generate UUID if omitted, but Prisma upsert requires ID or will generate if it's in the schema. Assuming schema provides @default(uuid()).
        assessmentId: profile.assessmentId,
        ownerId: profile.ownerId,
        version: profile.version,
        status: toPrismaWizardStatus(profile.status),
        answers: (profile.answers as unknown as Prisma.InputJsonArray) ?? [],
      },
    });

    return WizardProfileEntity.rehydrate({
      id: data.id,
      assessmentId: data.assessmentId,
      ownerId: data.ownerId,
      version: data.version,
      status: fromPrismaWizardStatus(data.status) as PersistedWizardStatusCode,
      answers: data.answers as unknown as WizardAnswer[],
      submittedAt: data.submittedAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }
}
