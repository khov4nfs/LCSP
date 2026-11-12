import { z } from "zod";
export const DEVELOPMENT_REVIEW_CASE_IDS = {
  RISK_CLASSIFICATION_BEFORE_USE: "RISK_CLASSIFICATION_BEFORE_USE",
  DATA_PROCESSING_IMPACT_DOSSIER: "DATA_PROCESSING_IMPACT_DOSSIER",
  RISK_DOSSIER_CONTENT: "RISK_DOSSIER_CONTENT",
  RISK_DOSSIER_RETENTION: "RISK_DOSSIER_RETENTION",
  MATERIAL_CHANGE_REASSESSMENT: "MATERIAL_CHANGE_REASSESSMENT",
  OPERATIONAL_INFORMATION_MEASURES: "OPERATIONAL_INFORMATION_MEASURES",
  CHILD_PRIVACY_DISCLOSURE_CONSENT: "CHILD_PRIVACY_DISCLOSURE_CONSENT",
} as const;
/** Review inputs, never pre-approved labels or legislation-specific runtime rules. */
export const developmentReviewCaseSchema = z.strictObject({
  caseId: z.enum(DEVELOPMENT_REVIEW_CASE_IDS), legalSourceVersionId: z.uuid(),
  sourceNodeIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  sourceLocators: z.array(z.string().min(1)).min(1), actor: z.string().min(1), action: z.string().min(1),
  rationale: z.string().min(1), candidateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  independentReviewerId: z.string().min(1).nullable(), approvedGoldDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
