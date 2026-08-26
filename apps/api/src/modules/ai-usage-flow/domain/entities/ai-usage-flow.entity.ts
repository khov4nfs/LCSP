import { randomUUID } from "node:crypto";

import { AI_USAGE_FLOW_STATUSES } from "@lcsp/contracts/scan";

/**
 * Represents an accepted AI usage-flow artifact linked to one technical profile and assessment.
 */
export class AIUsageFlowEntity {
  readonly id: string = randomUUID();

  /**
   * Creates an AI usage-flow entity from already validated persistence fields.
   *
   * @param technicalProfileId - Technical profile that produced the usage-flow analysis.
   * @param assessmentId - Assessment owning the technical profile.
   * @param schemaVersion - Callback schema version used by the worker.
   * @param providerVersion - AI usage-flow provider/version identifier.
   * @param claims - Accepted deterministic usage claims.
   * @param unknownUsages - Usage observations that could not be deterministically classified.
   * @param privacyFlags - Sanitization/privacy assertions supplied with the artifact.
   * @param status - Current AI usage-flow lifecycle status.
   * @param createdAt - Entity creation timestamp.
   */
  private constructor(
    readonly technicalProfileId: string,
    readonly assessmentId: string,
    readonly schemaVersion: string,
    readonly providerVersion: string,
    readonly claims: readonly unknown[],
    readonly unknownUsages: readonly unknown[],
    readonly privacyFlags: Record<string, unknown>,
    readonly status: string,
    readonly createdAt: Date,
  ) {}

  /**
   * Creates an accepted AI usage-flow entity and applies the accepted lifecycle status.
   *
   * @param fields - Technical-profile linkage, provider metadata, sanitized claims, privacy flags, and optional creation time.
   * @returns A newly accepted AI usage-flow entity.
   */
  static accept(fields: {
    technicalProfileId: string;
    assessmentId: string;
    schemaVersion: string;
    providerVersion: string;
    claims: readonly unknown[];
    unknownUsages: readonly unknown[];
    privacyFlags: Record<string, unknown>;
    createdAt?: Date;
  }): AIUsageFlowEntity {
    return new AIUsageFlowEntity(
      fields.technicalProfileId,
      fields.assessmentId,
      fields.schemaVersion,
      fields.providerVersion,
      fields.claims,
      fields.unknownUsages,
      fields.privacyFlags,
      AI_USAGE_FLOW_STATUSES.accepted,
      fields.createdAt ?? new Date(),
    );
  }
}
