import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";

import type { AssessmentStatus } from "../types/workspace.types";

export const assessmentStatusLabelKeys = {
  [ASSESSMENT_STATUS_CODES.wizardInProgress]:
    "pages.workspace.statuses.WIZARD_IN_PROGRESS",
  [ASSESSMENT_STATUS_CODES.wizardSubmitted]:
    "pages.workspace.statuses.WIZARD_SUBMITTED",
  [ASSESSMENT_STATUS_CODES.evidenceRequired]:
    "pages.workspace.statuses.EVIDENCE_REQUIRED",
  [ASSESSMENT_STATUS_CODES.scanInProgress]:
    "pages.workspace.statuses.SCAN_IN_PROGRESS",
  [ASSESSMENT_STATUS_CODES.classificationLocked]:
    "pages.workspace.statuses.CLASSIFICATION_LOCKED",
  [ASSESSMENT_STATUS_CODES.readyForReview]:
    "pages.workspace.statuses.READY_FOR_REVIEW",
} as const satisfies Record<AssessmentStatus, MessageKey>;
