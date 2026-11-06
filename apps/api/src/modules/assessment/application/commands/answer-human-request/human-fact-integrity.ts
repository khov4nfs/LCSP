import {
  HUMAN_FACT_CLAIMS,
  HUMAN_FACT_GUARD_FAILURES,
  HUMAN_FACT_TOPICS,
  type HumanFactClaim,
  type HumanFactGuardFailure,
  type HumanFactTopic,
} from "@lcsp/contracts/assessment-domain";

export type { HumanFactGuardFailure, HumanFactTopic };
export type HumanClaim = Exclude<
  HumanFactClaim,
  typeof HUMAN_FACT_CLAIMS.AMBIGUOUS
>;

export interface HumanFactResponse {
  question: string;
  answer: string;
}

/**
 * Business purpose: Prevent affirmative/negative operational assertions from
 * silently replacing unknown or conflicting HITL facts in the same assessment.
 *
 * Business rules:
 * - Only a narrow set of high-impact question topics is classified.
 * - Unknown incident/breach and unknown *formal* security classification must
 *   use doesNotKnow so they cannot be accepted as affirmative/refuting evidence.
 * - Explicit contradictions need human review; the API must not auto-correct
 *   previously accepted customer statements.
 * - This is a deterministic safety net, not general semantic fact verification.
 *
 * Execution flow:
 * 1. Identify the question topic and analyze explicit answer polarity.
 * 2. Check ambiguity inside the submitted answer.
 * 3. Compare with earlier answered requests about that same topic.
 *
 * Failure cases:
 * - An uncertain, ambiguous or conflicting high-impact assertion returns a
 *   typed reason. Other topics are unchanged until a stronger typed contract
 *   or evidence-backed conflict resolver is introduced.
 *
 * Side effects:
 * - No database changes; returns a typed failure reason or null.
 */
export function inspectHumanFactAnswer(
  question: string,
  answer: string,
  previous: readonly HumanFactResponse[],
): HumanFactGuardFailure | null {
  const topic = topicOf(question);
  if (!topic) return null;
  const claim = claimOf(topic, answer);
  if (claim === HUMAN_FACT_CLAIMS.AMBIGUOUS)
    return HUMAN_FACT_GUARD_FAILURES.AMBIGUOUS_HUMAN_ANSWER;
  if (claim === HUMAN_FACT_CLAIMS.UNKNOWN)
    return HUMAN_FACT_GUARD_FAILURES.UNKNOWN_ANSWER_MUST_USE_DOES_NOT_KNOW;
  if (!claim) return null;
  for (const prior of previous) {
    if (topicOf(prior.question) !== topic) continue;
    const earlier = claimOf(topic, prior.answer);
    if (
      earlier &&
      earlier !== HUMAN_FACT_CLAIMS.AMBIGUOUS &&
      earlier !== claim
    ) {
      // Old UNKNOWN must not be overruled by an unsupported NO or level
      // claim; definitive corrections need an explicit reviewed fact update.
      return HUMAN_FACT_GUARD_FAILURES.CONTRADICTS_PRIOR_HUMAN_FACT;
    }
  }
  return null;
}

/**
 * Business purpose: Route a limited set of material HITL questions to strict semantic checks.
 * Business rules:
 * - Recognize only incident, biometric/location breach and formal security-level topics.
 * Execution flow:
 * 1. Normalize case, match the strongest topical trigger, return the typed topic.
 * Failure cases:
 * - Unsupported or unrecognized questions return null without blocking the answer.
 * Side effects:
 * - None: pure classification of question text.
 */
export function topicOf(question: string): HumanFactTopic | null {
  const q = question.toLowerCase();
  if (
    /personal.data.breach|data.breach.involving|breach.involving.location/.test(
      q,
    ) &&
    /biometric|location/.test(q)
  )
    return HUMAN_FACT_TOPICS.SENSITIVE_DATA_BREACH;
  if (
    /security.level.classification|security.level.of.the.information.system|information.system.security.level/.test(
      q,
    )
  ) {
    return HUMAN_FACT_TOPICS.FORMAL_SECURITY_LEVEL;
  }
  if (
    /serious.(?:ai.system.)?incident|serious.incident/.test(q) &&
    /occurred|occur|happen|ever/.test(q) &&
    !/following|\(1\)|significant.changes/.test(q)
  )
    return HUMAN_FACT_TOPICS.SERIOUS_AI_INCIDENT;
  return null;
}

