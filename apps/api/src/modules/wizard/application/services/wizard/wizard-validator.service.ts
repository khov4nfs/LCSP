import { Injectable } from "@nestjs/common";
import type { WizardAnswer } from "@lcsp/contracts/wizard";
import { ANSWER_STATES } from "@lcsp/contracts/wizard";

export interface ValidationError {
  field: string;
  message: string;
}

@Injectable()
export class WizardValidatorService {
  validate(answers: WizardAnswer[]): ValidationError[] {
    const errors: ValidationError[] = [];

    const getAnswer = (questionId: string) =>
      answers.find((a) => a.questionId === questionId);

    const businessProcess = getAnswer("businessProcess");
    if (!this.isValidStringOrUnknown(businessProcess)) {
      errors.push({
        field: "businessProcess",
        message:
          "Please describe the primary business process of your AI system.",
      });
    }

    const useCase = getAnswer("useCase");
    if (!this.isValidStringOrUnknown(useCase)) {
      errors.push({
        field: "useCase",
        message: "Please describe the primary use case for this AI system.",
      });
    }

    const primaryActors = getAnswer("primaryActors");
    if (!this.isValidStringOrUnknown(primaryActors)) {
      errors.push({
        field: "primaryActors",
        message:
          "Please describe the primary actors involved in this use case.",
      });
    }

    const businessTrigger = getAnswer("businessTrigger");
    if (!this.isValidStringOrUnknown(businessTrigger)) {
      errors.push({
        field: "businessTrigger",
        message:
          "Please describe what starts this use case or business workflow.",
      });
    }

    const expectedOutcome = getAnswer("expectedOutcome");
    if (!this.isValidStringOrUnknown(expectedOutcome)) {
      errors.push({
        field: "expectedOutcome",
        message:
          "Please describe the expected outcome after the workflow completes.",
      });
    }

    const aiPurpose = getAnswer("aiPurpose");
    if (!this.isValidStringOrUnknown(aiPurpose)) {
      errors.push({
        field: "aiPurpose",
        message: "Please describe the primary purpose of your AI system.",
      });
    }

    const autonomyLevel = getAnswer("autonomyLevel");
    if (!this.isValidStringOrUnknown(autonomyLevel)) {
      errors.push({
        field: "autonomyLevel",
        message:
          "Please indicate how autonomous the system is in this use case.",
      });
    }

    const dataTypes = getAnswer("dataTypes");
    if (!this.isValidArrayOrUnknown(dataTypes)) {
      errors.push({
        field: "dataTypes",
        message:
          "Please specify at least one type of data your AI system processes.",
      });
    }

    const affectedSubjects = getAnswer("affectedSubjects");
    if (!this.isValidArrayOrUnknown(affectedSubjects)) {
      errors.push({
        field: "affectedSubjects",
        message:
          "Please describe the group of subjects affected by your AI system.",
      });
    }

    const decisionRole = getAnswer("decisionRole");
    if (
      !decisionRole ||
      decisionRole.answerState === ANSWER_STATES.explicitUnknown ||
      !this.isValidString(decisionRole.value)
    ) {
      errors.push({
        field: "decisionRole",
        message:
          "Please indicate whether your AI system makes autonomous decisions. Unknown is not permitted for this field.",
      });
    }

    const humanReview = getAnswer("humanReview");
    if (!this.isValidStringOrUnknown(humanReview)) {
      errors.push({
        field: "humanReview",
        message: "Please describe the human oversight mechanism in place.",
      });
    }

    const externalLlmUsage = getAnswer("externalLlmUsage");
    if (!this.isValidStringOrUnknown(externalLlmUsage)) {
      errors.push({
        field: "externalLlmUsage",
        message:
          "Please indicate whether your AI system uses an external AI provider.",
      });
    }

    return errors;
  }

  private isValidStringOrUnknown(answer?: WizardAnswer): boolean {
    if (!answer) return false;
    if (answer.answerState === ANSWER_STATES.explicitUnknown) return true;
    return this.isValidString(answer.value);
  }

  private isValidArrayOrUnknown(answer?: WizardAnswer): boolean {
    if (!answer) return false;
    if (answer.answerState === ANSWER_STATES.explicitUnknown) return true;
    return this.isValidArray(answer.value);
  }

  private isValidString(value: any): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }

  private isValidArray(value: any): boolean {
    return Array.isArray(value) && value.length > 0;
  }
}
