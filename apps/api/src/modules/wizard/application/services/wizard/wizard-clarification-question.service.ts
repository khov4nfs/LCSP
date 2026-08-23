import { Injectable } from "@nestjs/common";
import {
  ANSWER_STATES,
  DECISION_ROLES,
  WIZARD_CLARIFICATION_AGENT_REASON_CODES,
  WIZARD_CLARIFICATION_AGENT_SEVERITIES,
  WIZARD_CLARIFICATION_AGENT_STATUSES,
  WIZARD_CLARIFICATION_AGENT_TARGET_KINDS,
  WIZARD_CLARIFICATION_ASK_MODES,
  WIZARD_CLARIFICATION_REQUESTERS,
  WIZARD_CLARIFICATION_REQUEST_KIND,
  WIZARD_CLARIFICATION_ROUTING_METHODS,
  WIZARD_CLARIFICATION_SCOPES,
  WIZARD_FIELD_CONTROLS,
  type WizardAnswer,
  type WizardClarificationAgentQuestion,
  type WizardClarificationAskMode,
  type WizardClarificationQuestionResponse,
} from "@lcsp/contracts/wizard";

type WizardAnswerValue = string | string[] | undefined;

type ClarificationTarget = {
  fieldName: string;
  text: string;
  severity: WizardClarificationAgentQuestion["severity"];
  reasonCode: WizardClarificationAgentQuestion["reasonCode"];
  answerControl: WizardClarificationAgentQuestion["answerControl"];
  optionSet?: string;
};

const MIN_MEANINGFUL_TEXT_LENGTH = 24;

const PURPOSE_FIELDS = {
  businessProcess: "businessProcess",
  useCase: "useCase",
  primaryActors: "primaryActors",
  businessTrigger: "businessTrigger",
  expectedOutcome: "expectedOutcome",
  aiPurpose: "aiPurpose",
  autonomyLevel: "autonomyLevel",
  sector: "sector",
} as const;

const DECISION_FIELDS = {
  decisionRole: "decisionRole",
  humanReview: "humanReview",
  externalLlmUsage: "externalLlmUsage",
} as const;

const DEEP_RESEARCH_FIELDS = {
  postGraphContext: "postGraphContext",
  postGraphRuleScope: "postGraphRuleScope",
  postGraphHumanReviewBoundary: "postGraphHumanReviewBoundary",
} as const;

const REQUIRED_BASE_FIELDS = [
  PURPOSE_FIELDS.businessProcess,
  PURPOSE_FIELDS.useCase,
  PURPOSE_FIELDS.primaryActors,
  PURPOSE_FIELDS.businessTrigger,
  PURPOSE_FIELDS.expectedOutcome,
  PURPOSE_FIELDS.aiPurpose,
  PURPOSE_FIELDS.autonomyLevel,
  PURPOSE_FIELDS.sector,
  "dataTypes",
  "affectedSubjects",
  "userImpact",
  DECISION_FIELDS.decisionRole,
  DECISION_FIELDS.humanReview,
  DECISION_FIELDS.externalLlmUsage,
  "deploymentContext",
  "specialCategoryData",
  "biometricData",
  "highImpactIndicators",
  "prohibitedRiskSignals",
] as const;

@Injectable()
export class WizardClarificationQuestionService {
  generate(
    answers: WizardAnswer[],
    mode: WizardClarificationAskMode | undefined,
    maxQuestions: number | undefined,
  ): WizardClarificationQuestionResponse {
    const answerMap = this.answerMap(answers);
    const isPrePlannerMode = mode === WIZARD_CLARIFICATION_ASK_MODES.prePlanner;
    const targets = isPrePlannerMode
      ? this.collectDeepResearchTargets(answerMap)
      : this.collectTargets(answerMap);
    const limit = this.maxQuestions(maxQuestions);
    const selectedTargets =
      limit === undefined ? targets : targets.slice(0, limit);
    const questions = selectedTargets.map((target, index) =>
      this.toAgentQuestion(target, index),
    );

    return {
      kind: WIZARD_CLARIFICATION_REQUEST_KIND,
      scope:
        mode === WIZARD_CLARIFICATION_ASK_MODES.prePlanner
          ? WIZARD_CLARIFICATION_SCOPES.postGraph
          : WIZARD_CLARIFICATION_SCOPES.preScan,
      requestedBy: WIZARD_CLARIFICATION_REQUESTERS.wizard,
      questions,
      fallbackUsed: true,
      generatedAt: new Date().toISOString(),
    };
  }

