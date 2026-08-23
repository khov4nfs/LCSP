import type { ZodError } from "zod";
import { ANSWER_STATES } from "@lcsp/contracts/wizard";
import type { WizardAnswer, AnswerState } from "@lcsp/contracts/wizard";

import {
  selectOptions,
  WIZARD_LOCAL_STORAGE_PREFIX,
} from "@/features/wizard/config/wizard-config";
import {
  wizardPreScreenSchema,
  wizardStepSchemas,
  wizardSubmitSchema,
} from "@/features/wizard/schemas/wizard-form.schema";
import type { WizardAnswers } from "@/features/wizard/types/wizard.types";
import type { WizardHelperKey } from "@/features/wizard/types/wizard-form.types";

import { t } from "./wizard-i18n";

export const sectionCardClassName = "border-border bg-card shadow-sm";

export function getHelperCopy(helperKey: WizardHelperKey) {
  switch (helperKey) {
    case "decision":
      return {
        titleKey: "pages.wizard.helpers.decisionTitle" as const,
        bodyKey: "pages.wizard.helpers.decisionBody" as const,
      };
    case "oversight":
      return {
        titleKey: "pages.wizard.helpers.humanOversightTitle" as const,
        bodyKey: "pages.wizard.helpers.humanOversightBody" as const,
      };
    case "provider":
      return {
        titleKey: "pages.wizard.helpers.providerTitle" as const,
        bodyKey: "pages.wizard.helpers.providerBody" as const,
      };
    case "biometric":
      return {
        titleKey: "pages.wizard.helpers.biometricTitle" as const,
        bodyKey: "pages.wizard.helpers.biometricBody" as const,
      };
    case "specialCategory":
      return {
        titleKey: "pages.wizard.helpers.specialCategoryTitle" as const,
        bodyKey: "pages.wizard.helpers.specialCategoryBody" as const,
      };
    case "highImpact":
      return {
        titleKey: "pages.wizard.helpers.highImpactTitle" as const,
        bodyKey: "pages.wizard.helpers.highImpactBody" as const,
      };
    case "prohibited":
      return {
        titleKey: "pages.wizard.helpers.prohibitedTitle" as const,
        bodyKey: "pages.wizard.helpers.prohibitedBody" as const,
      };
    case "transparency":
      return {
        titleKey: "pages.wizard.helpers.transparencyTitle" as const,
        bodyKey: "pages.wizard.helpers.transparencyBody" as const,
      };
    case "deployment":
      return {
        titleKey: "pages.wizard.helpers.deploymentTitle" as const,
        bodyKey: "pages.wizard.helpers.deploymentBody" as const,
      };
    default:
      return {
        titleKey: "pages.wizard.helperTitle" as const,
        bodyKey: "pages.wizard.helperDescription" as const,
      };
  }
}

export function validateStep(stepIndex: number, answers: WizardAnswers) {
  const result = wizardStepSchemas[stepIndex]?.safeParse(answers);
  if (!result || result.success) {
    return {};
  }

  return getFieldErrors(result.error);
}

export function validatePreScreen(answers: WizardAnswers) {
  const result = wizardPreScreenSchema.safeParse(answers);
  if (result.success) {
    return {};
  }

  return getFieldErrors(result.error);
}

export function validateAllSteps(answers: WizardAnswers) {
  const result = wizardSubmitSchema.safeParse(answers);
  if (result.success) {
    return {};
  }

  return getFieldErrors(result.error);
}

export function isDetailedPhaseReady(answers: WizardAnswers) {
  return (
    hasTextValue(answers.ps_001_ai_scope) &&
    hasArrayValue(answers.ps_002_affected_people) &&
    hasTextValue(answers.ps_003_personal_or_sensitive_data) &&
    hasTextValue(answers.ps_004_decision_importance)
  );
}

export function isStepComplete(stepIndex: number, answers: WizardAnswers) {
  return Object.keys(validateStep(stepIndex, answers)).length === 0;
}

export function readLocalDraft(assessmentId: string): WizardAnswers {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(
      `${WIZARD_LOCAL_STORAGE_PREFIX}:${assessmentId}`,
    );

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    return parsed as WizardAnswers;
  } catch {
    return {};
  }
}

export function writeLocalDraft(assessmentId: string, answers: WizardAnswers) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    `${WIZARD_LOCAL_STORAGE_PREFIX}:${assessmentId}`,
    JSON.stringify(answers),
  );
}

export function clearLocalDraft(assessmentId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(
    `${WIZARD_LOCAL_STORAGE_PREFIX}:${assessmentId}`,
  );
}

export function normalizeAnswers(answers: WizardAnswers): WizardAnswers {
  return {
    ...answers,
    dataTypes: Array.isArray(answers.dataTypes) ? answers.dataTypes : [],
    affectedSubjects: Array.isArray(answers.affectedSubjects)
      ? answers.affectedSubjects
      : [],
    highImpactIndicators: Array.isArray(answers.highImpactIndicators)
      ? answers.highImpactIndicators
      : [],
    transparencyIndicators: Array.isArray(answers.transparencyIndicators)
      ? answers.transparencyIndicators
      : [],
    prohibitedRiskSignals: Array.isArray(answers.prohibitedRiskSignals)
      ? answers.prohibitedRiskSignals
      : [],
    deploymentContext: Array.isArray(answers.deploymentContext)
      ? answers.deploymentContext
      : [],
    ps_002_affected_people: Array.isArray(answers.ps_002_affected_people)
      ? answers.ps_002_affected_people
      : [],
  };
}

