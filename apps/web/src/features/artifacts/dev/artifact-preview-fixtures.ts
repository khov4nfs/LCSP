import { ARTIFACT_STATUSES, ARTIFACT_TYPES, type ArtifactGroup } from "../types/artifact.types";

const item = (assessmentId: string, type: (typeof ARTIFACT_TYPES)[keyof typeof ARTIFACT_TYPES], title: string, context: string) => ({
  ref: { assessmentId, type },
  title,
  context,
  status: ARTIFACT_STATUSES.ready,
});

export const ARTIFACT_PREVIEW_GROUPS: ArtifactGroup[] = [
  {
    assessmentId: "preview-payment-ai",
    title: "Payment AI compliance review",
    context: "payment-service",
    updatedAt: "Updated 8 min ago",
    artifacts: [
      item("preview-payment-ai", ARTIFACT_TYPES.businessContext, "Business context", "Context document"),
      item("preview-payment-ai", ARTIFACT_TYPES.programEvidenceGraph, "Program Evidence Graph", "Evidence graph"),
      item("preview-payment-ai", ARTIFACT_TYPES.findingsReport, "Findings report", "Analysis document"),
      item("preview-payment-ai", ARTIFACT_TYPES.remediationPatch, "Remediation patch", "Code diff"),
      item("preview-payment-ai", ARTIFACT_TYPES.finalReport, "Final report", "PDF report"),
    ],
  },
  {
    assessmentId: "preview-retention",
    title: "Data retention policy audit",
    context: "identity-service",
    updatedAt: "Updated yesterday",
    artifacts: [
      item("preview-retention", ARTIFACT_TYPES.businessContext, "Business context", "Context document"),
      item("preview-retention", ARTIFACT_TYPES.evidenceGraph, "Evidence graph", "Evidence graph"),
      item("preview-retention", ARTIFACT_TYPES.findingsReport, "Findings report", "Analysis document"),
    ],
  },
  {
    assessmentId: "preview-remediation",
    title: "Repository remediation review",
    context: "checkout-service",
    updatedAt: "Updated Aug 28",
    artifacts: [
      item("preview-remediation", ARTIFACT_TYPES.remediationPatch, "Remediation patch", "Code diff"),
      item("preview-remediation", ARTIFACT_TYPES.verificationReport, "Verification report", "Verification report"),
    ],
  },
];
