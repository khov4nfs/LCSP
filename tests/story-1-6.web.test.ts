import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  canUseManagerOnlyAction,
  isManagerOnlyAction,
  MANAGER_ONLY_ACTIONS,
  PBAC_ACTIONS,
} from "@lcsp/contracts/pbac";
import { canCreateAssessment } from "@lcsp/web";

test("Story 1.6 manager-only action set covers accountable Manager authority", () => {
  assert.deepEqual(MANAGER_ONLY_ACTIONS, [
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
  ]);
});

test("Story 1.6 manager-only capability helper hides unavailable actions", () => {
  assert.equal(
    canUseManagerOnlyAction(
      [PBAC_ACTIONS.assessmentCreate],
      PBAC_ACTIONS.assessmentCreate,
    ),
    true,
  );
  assert.equal(
    canUseManagerOnlyAction(
      [PBAC_ACTIONS.assessmentRead],
      PBAC_ACTIONS.assessmentCreate,
    ),
    false,
  );
  assert.equal(isManagerOnlyAction(PBAC_ACTIONS.evidenceReadRedacted), false);
  assert.equal(canCreateAssessment([PBAC_ACTIONS.assessmentCreate]), true);
  assert.equal(canCreateAssessment([PBAC_ACTIONS.assessmentRead]), false);
});