export function serializeAnswers(answers: WizardAnswers): WizardAnswer[] {
  const serialized: WizardAnswer[] = [];
  const now = new Date().toISOString();

  // Iterate over all answers and convert to WizardAnswer
  Object.entries(answers).forEach(([key, value]) => {
    if (value === undefined) return;

    if (key === "decisionRole" && value === "NO_DECISION_SUPPORT") {
      serialized.push({
        questionId: key,
        value,
        answerState: ANSWER_STATES.answered,
        updatedAt: now,
      });
      serialized.push({
        questionId: "humanReview",
        value: "NOT_APPLICABLE",
        answerState: ANSWER_STATES.answered,
        updatedAt: now,
      });
    } else if (
      key === "humanReview" &&
      answers.decisionRole === "NO_DECISION_SUPPORT"
    ) {
      // Handled above
      return;
    } else {
      let state: AnswerState = ANSWER_STATES.answered;
      const finalValue = value;
      if (value === "unknown" || value === "UNKNOWN" || value === "UNCLEAR") {
        state = ANSWER_STATES.explicitUnknown;
      } else if (Array.isArray(value) && value.includes("unknown")) {
        // if array includes unknown, the whole array might just be unknown, but the contract says value is unknown.
        // Actually, if it's an array and user selects unknown, WIZARD-MAPPING says value: "unknown" or value: ["unknown"]?
        // Let's keep it simple: if "unknown" is in the array, it's explicitUnknown
        state = ANSWER_STATES.explicitUnknown;
      }
      serialized.push({
        questionId: key,
        value: finalValue,
        answerState: state,
        updatedAt: now,
      });
    }
  });

  return serialized;
}

export function toBooleanSelectValue(value: boolean | undefined) {
  if (value === true) {
    return "yes";
  }

  if (value === false) {
    return "no";
  }

  return "";
}

export function getSummaryItems(answers: WizardAnswers) {
  const items: Array<{ label: string; value: string }> = [];

  if (answers.businessProcess) {
    items.push({
      label: t("pages.wizard.fields.businessProcessLabel"),
      value: answers.businessProcess,
    });
  }
  if (answers.useCase) {
    items.push({
      label: t("pages.wizard.fields.useCaseLabel"),
      value: answers.useCase,
    });
  }
  if (answers.primaryActors) {
    items.push({
      label: t("pages.wizard.fields.primaryActorsLabel"),
      value: answers.primaryActors,
    });
  }
  if (answers.businessTrigger) {
    items.push({
      label: t("pages.wizard.fields.businessTriggerLabel"),
      value: answers.businessTrigger,
    });
  }
  if (answers.expectedOutcome) {
    items.push({
      label: t("pages.wizard.fields.expectedOutcomeLabel"),
      value: answers.expectedOutcome,
    });
  }
  if (answers.autonomyLevel) {
    items.push({
      label: t("pages.wizard.fields.autonomyLevelLabel"),
      value: getOptionDisplayLabel(
        selectOptions.autonomyLevel,
        answers.autonomyLevel,
      ),
    });
  }
  if (answers.sector) {
    items.push({
      label: t("pages.wizard.fields.sectorLabel"),
      value: getOptionDisplayLabel(selectOptions.sector, answers.sector),
    });
  }
  if (answers.dataTypes?.length) {
    items.push({
      label: t("pages.wizard.fields.dataTypeLabel"),
      value: answers.dataTypes.join(", "),
    });
  }
  if (answers.affectedSubjects?.length) {
    items.push({
      label: t("pages.wizard.fields.affectedSubjectsLabel"),
      value: answers.affectedSubjects.join(", "),
    });
  }
  if (answers.userImpact) {
    items.push({
      label: t("pages.wizard.fields.userImpactLabel"),
      value: getOptionDisplayLabel(
        selectOptions.userImpact,
        answers.userImpact,
      ),
    });
  }
  if (answers.decisionRole) {
    items.push({
      label: t("pages.wizard.fields.decisionRoleLabel"),
      value: getOptionDisplayLabel(
        selectOptions.decisionRole,
        answers.decisionRole,
      ),
    });
  }
  if (answers.humanReview) {
    items.push({
      label: t("pages.wizard.fields.humanReviewLabel"),
      value: getOptionDisplayLabel(
        selectOptions.humanOversight,
        answers.humanReview,
      ),
    });
  }
  if (answers.externalLlmUsage) {
    items.push({
      label: t("pages.wizard.fields.externalLlmUsageLabel"),
      value: getOptionDisplayLabel(
        selectOptions.externalProvider,
        answers.externalLlmUsage,
      ),
    });
  }
  if (answers.biometricData) {
    items.push({
      label: t("pages.wizard.fields.biometricIndicatorLabel"),
      value: getOptionDisplayLabel(
        selectOptions.yesNoUnknown,
        answers.biometricData,
      ),
    });
  }
  if (answers.highImpactIndicators?.length) {
    items.push({
      label: t("pages.wizard.fields.highImpactIndicatorLabel"),
      value: answers.highImpactIndicators.join(", "),
    });
  }

  return items;
}

function hasTextValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasArrayValue(value: string[] | undefined) {
  return Array.isArray(value) && value.length > 0;
}

function getFieldErrors(error: ZodError) {
  return error.issues.reduce<Record<string, string>>((allErrors, issue) => {
    const fieldName = issue.path[0];
    if (typeof fieldName === "string" && !(fieldName in allErrors)) {
      allErrors[fieldName] = issue.message;
    }

    return allErrors;
  }, {});
}

function getOptionDisplayLabel(
  options: ReadonlyArray<{ value: string; labelKey: string }>,
  value: string | undefined,
): string {
  if (!value) {
    return "";
  }

  const option = options.find((entry) => entry.value === value);
  return option ? t(option.labelKey) : value;
}
