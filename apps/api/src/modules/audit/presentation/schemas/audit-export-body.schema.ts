import { z } from "zod";

// Strict parsing keeps unknown request fields out of the export command boundary.
export const auditExportBodySchema = z.strictObject({
  from_date: z.iso.datetime({ offset: true }),
  to_date: z.iso.datetime({ offset: true }),
});

export type AuditExportBody = z.infer<typeof auditExportBodySchema>;