  private collectTargets(
    answerMap: Map<string, WizardAnswerValue>,
  ): ClarificationTarget[] {
    const targets: ClarificationTarget[] = [];

    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.businessProcess,
      text: "Mô tả rõ quy trình nghiệp vụ chính mà hệ thống AI đang hỗ trợ, bằng ngôn ngữ công việc hằng ngày.",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.missingBusinessContext,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.useCase,
      text: "Use case chính là gì: actor nào có mục tiêu gì, luồng chính diễn ra ra sao, và ranh giới không thuộc use case là gì?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.missingBusinessContext,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.primaryActors,
      text: "Ai tham gia hoặc bị ảnh hưởng trong use case này? Nêu rõ vai trò người dùng, operator, owner và hệ thống liên quan.",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.missingBusinessContext,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.businessTrigger,
      text: "Điều gì bắt đầu workflow này: hành động người dùng, event, queue message, lịch chạy hay điều kiện bên ngoài?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.missingBusinessContext,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.expectedOutcome,
      text: "Workflow cần tạo ra kết quả nghiệp vụ nào, và quyết định nào AI không được tự đưa ra một mình?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
      reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.doubtfulAnswer,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: PURPOSE_FIELDS.aiPurpose,
      text: "AI được dùng để làm gì trong hệ thống này, và giới hạn trách nhiệm của AI là gì?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.missingBusinessContext,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });

    if (this.needsValue(answerMap.get(PURPOSE_FIELDS.autonomyLevel))) {
      targets.push({
        fieldName: PURPOSE_FIELDS.autonomyLevel,
        text: "Hệ thống tự động tới mức nào trong use case này? Chọn mức tự động hóa gần nhất để planner không suy diễn quá quyền hạn của AI.",
        severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
        reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.doubtfulAnswer,
        answerControl: WIZARD_FIELD_CONTROLS.select,
        optionSet: "autonomyLevel",
      });
    }

    if (this.needsValue(answerMap.get(PURPOSE_FIELDS.sector))) {
      targets.push({
        fieldName: PURPOSE_FIELDS.sector,
        text: "Lĩnh vực triển khai gần nhất là gì? Chọn ngành để planner ưu tiên đúng nhóm rule áp dụng.",
        severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
        reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.ruleScopeAmbiguous,
        answerControl: WIZARD_FIELD_CONTROLS.select,
        optionSet: "sector",
      });
    }

    this.pushDecisionBoundaryTargets(targets, answerMap);

    return this.dedupeTargets(targets);
  }

