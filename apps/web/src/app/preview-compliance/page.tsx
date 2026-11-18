"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LCSPLogo } from "@/components/atoms/lcsp-logo";
import { useAppLocale } from "@/components/providers/locale-provider";
import { copy } from "@/features/assessment-runtime/utils/conversation-copy";
import mockData from "@/public/assets/mocks/enterprise-legal-compliance-workspace.json";
import { LegalRuleOutput } from "@/features/assessment-runtime/components/organisms/legal-rule-output";
import { AssessmentContextPanel } from "@/features/assessment-runtime/components/organisms/assessment-context-panel";
import { ConversationQuestionTurn } from "@/features/assessment-runtime/components/molecules/conversation-question-turn";
import { ConversationAnswerTurn } from "@/features/assessment-runtime/components/molecules/conversation-answer-turn";
import {
  CONVERSATION_TURN_KINDS,
  type DecisionRecord,
  type QuestionTurn,
  type AnswerTurn,
} from "@/features/assessment-runtime/types/conversation.types";
import type { StructuredAnswer } from "@/features/assessment-runtime/types/structured-answer.types";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";

/**
 * Business purpose: Preview compliance findings and customer questions in the selected language.
 * Business rules: Use fixture data only; respect the application locale without changing its cookie.
 * Execution flow:
 * 1. Seed the preview cache and show the findings with translated guidance.
 * 2. Display submitted sample answers within this preview session.
 * Failure cases: Missing sample questions or decisions are omitted from the preview.
 * Side effects: Seeds the local query cache and holds sample answers in component state.
 */
