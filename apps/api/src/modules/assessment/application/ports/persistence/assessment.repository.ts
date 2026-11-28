import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { Prisma } from "@prisma/client";

export const ASSESSMENT_REPOSITORY = Symbol("ASSESSMENT_REPOSITORY");

/** Signals that an update target disappeared or no longer belongs to the expected owner. */
export class AssessmentUpdateTargetNotFoundError extends Error {
  constructor() {
    super("Assessment update target was not found");
    this.name = "AssessmentUpdateTargetNotFoundError";
  }
}

/** Signals that a persisted assessment changed after the aggregate was loaded. */
export class AssessmentRevisionConflictError extends Error {
  constructor() {
    super("Assessment revision is stale");
    this.name = "AssessmentRevisionConflictError";
  }
}

export interface AssessmentListCriteria {
  ownerId?: string;
  assessmentId?: string;
  page: number;
  pageSize: number;
}

export interface AssessmentListResult {
  items: Assessment[];
  total: number;
}

export interface AssessmentRepository {
  save(assessment: Assessment): Promise<void>;
  saveInTx(assessment: Assessment, tx: Prisma.TransactionClient): Promise<void>;
  findById(id: string): Promise<Assessment | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<Assessment | null>;
  findMany(criteria: AssessmentListCriteria): Promise<AssessmentListResult>;
}