/**
 * Business purpose: Extract asserted claim category or ambiguous signal for a known topic.
 * Business rules:
 * - Ambiguous mixes of unknown and explicit assertions must be detected.
 * Execution flow:
 * 1. Test answer text against known patterns for the specific topic.
 * 2. Return a typed claim or ambiguity result, or null when unclassified.
 * Failure cases:
 * - Unrecognized answer text returns null.
 * Side effects:
 * - Pure string classification.
 */
export function claimOf(
  topic: HumanFactTopic,
  answer: string,
): HumanFactClaim | null {
  const text = answer.toLowerCase();
  const hasUnknown = /unknown|remains unknown|chưa xác định|không rõ/.test(
    text,
  );

  if (topic === HUMAN_FACT_TOPICS.SERIOUS_AI_INCIDENT) {
    const hasNo =
      /no serious incident|no,|no incident|không có sự cố|chưa từng xảy ra|has not occurred|has not experienced/.test(
        text,
      );
    const hasYes = /yes|has occurred|đã xảy ra|có sự cố/.test(text) && !hasNo;
    if (hasUnknown && (hasNo || /no,/.test(text)))
      return HUMAN_FACT_CLAIMS.AMBIGUOUS;
    if (hasUnknown) return HUMAN_FACT_CLAIMS.UNKNOWN;
    if (hasNo) return HUMAN_FACT_CLAIMS.NO;
    if (hasYes) return HUMAN_FACT_CLAIMS.YES;
    return null;
  }

  if (topic === HUMAN_FACT_TOPICS.FORMAL_SECURITY_LEVEL) {
    const hasLevel1 = /level 1|cấp độ 1/.test(text);
    const hasLevel2 = /level 2|cấp độ 2/.test(text);
    const hasLevel3 = /level 3|cấp độ 3/.test(text);
    const hasLevel4 = /level 4|cấp độ 4/.test(text);
    const hasNoFormal =
      /no formal classification|chưa phân cấp|không có phân loại chính thức/.test(
        text,
      );

    if (hasNoFormal && (hasLevel1 || hasLevel2 || hasLevel3 || hasLevel4)) {
      return HUMAN_FACT_CLAIMS.AMBIGUOUS;
    }
    if (hasUnknown) return HUMAN_FACT_CLAIMS.UNKNOWN;
    if (hasLevel1) return HUMAN_FACT_CLAIMS.LEVEL_1;
    if (hasLevel2) return HUMAN_FACT_CLAIMS.LEVEL_2;
    if (hasLevel3) return HUMAN_FACT_CLAIMS.LEVEL_3;
    if (hasLevel4) return HUMAN_FACT_CLAIMS.LEVEL_4;
    return null;
  }

  if (topic === HUMAN_FACT_TOPICS.SENSITIVE_DATA_BREACH) {
    const hasNo =
      /no breach|no,|không có sự cố lộ lọt|chưa từng xảy ra|has not occurred/.test(
        text,
      );
    const hasYes = /yes|has occurred|đã xảy ra/.test(text) && !hasNo;
    if (hasUnknown && hasNo) return HUMAN_FACT_CLAIMS.AMBIGUOUS;
    if (hasUnknown) return HUMAN_FACT_CLAIMS.UNKNOWN;
    if (hasNo) return HUMAN_FACT_CLAIMS.NO;
    if (hasYes) return HUMAN_FACT_CLAIMS.YES;
    return null;
  }

  return null;
}

/**
 * Business purpose: Suggest a candidate fact identifier for manual review of a high-impact human question.
 * Business rules:
 * - Topic equivalence is advisory and never authorizes factual reuse or a compliance outcome.
 * - Any caller must separately verify exact factual scope, assessment, source pins and accepted human authority before reuse.
 * Execution flow:
 * 1. Classify the question's limited topic and locate an earlier candidate with a resolved fact identifier.
 * 2. Return the candidate for independent verification without changing any request or fact.
 * Failure cases:
 * - Return null when no candidate matches; a returned identifier alone is never proof of a valid reusable fact.
 * Side effects:
 * - Pure projection; reads or writes no database state and grants no production acceptance authority.
 */
export function reusableHumanFactId(
  question: string,
  existing: readonly { question: string; resolvedFactId?: string | null }[],
): string | null {
  const targetTopic = topicOf(question);
  if (!targetTopic) return null;
  for (const item of existing) {
    if (topicOf(item.question) === targetTopic && item.resolvedFactId) {
      return item.resolvedFactId;
    }
  }
  return null;
}
