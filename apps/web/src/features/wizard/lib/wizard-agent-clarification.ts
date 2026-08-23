import {
  WIZARD_CLARIFICATION_AGENT_STATUSES,
  WIZARD_CLARIFICATION_AGENT_TARGET_KINDS,
  WIZARD_CLARIFICATION_REQUEST_KIND,
} from "@lcsp/contracts/wizard";
import type {
  WizardClarificationAgentQuestion,
  WizardClarificationAgentStatus,
  WizardClarificationAgentTargetKind,
} from "@lcsp/contracts/wizard";

import type { WorkspaceRuntimeActivityItem } from "@/features/workspace/types/workspace-runtime.types";
import type { WizardAnswers } from "@/features/wizard/types/wizard.types";

export type WizardAgentClarificationPrompt =
  WizardClarificationAgentQuestion & {
    targetFieldName: keyof WizardAnswers;
  };

const WIZARD_ANSWER_FIELD_NAMES = {
  postGraphContext: "postGraphContext",
  postGraphRuleScope: "postGraphRuleScope",
  postGraphHumanReviewBoundary: "postGraphHumanReviewBoundary",
} as const satisfies Record<string, keyof WizardAnswers>;

const WIZARD_ANSWER_FIELD_NAME_SET = new Set<string>(
  Object.values(WIZARD_ANSWER_FIELD_NAMES),
);

export function getWizardAgentClarificationPrompts(
  activity: WorkspaceRuntimeActivityItem[],
): WizardAgentClarificationPrompt[] {
  const prompts: WizardAgentClarificationPrompt[] = [];
  const seen = new Set<string>();
  const seenTargetFields = new Set<string>();

  for (const item of activity) {
    const questions = extractAgentQuestions(item);
    for (const question of questions) {
      if (!isWizardFieldTarget(question)) {
        continue;
      }
      const key = `${question.targetFieldName}:${normalizeQuestionText(question.text)}`;
      if (seen.has(key) || seenTargetFields.has(question.targetFieldName)) {
        continue;
      }
      seen.add(key);
      seenTargetFields.add(question.targetFieldName);
      prompts.push(question);
    }
  }

  return prompts;
}

export function toWizardAgentClarificationPrompts(
  questions: WizardClarificationAgentQuestion[],
): WizardAgentClarificationPrompt[] {
  const prompts: WizardAgentClarificationPrompt[] = [];
  const seen = new Set<string>();
  const seenTargetFields = new Set<string>();
  for (const question of questions) {
    if (!isWizardFieldTarget(question)) {
      continue;
    }
    const key = `${question.targetFieldName}:${normalizeQuestionText(question.text)}`;
    if (seen.has(key) || seenTargetFields.has(question.targetFieldName)) {
      continue;
    }
    seen.add(key);
    seenTargetFields.add(question.targetFieldName);
    prompts.push(question);
  }
  return prompts;
}

function extractAgentQuestions(
  item: WorkspaceRuntimeActivityItem,
): WizardClarificationAgentQuestion[] {
  const summaries = [item.outputSummary, item.inputSummary];
  for (const summary of summaries) {
    if (
      summary === null ||
      typeof summary !== "object" ||
      Array.isArray(summary)
    ) {
      continue;
    }
    if (summary.kind !== WIZARD_CLARIFICATION_REQUEST_KIND) {
      continue;
    }
    if (!Array.isArray(summary.questions)) {
      continue;
    }
    return summary.questions.filter(isAgentQuestion);
  }
  return [];
}

function isAgentQuestion(
  value: unknown,
): value is WizardClarificationAgentQuestion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.text === "string" &&
    typeof record.language === "string" &&
    isAgentTargetKind(record.targetKind) &&
    typeof record.severity === "string" &&
    typeof record.reasonCode === "string" &&
    Array.isArray(record.evidenceRefs) &&
    record.evidenceRefs.every((item) => typeof item === "string") &&
    isAgentStatus(record.status) &&
    typeof record.routingMethod === "string" &&
    typeof record.routingConfidence === "number" &&
    typeof record.answerControl === "string"
  );
}

function isAgentTargetKind(
  value: unknown,
): value is WizardClarificationAgentTargetKind {
  return (
    typeof value === "string" &&
    Object.values(WIZARD_CLARIFICATION_AGENT_TARGET_KINDS).includes(
      value as WizardClarificationAgentTargetKind,
    )
  );
}

function isAgentStatus(
  value: unknown,
): value is WizardClarificationAgentStatus {
  return (
    typeof value === "string" &&
    Object.values(WIZARD_CLARIFICATION_AGENT_STATUSES).includes(
      value as WizardClarificationAgentStatus,
    )
  );
}

function isWizardFieldTarget(
  question: WizardClarificationAgentQuestion,
): question is WizardAgentClarificationPrompt {
  return (
    question.status === WIZARD_CLARIFICATION_AGENT_STATUSES.pending &&
    question.targetKind !==
      WIZARD_CLARIFICATION_AGENT_TARGET_KINDS.generalContext &&
    question.targetKind !==
      WIZARD_CLARIFICATION_AGENT_TARGET_KINDS.plannerScope &&
    question.targetFieldName !== undefined &&
    WIZARD_ANSWER_FIELD_NAME_SET.has(question.targetFieldName)
  );
}

function normalizeQuestionText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
