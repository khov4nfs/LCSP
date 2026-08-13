import { Assessment } from "../../domain/entities/assessment.entity.js";
import type { CreateAssessmentDto } from "../contracts/assessment/create-assessment.contract.js";

export class AssessmentMapper {
  static toCreateDto(
    assessment: Assessment,
    correlationId: string,
  ): CreateAssessmentDto {
    return {
      assessment_id: assessment.id,
      name: assessment.name,
      status: assessment.status,
      owner_id: assessment.ownerId,
      organization_id: assessment.organizationId,
      created_at: assessment.createdAt.toISOString(),
      correlationId: correlationId,
    };
  }
}
