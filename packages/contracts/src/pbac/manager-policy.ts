import { AO3_MANAGER_ONLY_ACTION_VALUES } from "./ao3-manager-policy.ts";
import { AO5_MANAGER_ONLY_ACTION_VALUES } from "./ao5-manager-policy.ts";
import { PBAC_ACTIONS } from "./actions.ts";

export const MANAGER_ONLY_ACTION_VALUES = [
  PBAC_ACTIONS.assessmentCreate,
  PBAC_ACTIONS.wizardWrite,
  PBAC_ACTIONS.wizardSubmit,
  PBAC_ACTIONS.wizardExport,
  PBAC_ACTIONS.conflictFinalize,
  PBAC_ACTIONS.conflictRead,
  PBAC_ACTIONS.conflictResolve,
  PBAC_ACTIONS.verifiedProfileApprove,
  PBAC_ACTIONS.classificationRun,
  PBAC_ACTIONS.finalReportGenerate,
  PBAC_ACTIONS.complianceDossierExport,
  PBAC_ACTIONS.managerDecisionChange,
  PBAC_ACTIONS.inviteDeveloper,
  PBAC_ACTIONS.membershipRevoke,
  PBAC_ACTIONS.assessmentSettingsManage,
  PBAC_ACTIONS.legalCorpusIngest,
  PBAC_ACTIONS.legalCorpusApprove,
  PBAC_ACTIONS.legalCorpusRead,
  PBAC_ACTIONS.legalRuleMatchRead,
  PBAC_ACTIONS.legalCitationValidate,
  PBAC_ACTIONS.classificationBaselineRead,
  PBAC_ACTIONS.classificationProposalValidate,
  PBAC_ACTIONS.gapMatrixEvaluate,
  PBAC_ACTIONS.gapEvidenceTraceRead,
  PBAC_ACTIONS.gapRemediationPropose,
  PBAC_ACTIONS.classificationReviewSubmit,
  ...AO5_MANAGER_ONLY_ACTION_VALUES,
  ...AO3_MANAGER_ONLY_ACTION_VALUES,
] as const;

export const MANAGER_ONLY_ACTIONS: string[] = [...MANAGER_ONLY_ACTION_VALUES];

export type ManagerOnlyAction = (typeof MANAGER_ONLY_ACTION_VALUES)[number];

export function isManagerOnlyAction(
  action: string,
): action is ManagerOnlyAction {
  return (MANAGER_ONLY_ACTIONS as readonly string[]).includes(action);
}

export function canUseManagerOnlyAction(
  grantedActions: readonly string[],
  action: ManagerOnlyAction,
): boolean {
  return isManagerOnlyAction(action) && grantedActions.includes(action);
}
