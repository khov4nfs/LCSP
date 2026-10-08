import {
  LEGACY_ASSESSMENT_DISPOSITIONS,
  LEGACY_TERMINAL_ASSESSMENT_STATUSES,
  type LegacyAssessmentDisposition,
} from "@lcsp/contracts/legacy-migration";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(
  Object.values(LEGACY_TERMINAL_ASSESSMENT_STATUSES),
);

/**
 * Terminal V1 assessments are archived read-only and never receive a V2 lifecycle or completion;
 * every other V1 assessment continues in V2 with a fresh thread and state. The V1 status is only
 * used to choose the disposition, never to derive a V2 state or decision.
 */
export function classifyLegacyAssessment(
  legacyStatus: string,
): LegacyAssessmentDisposition {
  return TERMINAL_STATUSES.has(legacyStatus)
    ? LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL
    : LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL;
}