export default function PreviewCompliancePage() {
  const locale = useAppLocale();
  const t = (key: string, params?: Record<string, string | number>) =>
    copy(key, params, locale);
  const queryClient = useQueryClient();
  const ready = useSyncExternalStore(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () => queryClient.getQueryData(["assessment", mockData.detail.assessment_id, "detail", locale]) !== undefined,
    () => false,
  );
  const [requests, setRequests] = useState<AssessmentHumanRequestView[]>(
    () => (mockData.requests?.requests ?? []) as AssessmentHumanRequestView[],
  );
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, AnswerTurn>>({});

  useEffect(() => {
    const assessmentId = mockData.detail.assessment_id;
    // Seed React Query cache
    queryClient.setQueryData(["assessment", assessmentId, "detail", "vi"], mockData.detail);
    queryClient.setQueryData(["assessment", assessmentId, "detail", "en"], mockData.detail);
    queryClient.setQueryData(["assessment", assessmentId, "repository-setup"], mockData.repositorySetup);
    queryClient.setQueryData(["assessment", assessmentId, "provenance"], mockData.provenance);
    queryClient.setQueryData(["assessment", assessmentId, "rule-audit-catalog", "vi"], mockData.catalog);
    queryClient.setQueryData(["assessment", assessmentId, "rule-audit-catalog", "en"], mockData.catalog);
    queryClient.setQueryData(["assessment", assessmentId, "human-requests", "vi"], mockData.requests);
    queryClient.setQueryData(["assessment", assessmentId, "human-requests", "en"], mockData.requests);
    queryClient.setQueryData(["legal-library", "vi"], mockData.library);
    queryClient.setQueryData(["legal-library", "en"], mockData.library);
    queryClient.setQueryData(
      ["legal-source", "chunks", "doc-row-nd-147", 1],
      mockData.chunksDoc147
    );
    queryClient.setQueryData(
      ["legal-source", "chunks", "doc-row-nd-13", 1],
      mockData.chunksDoc13
    );

  }, [queryClient]);

  if (!ready) {
    return <div className="p-8 text-muted-foreground">{t("preview.loading")}</div>;
  }

  const decisions = (mockData.detail.case?.decisions ?? []) as DecisionRecord[];

  const handleAnswerSubmit = (requestId: string, answer: StructuredAnswer) => {
    setRequests((current) =>
      current.map((req) => {
        if (req.requestId !== requestId) return req;
        return {
          ...req,
          status: "RESOLVED",
          answers: [
            ...req.answers,
            {
              idempotencyKey: `ans-${Date.now()}`,
              requestDigest: "0".repeat(64),
              actorId: "legaltech-lead",
              answeredAt: new Date().toISOString(),
              caseRevision: 1,
              requestRevision: 1,
              doesNotKnow: answer.doesNotKnow,
              answer: answer.doesNotKnow ? null : (answer.answer ?? null),
            },
          ],
        };
      })
    );

    // Selected choice label lookup if applicable
    const targetReq = requests.find((r) => r.requestId === requestId);
    const answerText = !answer.doesNotKnow ? answer.answer : null;
    const selectedLabel = answerText
      ? targetReq?.choices.find((c) => c.value === answerText)?.label
      : null;

    setDynamicAnswers((prev) => ({
      ...prev,
      [requestId]: {
        id: `answer-turn-${requestId}`,
        sequence: 99,
        at: new Date().toISOString(),
        kind: CONVERSATION_TURN_KINDS.ANSWER,
        requestId,
        answer: answerText,
        selectedLabel: selectedLabel ?? answerText,
        doesNotKnow: answer.doesNotKnow,
      },
    }));
  };

  // Human request views
  const req1 = requests[0]; // Boolean
  const req2 = requests[1]; // Single Select
  const req3 = requests[2]; // Multi Select
  const req4 = requests[3]; // Free Text
  const req5 = requests[4]; // Historical Resolved

  const makeQuestionTurn = (req: AssessmentHumanRequestView, seq: number): QuestionTurn => ({
    id: `turn-q-${req.requestId}`,
    sequence: seq,
    at: "2026-11-18T01:00:00.000Z",
    kind: CONVERSATION_TURN_KINDS.QUESTION,
    request: req,
    open: req.status === "OPEN",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Enterprise Workspace Top Navigation */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <LCSPLogo />
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium text-muted-foreground">
              {t("preview.repository", { repository: mockData.repositorySetup.connection.repositoryFullName })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t("preview.active")}
            </span>
            <span className="text-xs text-muted-foreground">{t("preview.revision", { revision: mockData.detail.lifecycle.assessmentRevision, commit: mockData.detail.case.repositoryCommit.slice(0, 7) })}</span>
          </div>
        </div>
      </header>

      {/* Main Visual Compliance Workspace Grid */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-12">
        {/* Left / Center: Conversation & Legal Rule Outputs & HITL Interventions */}
        <section className="space-y-6 lg:col-span-8" aria-label={t("preview.conversation")}>
          {/* User message simulating conversation turn */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm">
              <p className="font-medium">
                {t("preview.request")}
              </p>
            </div>
          </div>

          {/* AI Legal Compliance intro note */}
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <div className="text-xs text-muted-foreground font-medium">{t("agentName")}</div>
              <p className="text-sm leading-relaxed text-foreground">
                {t("preview.introduction", { repository: mockData.repositorySetup.connection.repositoryFullName })}
              </p>
            </div>
          </div>

          <div className="space-y-6 pl-11">
            {/* 1. Historical Resolved Question Turn (Demonstrating Closed HITL Turn in History) */}
            {req5 ? (
              <div className="space-y-3 rounded-xl border bg-card/40 p-4 shadow-sm" data-slot="hitl-demo-resolved">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("preview.history")}
                </div>
                <ConversationQuestionTurn
                  turn={makeQuestionTurn(req5, 1)}
                  pending={false}
                  failed={false}
                  onAnswer={() => {}}
                />
                {req5.answers.length > 0 ? (
                  <ConversationAnswerTurn
                    turn={{
                      id: "turn-ans-hist-5",
                      sequence: 2,
                      at: req5.answers[0].answeredAt,
                      kind: CONVERSATION_TURN_KINDS.ANSWER,
                      requestId: req5.requestId,
                      answer: req5.answers[0].answer,
                      selectedLabel: req5.answers[0].selectedChoice?.label ?? req5.answers[0].answer,
                      doesNotKnow: req5.answers[0].doesNotKnow,
                    }}
                  />
                ) : null}
              </div>
            ) : null}

            {/* 2. Legal Rule Output 1: Nghị định 147/2024/NĐ-CP (Non-compliant) */}
            {decisions[0] ? (
              <LegalRuleOutput
                key={decisions[0].decision.assessmentRuleId}
                turn={{
                  id: `turn-decision-${decisions[0].decision.assessmentRuleId}`,
                  sequence: 3,
                  at: "2026-11-18T01:30:00.000Z",
                  kind: CONVERSATION_TURN_KINDS.DECISION,
                  decisionId: decisions[0].decisionId,
                  assessmentRuleId: decisions[0].decision.assessmentRuleId,
                  concept: mockData.detail.case.coverage[0].concept,
                  record: decisions[0],
                }}
              />
            ) : null}

            {/* 3. Interactive HITL Question 1: BOOLEAN (Có / Không) */}
            {req1 ? (
              <div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm" data-slot="hitl-demo-boolean">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <span>{t("preview.confirm")}</span>
                </div>
                <ConversationQuestionTurn
                  turn={makeQuestionTurn(req1, 4)}
                  pending={false}
                  failed={false}
                  onAnswer={(ans) => handleAnswerSubmit(req1.requestId, ans)}
                />
                {dynamicAnswers[req1.requestId] ? (
                  <ConversationAnswerTurn turn={dynamicAnswers[req1.requestId]} />
                ) : null}
              </div>
            ) : null}

            {/* 4. Interactive HITL Question 2: SINGLE_SELECT Dropdown (>5 choices) */}
            {req2 ? (
              <div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm" data-slot="hitl-demo-select">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  <span>{t("answer.selectOne")}</span>
                </div>
                <ConversationQuestionTurn
                  turn={makeQuestionTurn(req2, 5)}
                  pending={false}
                  failed={false}
                  onAnswer={(ans) => handleAnswerSubmit(req2.requestId, ans)}
                />
                {dynamicAnswers[req2.requestId] ? (
                  <ConversationAnswerTurn turn={dynamicAnswers[req2.requestId]} />
                ) : null}
              </div>
            ) : null}

            {/* 5. Legal Rule Output 2: Nghị định 13/2023/NĐ-CP (Compliant) */}
            {decisions[1] ? (
              <LegalRuleOutput
                key={decisions[1].decision.assessmentRuleId}
                turn={{
                  id: `turn-decision-${decisions[1].decision.assessmentRuleId}`,
                  sequence: 6,
                  at: "2026-11-18T01:45:00.000Z",
                  kind: CONVERSATION_TURN_KINDS.DECISION,
                  decisionId: decisions[1].decisionId,
                  assessmentRuleId: decisions[1].decision.assessmentRuleId,
                  concept: mockData.detail.case.coverage[1].concept,
                  record: decisions[1],
                }}
              />
            ) : null}

            {/* 6. Interactive HITL Question 3: MULTI_SELECT Checkboxes */}
            {req3 ? (
              <div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm" data-slot="hitl-demo-multiselect">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  <span>{t("answer.selectMany")}</span>
                </div>
                <ConversationQuestionTurn
                  turn={makeQuestionTurn(req3, 7)}
                  pending={false}
                  failed={false}
                  onAnswer={(ans) => handleAnswerSubmit(req3.requestId, ans)}
                />
                {dynamicAnswers[req3.requestId] ? (
                  <ConversationAnswerTurn turn={dynamicAnswers[req3.requestId]} />
                ) : null}
              </div>
            ) : null}

            {/* 7. Interactive HITL Question 4: FREE_TEXT Textarea */}
            {req4 ? (
              <div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm" data-slot="hitl-demo-text">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <span>{t("preview.tellMore")}</span>
                </div>
                <ConversationQuestionTurn
                  turn={makeQuestionTurn(req4, 8)}
                  pending={false}
                  failed={false}
                  onAnswer={(ans) => handleAnswerSubmit(req4.requestId, ans)}
                />
                {dynamicAnswers[req4.requestId] ? (
                  <ConversationAnswerTurn turn={dynamicAnswers[req4.requestId]} />
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {/* Right Sidebar: Assessment Context Panel */}
        <aside className="lg:col-span-4" aria-label={t("context.title")}>
          <div className="sticky top-20 rounded-xl border bg-card p-5 shadow-sm">
            <AssessmentContextPanel
              assessmentId={mockData.detail.assessment_id}
              assessmentName={mockData.detail.name}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
