import {
  RULE_ANALYSIS_ACTIVITIES,
  type RuleAnalysisActivity,
} from "@lcsp/contracts/evidence";

const PREFIX = "pages.appShell.agentStreamRule.activity";

/** i18n key of the customer-facing line for each RULE_ANALYSIS_* activity. */
export const RULE_ANALYSIS_ACTIVITY_KEYS = {
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisStarted]: `${PREFIX}.ruleAnalysisStarted`,
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisCompleted]: `${PREFIX}.ruleAnalysisCompleted`,
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisNeedsContext]: `${PREFIX}.ruleAnalysisNeedsContext`,
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisUnresolved]: `${PREFIX}.ruleAnalysisUnresolved`,
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisFailed]: `${PREFIX}.ruleAnalysisFailed`,
  [RULE_ANALYSIS_ACTIVITIES.businessContextRequested]: `${PREFIX}.businessContextRequested`,
  [RULE_ANALYSIS_ACTIVITIES.businessContextResolved]: `${PREFIX}.businessContextResolved`,
  [RULE_ANALYSIS_ACTIVITIES.ruleAnalysisResumed]: `${PREFIX}.ruleAnalysisResumed`,
  [RULE_ANALYSIS_ACTIVITIES.ruleApplicabilityEvaluated]: `${PREFIX}.ruleApplicabilityEvaluated`,
  [RULE_ANALYSIS_ACTIVITIES.ruleCompletionGated]: `${PREFIX}.ruleCompletionGated`,
} as const satisfies Record<RuleAnalysisActivity, string>;
