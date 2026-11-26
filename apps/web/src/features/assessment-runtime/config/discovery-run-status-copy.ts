import { ASSESSMENT_DISCOVERY_RUN_STATUSES } from "@lcsp/contracts/assessment-domain";

/** i18n key (under the assessment conversation namespace) naming each discovery run status for the customer. */
export const DISCOVERY_RUN_STATUS_COPY_KEYS = {
  [ASSESSMENT_DISCOVERY_RUN_STATUSES.queued]:
    "ruleAudit.discovery.statusQueued",
  [ASSESSMENT_DISCOVERY_RUN_STATUSES.running]:
    "ruleAudit.discovery.statusRunning",
  [ASSESSMENT_DISCOVERY_RUN_STATUSES.completed]:
    "ruleAudit.discovery.statusCompleted",
  [ASSESSMENT_DISCOVERY_RUN_STATUSES.failed]:
    "ruleAudit.discovery.statusFailed",
} as const;
