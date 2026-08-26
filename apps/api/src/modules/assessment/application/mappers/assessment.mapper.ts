import { Assessment } from "../../domain/entities/assessment.entity.js";
import type { CreateAssessmentDto } from "../contracts/assessment/create-assessment.contract.js";

/**
 * Maps assessment domain aggregates to application-facing contract shapes.
 */
export class AssessmentMapper {
  /**
   * Serializes a newly created assessment for the create-assessment response.
   *
   * @param assessment - Assessment aggregate to serialize.
   * @param correlationId - Request correlation identifier to include in the response contract.
   * @returns The create-assessment DTO containing primitive assessment fields.
   */
  static toCreateDto(
    assessment: Assessment,
    correlationId: string,
  ): CreateAssessmentDto {
    return {
      assessment_id: assessment.id,
      name: assessment.name,
      status: assessment.status,
      owner_id: assessment.ownerId,
      created_at: assessment.createdAt.toISOString(),
      correlationId: correlationId,
    };
  }
}
