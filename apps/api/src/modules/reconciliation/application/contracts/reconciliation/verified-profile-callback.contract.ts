import type { ReconcileVerifiedProfileResult } from "@lcsp/contracts/evidence";

export interface VerifiedProfileCallbackRequest {
  /** Immutable source identities required by the canonical reconciliation command. */
  ai_usage_flow_id: string;
  assessment_id: string;
  wizard_profile_id: string;
  technical_evidence_report_id: string;
  reconciliation_decision_refs: string[];
  idempotency_key: string;
  organization_id: string;
}

export interface VerifiedProfileCallbackDto {
  /** Canonical reconciliation handler result returned inside the HTTP success envelope. */
  status: string;
  result: ReconcileVerifiedProfileResult;
  correlationId: string;
}