  private collectDeepResearchTargets(
    answerMap: Map<string, WizardAnswerValue>,
  ): ClarificationTarget[] {
    if (!this.hasCompletedBaseWizard(answerMap)) {
      return [];
    }

    const targets: ClarificationTarget[] = [];
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: DEEP_RESEARCH_FIELDS.postGraphContext,
      text: "Code graph hoặc bằng chứng kỹ thuật đang cần thêm ngữ cảnh nghiệp vụ nào để diễn giải đúng các câu trả lời wizard đã có?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
      reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.graphContextMissing,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: DEEP_RESEARCH_FIELDS.postGraphRuleScope,
      text: "Từ các câu trả lời wizard hiện tại, Deep Agents nên ưu tiên nhóm rule, nghĩa vụ hoặc phạm vi kiểm soát nào trong bước nghiên cứu sâu?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
      reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.ruleScopeAmbiguous,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });
    this.pushTextTargetIfWeak(targets, answerMap, {
      fieldName: DEEP_RESEARCH_FIELDS.postGraphHumanReviewBoundary,
      text: "Ranh giới review của con người nào cần được Deep Agents kiểm chứng thêm sau khi đối chiếu câu trả lời wizard với bằng chứng kỹ thuật?",
      severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
      reasonCode:
        WIZARD_CLARIFICATION_AGENT_REASON_CODES.businessSemanticsUnclear,
      answerControl: WIZARD_FIELD_CONTROLS.textarea,
    });

    return this.dedupeTargets(targets);
  }

  private pushDecisionBoundaryTargets(
    targets: ClarificationTarget[],
    answerMap: Map<string, WizardAnswerValue>,
  ) {
    const decisionRole = answerMap.get(DECISION_FIELDS.decisionRole);
    const humanReview = answerMap.get(DECISION_FIELDS.humanReview);
    const externalLlmUsage = answerMap.get(DECISION_FIELDS.externalLlmUsage);

    if (this.needsValue(decisionRole)) {
      targets.push({
        fieldName: DECISION_FIELDS.decisionRole,
        text: "AI đang hỗ trợ, khuyến nghị hay trực tiếp dẫn tới quyết định nghiệp vụ? Chọn vai trò quyết định để tránh planner đánh giá sai mức rủi ro.",
        severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
        reasonCode: WIZARD_CLARIFICATION_AGENT_REASON_CODES.doubtfulAnswer,
        answerControl: WIZARD_FIELD_CONTROLS.select,
        optionSet: "decisionRole",
      });
    }

    if (this.needsValue(humanReview)) {
      targets.push({
        fieldName: DECISION_FIELDS.humanReview,
        text: "Người review, phê duyệt hoặc override xuất hiện ở điểm nào trong workflow?",
        severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.high,
        reasonCode:
          WIZARD_CLARIFICATION_AGENT_REASON_CODES.businessSemanticsUnclear,
        answerControl: WIZARD_FIELD_CONTROLS.select,
        optionSet: "humanOversight",
      });
    }

    if (this.needsValue(externalLlmUsage)) {
      targets.push({
        fieldName: DECISION_FIELDS.externalLlmUsage,
        text: "Hệ thống có dùng model hoặc LLM provider bên ngoài không? Chọn trạng thái gần nhất để scan và investigation tập trung đúng evidence.",
        severity: WIZARD_CLARIFICATION_AGENT_SEVERITIES.medium,
        reasonCode:
          WIZARD_CLARIFICATION_AGENT_REASON_CODES.businessSemanticsUnclear,
        answerControl: WIZARD_FIELD_CONTROLS.select,
        optionSet: "externalProvider",
      });
    }
  }

  private pushTextTargetIfWeak(
    targets: ClarificationTarget[],
    answerMap: Map<string, WizardAnswerValue>,
    target: ClarificationTarget,
  ) {
    if (this.needsText(answerMap.get(target.fieldName))) {
      targets.push(target);
    }
  }

  private toAgentQuestion(
    target: ClarificationTarget,
    index: number,
  ): WizardClarificationAgentQuestion {
    return {
      id: `wizard-ask-${target.fieldName}-${index + 1}`,
      text: target.text,
      language: "vi",
      targetKind: WIZARD_CLARIFICATION_AGENT_TARGET_KINDS.wizardField,
      targetFieldName: target.fieldName,
      severity: target.severity,
      reasonCode: target.reasonCode,
      evidenceRefs: [],
      status: WIZARD_CLARIFICATION_AGENT_STATUSES.pending,
      routingMethod: WIZARD_CLARIFICATION_ROUTING_METHODS.agentHint,
      routingConfidence: 1,
      answerControl: target.answerControl,
      ...(target.optionSet ? { optionSet: target.optionSet } : {}),
    };
  }

  private answerMap(answers: WizardAnswer[]): Map<string, WizardAnswerValue> {
    const map = new Map<string, WizardAnswerValue>();
    for (const answer of answers) {
      if (!answer || typeof answer.questionId !== "string") {
        continue;
      }
      if (answer.answerState === ANSWER_STATES.explicitUnknown) {
        map.set(answer.questionId, "UNKNOWN");
        continue;
      }
      if (typeof answer.value === "string" || Array.isArray(answer.value)) {
        map.set(answer.questionId, answer.value as WizardAnswerValue);
      }
    }
    return map;
  }

  private needsText(value: WizardAnswerValue): boolean {
    if (typeof value !== "string") {
      return true;
    }
    const normalized = value.trim();
    return (
      normalized.length < MIN_MEANINGFUL_TEXT_LENGTH ||
      normalized === "UNKNOWN" ||
      normalized === "UNCLEAR"
    );
  }

  private needsValue(value: WizardAnswerValue): boolean {
    if (Array.isArray(value)) {
      return value.length === 0 || value.includes("unknown");
    }
    if (typeof value !== "string") {
      return true;
    }
    const normalized = value.trim();
    return (
      normalized.length === 0 ||
      normalized === "UNKNOWN" ||
      normalized === "UNCLEAR" ||
      normalized === "unknown"
    );
  }

  private hasCompletedBaseWizard(
    answerMap: Map<string, WizardAnswerValue>,
  ): boolean {
    return REQUIRED_BASE_FIELDS.every((fieldName) => {
      if (
        fieldName === DECISION_FIELDS.humanReview &&
        answerMap.get(DECISION_FIELDS.decisionRole) ===
          DECISION_ROLES.noDecisionSupport
      ) {
        return true;
      }
      return !this.needsValue(answerMap.get(fieldName));
    });
  }

  private maxQuestions(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : undefined;
  }

  private dedupeTargets(targets: ClarificationTarget[]): ClarificationTarget[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
      if (seen.has(target.fieldName)) {
        return false;
      }
      seen.add(target.fieldName);
      return true;
    });
  }
}
