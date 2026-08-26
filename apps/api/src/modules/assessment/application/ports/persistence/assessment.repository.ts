import {
  Assessment,
  type AssessmentStatus,
} from "../../../domain/entities/assessment.entity.js";
import type { Prisma } from "@prisma/client";

export const ASSESSMENT_REPOSITORY = Symbol("ASSESSMENT_REPOSITORY");

export interface AssessmentListCriteria {
  ownerId?: string;
  assessmentId?: string;
  status?: AssessmentStatus;
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
  findMany(criteria: AssessmentListCriteria): Promise<AssessmentListResult>;
}
