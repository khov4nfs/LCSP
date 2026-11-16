import {
  FACT_NEED_VALUE_KINDS,
  normalizedFactNeedAnswerSchema,
  type NormalizedFactNeedAnswer,
} from "@lcsp/contracts/assessment-domain";
import type { AssessmentFactNeed } from "@prisma/client";

/**
 * Business purpose: Convert a raw customer answer into the exact typed value declared by its canonical FactNeed before factual acceptance.
 *
 * Business rules:
 * - TEXT retains trimmed customer text; BOOLEAN accepts only explicit true/false tokens.
 * - INTEGER and NUMBER require complete finite numeric tokens rather than permissive partial parsing.
 * - DATE and DATE_TIME must satisfy the shared ISO contracts.
 * - ENUM resolves to the canonical allowed value using compatibility-equivalent case-insensitive matching.
 * - JSON must parse as a complete JSON value; no executable or language-specific syntax is accepted.
 *
 * Execution flow:
 * 1. Trim the raw value and select normalization by the persisted FactNeed value kind.
 * 2. Parse or canonicalize the complete value without inferring unstated operational meaning.
 * 3. Validate and return the shared normalized-answer contract.
 *
 * Failure cases:
 * - Empty, partial, out-of-range, malformed, non-finite or non-canonical values throw and must be returned as HUMAN_ANSWER_INVALID without case mutation.
 *
 * Side effects:
 * - Pure normalization; does not persist evidence, facts, proposals, decisions or audit records.
 */
export function normalizeFactNeedAnswer(
  factNeed: AssessmentFactNeed,
  rawAnswer: string,
): NormalizedFactNeedAnswer {
  const value = rawAnswer.trim();
  let normalized: unknown;
  switch (factNeed.valueKind) {
    case FACT_NEED_VALUE_KINDS.text:
      normalized = { kind: factNeed.valueKind, value };
      break;
    case FACT_NEED_VALUE_KINDS.boolean: {
      const booleanValue = value.toLowerCase();
      if (booleanValue !== "true" && booleanValue !== "false") {
        throw new Error("FACT_NEED_BOOLEAN_INVALID");
      }
      normalized = {
        kind: factNeed.valueKind,
        value: booleanValue === "true",
      };
      break;
    }
    case FACT_NEED_VALUE_KINDS.integer:
      if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) {
        throw new Error("FACT_NEED_INTEGER_INVALID");
      }
      normalized = { kind: factNeed.valueKind, value: Number(value) };
      break;
    case FACT_NEED_VALUE_KINDS.number:
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)) {
        throw new Error("FACT_NEED_NUMBER_INVALID");
      }
      normalized = { kind: factNeed.valueKind, value: Number(value) };
      break;
    case FACT_NEED_VALUE_KINDS.date:
    case FACT_NEED_VALUE_KINDS.dateTime:
      normalized = { kind: factNeed.valueKind, value };
      break;
    case FACT_NEED_VALUE_KINDS.enumeration: {
      const allowedValues = Array.isArray(factNeed.allowedValues)
        ? factNeed.allowedValues.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      const semanticValue = value.normalize("NFKC").toUpperCase();
      const canonicalValue = allowedValues.find(
        (item) => item.normalize("NFKC").toUpperCase() === semanticValue,
      );
      if (!canonicalValue) {
        throw new Error("FACT_NEED_ENUM_INVALID");
      }
      normalized = { kind: factNeed.valueKind, value: canonicalValue };
      break;
    }
    case FACT_NEED_VALUE_KINDS.json:
      normalized = {
        kind: factNeed.valueKind,
        value: JSON.parse(value) as unknown,
      };
      break;
  }
  return normalizedFactNeedAnswerSchema.parse(normalized);
}
