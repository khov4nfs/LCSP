import type { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";

export type ConflictStatus =
  (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES];

export interface ConflictSummary {
  conflict_id: string;
  conflict_type: string;
  conflict_score: number;
  score_explanation: string;
  status: ConflictStatus;
  evidence_refs: string[];
  created_at: string;
}

export interface ConflictListDto {
  conflicts: ConflictSummary[];
  total: number;
  page: number;
  page_size: number;
  correlationId: string;
}
