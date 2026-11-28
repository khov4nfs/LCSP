import type {
  DeleteLegalSourceResponse,
  LegalSourceDeletionImpactResponse,
  LegalSourceDocumentView,
  LegalSourceDetail,
  LegalSourceVersionDetail,
} from "@lcsp/contracts/legal-source";

export type LegalSourceReadinessProps = { version: LegalSourceVersionDetail };
export type LegalSourceDocumentStatusProps = {
  document: LegalSourceDocumentView;
};
export type LegalSourceDeletionImpactProps = {
  impact: LegalSourceDeletionImpactResponse;
};
export type LegalSourceDeletionResultProps = {
  receipt: DeleteLegalSourceResponse;
};
export type LegalSourceAddDocumentProps = { versionId: string };
export type LegalSourceDocumentDialogProps = LegalSourceAddDocumentProps & {
  importFromUrl?: boolean;
  onSuccess: () => void;
};
export type LegalSourceActivationDialogProps = LegalSourceReadinessProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeVersion?: string;
};

export type LegalSourceDocumentFormProps = LegalSourceAddDocumentProps & { onSuccess?: () => void };
export type LegalSourceDeleteDialogProps = { source: LegalSourceDetail; onDeleted?: (receipt: DeleteLegalSourceResponse) => void };
