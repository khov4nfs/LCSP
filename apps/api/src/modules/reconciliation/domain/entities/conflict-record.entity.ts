import { randomUUID } from "node:crypto";

import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";

export class ConflictRecordEntity {
  readonly id: string = randomUUID();

  private constructor(
    readonly aiUsageFlowId: string,
    readonly assessmentId: string,
    readonly conflictType: string,
    readonly conflictScore: number,
    readonly scoreExplanation: string,
    readonly evidenceRefs: readonly string[],
    readonly status: string,
    readonly createdAt: Date,
  ) {}

  static pending(fields: {
    aiUsageFlowId: string;
    assessmentId: string;
    conflictType: string;
    conflictScore: number;
    scoreExplanation: string;
    evidenceRefs: readonly string[];
    createdAt?: Date;
  }): ConflictRecordEntity {
    return new ConflictRecordEntity(
      fields.aiUsageFlowId,
      fields.assessmentId,
      fields.conflictType,
      fields.conflictScore,
      fields.scoreExplanation,
      fields.evidenceRefs,
      CONFLICT_RECORD_STATUSES.pending,
      fields.createdAt ?? new Date(),
    );
  }
}
