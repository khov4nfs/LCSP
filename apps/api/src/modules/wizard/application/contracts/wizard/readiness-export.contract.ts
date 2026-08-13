import type {
  READINESS_CLASSIFICATION_STATUSES,
  READINESS_EXPORT_ARTIFACT_TYPES,
  READINESS_EXPORT_STATUSES,
} from "@lcsp/contracts/wizard";
import type { MissingEvidenceItem } from "./readiness.contract.js";

export type ReadinessExportStatus =
  (typeof READINESS_EXPORT_STATUSES)[keyof typeof READINESS_EXPORT_STATUSES];
export type ReadinessExportArtifactType =
  (typeof READINESS_EXPORT_ARTIFACT_TYPES)[keyof typeof READINESS_EXPORT_ARTIFACT_TYPES];
export type ReadinessClassificationStatus =
  (typeof READINESS_CLASSIFICATION_STATUSES)[keyof typeof READINESS_CLASSIFICATION_STATUSES];

export interface ReadinessExportContent {
  label: "Wizard Readiness Export";
  badge: "READINESS_ONLY";
  title: "Wizard Readiness Export";
  preview: string;
  metadata: {
    artifact_type: ReadinessExportArtifactType;
    label: "Wizard Readiness Export";
    readiness_only: true;
    classification_status: ReadinessClassificationStatus;
    assessment_id: string;
    assessment_name?: string;
    assessment_description?: string;
    organization_name?: string;
    owner_display_name?: string;
    wizard_profile_version: number;
    owner_id: string;
    generated_by: string;
    version: number;
    generated_at: string;
  };
  missing_evidence: MissingEvidenceItem[];
  unresolved_unknowns: string[];
  wizard_profile: {
    sections: ReadinessExportWizardSection[];
  };
  preparation_guidance: string[];
  next_steps: string[];
}

export interface ReadinessExportWizardSection {
  title: string;
  answers: ReadinessExportWizardAnswer[];
}

export interface ReadinessExportWizardAnswer {
  question_id: string;
  label: string;
  value: string;
  answer_state: string;
  selected_values?: string[];
  updated_at: string;
}

export interface ReadinessExportResponse {
  export_id: string;
  assessment_id: string;
  owner_id: string;
  status: ReadinessExportStatus;
  label: "Wizard Readiness Export";
  artifact_type: ReadinessExportArtifactType;
  readiness_only: true;
  classification_status: ReadinessClassificationStatus;
  classification_locked: true;
  missing_evidence?: MissingEvidenceItem[];
  unresolved_unknowns?: string[];
  preparation_guidance?: string[];
  generated_at: string;
  version: number;
  media_type?: "application/pdf";
  file_name?: string;
  download_url?: string;
  correlationId: string;
  blocked_reason?: string;
}
