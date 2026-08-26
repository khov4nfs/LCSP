import type {
  AssessmentStatusCode,
  WizardStatusCode,
} from "@lcsp/contracts/assessment";
import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { API_OUTCOME_KINDS } from "../../../lib/api/outcome-kinds.ts";

export type WorkspaceContext = {
  user: {
    id: string;
    display_name: string;
    role: AuthUserRole;
  };
};

export type AssessmentStatus = AssessmentStatusCode;

export type AssessmentSummary = {
  id: string;
  name: string;
  status: AssessmentStatus;
  wizard_status: WizardStatusCode;
  created_at: string;
};

export type WorkspaceRedirectOutcome = {
  kind: typeof API_OUTCOME_KINDS.redirect;
  location: string;
};

export type WorkspaceLoadedOutcome = {
  kind: typeof API_OUTCOME_KINDS.loaded;
  workspace: WorkspaceContext;
};

export type WorkspaceErrorOutcome = {
  kind: typeof API_OUTCOME_KINDS.error;
  titleKey: MessageKey;
  detailKey: MessageKey;
};

export type WorkspaceOutcome =
  WorkspaceLoadedOutcome | WorkspaceRedirectOutcome | WorkspaceErrorOutcome;

export type AssessmentsOutcome =
  | {
      kind: typeof API_OUTCOME_KINDS.loaded;
      assessments: AssessmentSummary[];
    }
  | WorkspaceErrorOutcome;
