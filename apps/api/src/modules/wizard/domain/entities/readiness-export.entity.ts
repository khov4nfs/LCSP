import type { ReadinessExportContent } from "../../application/contracts/wizard/readiness-export.contract.js";
import type { ReadinessExportStatus } from "../../application/contracts/wizard/readiness-export.contract.js";

export interface ReadinessExportEntity {
  id: string;
  assessmentId: string;
  ownerId: string;
  version: number;
  status: ReadinessExportStatus;
  contentJson: ReadinessExportContent | null;
  blockedReason: string | null;
  generatedAt: Date;
}
