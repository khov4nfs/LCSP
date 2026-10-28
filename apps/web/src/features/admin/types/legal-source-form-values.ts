import type { z } from "zod";

import type {
  createLegalSourceFormSchema,
  importLegalSourceDocumentFormSchema,
  startLegalSourceVersionFormSchema,
  updateLegalSourceFormSchema,
  uploadLegalSourceDocumentFormSchema,
} from "../schemas/legal-source-form-schemas";

export type CreateLegalSourceFormValues = z.input<
  typeof createLegalSourceFormSchema
>;
export type CreateLegalSourceSubmission = z.output<
  typeof createLegalSourceFormSchema
>;
export type UpdateLegalSourceFormValues = z.input<
  typeof updateLegalSourceFormSchema
>;
export type UpdateLegalSourceSubmission = z.output<
  typeof updateLegalSourceFormSchema
>;
export type StartLegalSourceVersionFormValues = z.input<
  typeof startLegalSourceVersionFormSchema
>;
export type StartLegalSourceVersionSubmission = z.output<
  typeof startLegalSourceVersionFormSchema
>;
export type UploadLegalSourceDocumentFormValues = z.input<
  typeof uploadLegalSourceDocumentFormSchema
>;
export type UploadLegalSourceDocumentSubmission = z.output<
  typeof uploadLegalSourceDocumentFormSchema
>;
export type ImportLegalSourceDocumentFormValues = z.input<
  typeof importLegalSourceDocumentFormSchema
>;
export type ImportLegalSourceDocumentSubmission = z.output<
  typeof importLegalSourceDocumentFormSchema
>;
