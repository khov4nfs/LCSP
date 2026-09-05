import {
  EMPTY_INTERVIEW_WORKING_STRATEGY,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewQuestion,
  type InterviewWorkingStrategy,
} from "@lcsp/contracts/evidence";

const MAX_ITEMS = 20;
const MAX_TEXT = 240;

export function updateInterviewWorkingStrategy(input: {
  current: InterviewWorkingStrategy;
  question?: AssessmentInterviewQuestion;
  answer: AssessmentInterviewAnswerInput;
}): InterviewWorkingStrategy {
  const answerText = [input.answer.freeText, input.answer.otherText]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim();
  const meaningful =
    input.answer.confirmed === true ||
    input.answer.adjusted === true ||
    (input.answer.selectedChoiceIds?.length ?? 0) > 0 ||
    answerText.length >= 20;
  if (!meaningful) return normalizeStrategy(input.current);

  const current = normalizeStrategy(input.current);
  const avoid = input.question?.id
    ? addBounded(current.avoidReaskingTopics, input.question.id)
    : current.avoidReaskingTopics;
  const pattern = input.question
    ? `${input.question.intent}:${input.question.control}`
    : undefined;
  const ambiguity = /\b(?:unclear|ambiguous|confused|not sure|unsure)\b/i.test(
    answerText,
  )
    ? `Ambiguity noted for ${input.question?.id ?? "the current topic"}.`
    : undefined;
  return normalizeStrategy({
    ...current,
    avoidReaskingTopics: avoid,
    effectiveQuestionPatterns: pattern
      ? addBounded(current.effectiveQuestionPatterns, pattern)
      : current.effectiveQuestionPatterns,
    interactionNotes: addBounded(
      current.interactionNotes,
      input.answer.confirmed
        ? "Customer confirmed the prior interpretation."
        : input.answer.adjusted
          ? "Customer adjusted the prior interpretation."
          : "Customer provided useful Interview context.",
    ),
    observedAmbiguities: ambiguity
      ? addBounded(current.observedAmbiguities, ambiguity)
      : current.observedAmbiguities,
    terminologyMap: extractTerminology(answerText, current.terminologyMap),
  });
}

export function normalizeStrategy(
  value: Partial<InterviewWorkingStrategy> | undefined,
): InterviewWorkingStrategy {
  const input = value ?? EMPTY_INTERVIEW_WORKING_STRATEGY;
  const terminologyMap = Object.fromEntries(
    Object.entries(input.terminologyMap ?? {})
      .filter(([key, mapped]) => key.trim() && mapped.trim())
      .slice(0, MAX_ITEMS)
      .map(([key, mapped]) => [
        key.slice(0, MAX_TEXT),
        mapped.slice(0, MAX_TEXT),
      ]),
  );
  return {
    terminologyMap,
    avoidReaskingTopics: boundedList(input.avoidReaskingTopics),
    effectiveQuestionPatterns: boundedList(input.effectiveQuestionPatterns),
    observedAmbiguities: boundedList(input.observedAmbiguities),
    interactionNotes: boundedList(input.interactionNotes),
  };
}

function boundedList(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, MAX_TEXT))
        .filter(Boolean),
    ),
  ).slice(0, MAX_ITEMS);
}

function addBounded(values: string[], value: string): string[] {
  return boundedList([...values, value]);
}

function extractTerminology(
  answer: string,
  current: Record<string, string>,
): Record<string, string> {
  const match =
    /(?:we call|we refer to)\s+(?:the\s+)?["']?([^"'.,;]{2,80})["']?\s+(?:as|to mean|means)\s+["']?([^"'.,;]{2,80})|(?:means)\s+["']?([^"'.,;]{2,80})["']?\s+(?:as|to mean|means)\s+["']?([^"'.,;]{2,80})/i.exec(
      answer,
    );
  if (!match) return current;
  const key = (match[1] ?? match[3]).trim();
  const value = (match[2] ?? match[4]).trim();
  return normalizeStrategy({ terminologyMap: { ...current, [key]: value } })
    .terminologyMap;
}
