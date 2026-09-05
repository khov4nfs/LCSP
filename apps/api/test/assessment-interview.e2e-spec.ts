import * as assert from "node:assert/strict";

import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
} from "@lcsp/contracts/evidence";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

const QUESTION_ID = "agent-question-1";
const RAW_ANSWER = "Payment assistant recommends review actions.";
const RAW_DRAFT = "Need internal legal owner confirmation.";
const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

function jsonRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

describe("Assessment Interview Runtime (e2e) [LCSP-278]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: "org-1",
    });
    token = successBody<{ session_token: string }>(signIn).session_token;
    await prisma.assessment.create({
      data: { id: "assessment-1", ownerId: "user-1", name: "Interview E2E" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("keeps Customer answers non-authoritative until Interview Agent sufficiency", async () => {
    const shortcut = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: "anything" });
    assert.equal(shortcut.status, 409, JSON.stringify(shortcut.body));

    await seedWaitingQuestion(prisma);
    const answered = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });
    assert.equal(answered.status, 201, JSON.stringify(answered.body));
    const state = successBody<{
      outcome: string;
      contextAuthority: string;
      contextRevision: number;
      orchestrationRequested: boolean;
      answerHistory: Array<{ questionId: string; summary: string }>;
      audit: { authenticatedActorId: string; relatedQuestionId: string };
    }>(answered);
    assert.equal(
      state.outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    );
    assert.equal(
      state.contextAuthority,
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
    );
    assert.equal(state.contextRevision, 1);
    assert.equal(state.orchestrationRequested, true);
    assert.equal(state.answerHistory[0]?.questionId, QUESTION_ID);
    assert.notEqual(state.answerHistory[0]?.summary, RAW_ANSWER);
    assert.equal(state.audit.authenticatedActorId, "user-1");
    assert.equal(state.audit.relatedQuestionId, QUESTION_ID);

    const event = await prisma.assessmentRuntimeEvent.findFirstOrThrow({
      where: { assessmentId: "assessment-1", toolName: "assessment_interview" },
      orderBy: { sequence: "desc" },
    });
    assert.equal(event.stage, "INTERVIEW");
    assert.equal(event.runStatus, "WAITING");
    assert.doesNotMatch(
      JSON.stringify(event.inputSummaryJson),
      /Payment assistant/u,
    );
    assert.doesNotMatch(
      JSON.stringify(event.outputSummaryJson),
      /Payment assistant/u,
    );

    const resumeCommand = await prisma.outboxMessage.findFirstOrThrow({
      where: {
        aggregateId: "assessment-1",
        eventType: ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox,
      },
    });
    assert.match(JSON.stringify(resumeCommand.payload), /assessment-1/u);
    assert.match(
      JSON.stringify(resumeCommand.payload),
      /INTERVIEW_ANSWER_SUBMITTED/u,
    );
    assert.doesNotMatch(
      JSON.stringify(resumeCommand.payload),
      /Payment assistant/u,
    );

    const resumePayload = jsonRecord(resumeCommand.payload);
    const privateRevision = await httpRequest(app)
      .get("/internal/assessment-interviews/assessment-1/private-context/1")
      .query({
        source_version:
          typeof resumePayload.sourceVersion === "string"
            ? resumePayload.sourceVersion
            : undefined,
        pge_version:
          typeof resumePayload.pgeVersion === "string"
            ? resumePayload.pgeVersion
            : undefined,
      })
      .set("x-worker-api-key", WORKER_KEY);
    assert.equal(
      privateRevision.status,
      200,
      JSON.stringify(privateRevision.body),
    );
    const privateState = successBody<{
      status: string;
      privateRevision: { answer: { freeText: string }; authority: string };
    }>(privateRevision);
    assert.equal(privateState.status, "CURRENT");
    assert.equal(privateState.privateRevision.answer.freeText, RAW_ANSWER);
    assert.equal(
      privateState.privateRevision.authority,
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
    );
  });

  it("persists Save & Exit draft and answer history in the Interview read model", async () => {
    await seedWaitingQuestion(prisma);
    const answered = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });
    assert.equal(answered.status, 201, JSON.stringify(answered.body));

    const blocked = await httpRequest(app)
      .post("/assessments/assessment-1/interview/blocked-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        action: ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
        draft: RAW_DRAFT,
      });
    assert.equal(blocked.status, 201, JSON.stringify(blocked.body));
    const state = successBody<{
      outcome: string;
      blockedActions: string[];
      pendingDraft: string;
      answerHistory: unknown[];
    }>(blocked);
    assert.equal(
      state.outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    );
    assert.equal(state.pendingDraft, RAW_DRAFT);
    assert.equal(state.answerHistory.length, 1);
    assert.deepEqual(state.blockedActions, [
      ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
      ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
      ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
    ]);

    const resumed = await httpRequest(app)
      .get("/assessments/assessment-1/interview")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    const resumedState = successBody<{
      outcome: string;
      pendingDraft: string;
      answerHistory: unknown[];
    }>(resumed);
    assert.equal(
      resumedState.outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    );
    assert.equal(resumedState.pendingDraft, RAW_DRAFT);
    assert.equal(resumedState.answerHistory.length, 1);

    const runtimeEvent = await prisma.assessmentRuntimeEvent.findFirstOrThrow({
      where: { assessmentId: "assessment-1", waitingReason: "SAVE_AND_EXIT" },
    });
    assert.doesNotMatch(
      JSON.stringify(runtimeEvent.inputSummaryJson),
      /Need internal/u,
    );
    assert.doesNotMatch(
      JSON.stringify(runtimeEvent.outputSummaryJson),
      /Need internal/u,
    );
  });

  it("rejects stale duplicate submissions for the same active question revision", async () => {
    await seedWaitingQuestion(prisma);
    const first = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });
    const stale = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        questionId: QUESTION_ID,
        freeText: "Contradictory second answer.",
      });

    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    const thread = await prisma.assessmentInterviewThread.findUniqueOrThrow({
      where: { assessmentId: "assessment-1" },
    });
    assert.equal(thread.contextRevision, 1);
    const privateStore = jsonRecord(thread.privateContextJson);
    const revisions = Array.isArray(privateStore.revisions)
      ? privateStore.revisions
      : [];
    assert.equal(revisions.length, 1);
  });

  it("uses internal guarded decision write-back and blocks false ready", async () => {
    await seedWaitingQuestion(prisma);
    await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });

    const falseReady = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
      });
    assert.equal(falseReady.status, 409, JSON.stringify(falseReady.body));

    const forgedCustomerConfirmation = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextAuthority:
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
        confirmedContext: { decision_authority: "human approval required" },
      });
    assert.equal(
      forgedCustomerConfirmation.status,
      409,
      JSON.stringify(forgedCustomerConfirmation.body),
    );

    const ready = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
        confirmedContext: { decision_authority: "human approval required" },
      });
    assert.equal(ready.status, 201, JSON.stringify(ready.body));
    assert.equal(
      successBody<{ outcome: string }>(ready).outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
    );

    const duplicate = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
      });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  });

  it("persists an Interview Agent-authored initial question through the worker entry", async () => {
    const seeded = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/initial-question")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: QUESTION_ID,
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          prompt: "Agent-authored runtime question",
        },
      });
    assert.equal(seeded.status, 201, JSON.stringify(seeded.body));

    const publicState = await httpRequest(app)
      .get("/assessments/assessment-1/interview")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(publicState.status, 200, JSON.stringify(publicState.body));
    const state = successBody<{
      outcome: string;
      activeQuestion: { id: string; control: string; prompt: string };
    }>(publicState);
    assert.equal(
      state.outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    );
    assert.equal(state.activeQuestion.id, QUESTION_ID);
    assert.equal(
      state.activeQuestion.control,
      ASSESSMENT_INTERVIEW_CONTROLS.boolean,
    );
    assert.equal(
      state.activeQuestion.prompt,
      "Agent-authored runtime question",
    );
  });

  it("detects stale source and PGE versions before worker resume", async () => {
    await seedWaitingQuestion(prisma);
    await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });

    const stale = await httpRequest(app)
      .get("/internal/assessment-interviews/assessment-1/private-context/1")
      .query({ source_version: "snapshot-old", pge_version: "ter-old" })
      .set("x-worker-api-key", WORKER_KEY);
    assert.equal(stale.status, 200, JSON.stringify(stale.body));
    assert.equal(
      successBody<{ status: string }>(stale).status,
      "STALE_PROVENANCE",
    );
  });

  it("re-reads authoritative provenance instead of trusting stale thread pins", async () => {
    await seedWaitingQuestion(prisma);
    const answered = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });
    assert.equal(answered.status, 201, JSON.stringify(answered.body));

    const thread = await prisma.assessmentInterviewThread.findUniqueOrThrow({
      where: { assessmentId: "assessment-1" },
    });
    const store = jsonRecord(thread.privateContextJson);
    const revisions = Array.isArray(store.revisions) ? store.revisions : [];
    const staleRevisions = revisions.map((value) => ({
      ...jsonRecord(value),
      sourceVersion: "stale-source-pin",
      pgeVersion: "stale-pge-pin",
    }));
    await prisma.assessmentInterviewThread.update({
      where: { assessmentId: "assessment-1" },
      data: {
        sourceVersion: "stale-source-pin",
        pgeVersion: "stale-pge-pin",
        privateContextJson: { ...store, revisions: staleRevisions },
      },
    });

    const stale = await httpRequest(app)
      .get("/internal/assessment-interviews/assessment-1/private-context/1")
      .query({
        source_version: "stale-source-pin",
        pge_version: "stale-pge-pin",
      })
      .set("x-worker-api-key", WORKER_KEY);
    assert.equal(stale.status, 200, JSON.stringify(stale.body));
    assert.equal(
      successBody<{ status: string }>(stale).status,
      "STALE_PROVENANCE",
    );
  });

  it("rejects answers that do not match the active runtime control", async () => {
    const seeded = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/initial-question")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: QUESTION_ID,
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          prompt: "Is human approval required?",
        },
      });
    assert.equal(seeded.status, 201, JSON.stringify(seeded.body));

    const empty = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID });
    assert.equal(empty.status, 400, JSON.stringify(empty.body));

    const invalidChoice = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, selectedChoiceIds: ["maybe"] });
    assert.equal(invalidChoice.status, 400, JSON.stringify(invalidChoice.body));

    const valid = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, selectedChoiceIds: ["yes"] });
    assert.equal(valid.status, 201, JSON.stringify(valid.body));
  });

  it("uses server-owned targeted criteria and continuation before exact resume", async () => {
    await seedWaitingQuestion(prisma);
    await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({ questionId: QUESTION_ID, freeText: RAW_ANSWER });

    const ready = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
        confirmedContext: { baseline: "confirmed" },
      });
    assert.equal(ready.status, 201, JSON.stringify(ready.body));

    const registered = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/targeted-needs")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        actorId: "user-1",
        needId: "need-decision-authority",
        businessContextNeed: "Who has final decision authority?",
        resolutionCriteria: ["decision_authority"],
        originatingInvestigationReference:
          "investigator:investigator-run-1:need-decision-authority",
        investigatorExecutionId: "investigator-run-1",
        workflowRunId: "workflow-run-1",
        checkpointId: "checkpoint-1",
        affectedRuleIds: ["ENG-1"],
        artifactVersions: {
          technicalEvidenceReportId: "ter-original",
          repositorySnapshotId: "snap-original",
          legalRuleCatalogVersionId: "catalog-original",
          legalCorpusVersionId: "corpus-original",
        },
      });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));

    const privateTarget = await httpRequest(app)
      .get("/internal/assessment-interviews/assessment-1/private-context/1")
      .set("x-worker-api-key", WORKER_KEY);
    assert.equal(privateTarget.status, 200, JSON.stringify(privateTarget.body));
    const privateTargetState = successBody<{
      status: string;
      targetedNeed: { needId: string; resolutionCriteria: string[] };
    }>(privateTarget);
    assert.equal(privateTargetState.status, "DUPLICATE");
    assert.equal(
      privateTargetState.targetedNeed.needId,
      "need-decision-authority",
    );
    assert.deepEqual(privateTargetState.targetedNeed.resolutionCriteria, [
      "decision_authority",
    ]);
    const serializedPrivateTarget = JSON.stringify(privateTarget.body);
    assert.doesNotMatch(serializedPrivateTarget, /checkpoint-1/u);
    assert.doesNotMatch(serializedPrivateTarget, /"checkpointId"/u);
    assert.doesNotMatch(serializedPrivateTarget, /"investigatorExecutionId"/u);
    assert.doesNotMatch(serializedPrivateTarget, /"targetedContinuation"/u);
    assert.match(
      serializedPrivateTarget,
      /investigator:investigator-run-1:need-decision-authority/u,
    );

    const question = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 1,
        mode: "TARGETED_INTERVIEW",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "target-question-1",
          needId: "need-decision-authority",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          prompt: "Who has final decision authority?",
        },
      });
    assert.equal(question.status, 201, JSON.stringify(question.body));

    const targetedAnswer = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        questionId: "target-question-1",
        freeText: "The human operations lead has final approval.",
      });
    assert.equal(
      targetedAnswer.status,
      201,
      JSON.stringify(targetedAnswer.body),
    );

    const forged = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 2,
        mode: "TARGETED_INTERVIEW",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
        contextAuthority:
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
        confirmedContext: { unrelated: "yes" },
        resolutionCriteria: ["unrelated"],
        originatingInvestigationReference: "forged-origin",
        continuation: {
          investigatorExecutionId: "forged-run",
          affectedRuleIds: ["FORGED"],
        },
      });
    assert.equal(forged.status, 409, JSON.stringify(forged.body));

    const forgedSystemConfirmation = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 2,
        mode: "TARGETED_INTERVIEW",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
        confirmedContext: { decision_authority: "human operations lead" },
      });
    assert.equal(
      forgedSystemConfirmation.status,
      409,
      JSON.stringify(forgedSystemConfirmation.body),
    );

    const confirmQuestion = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 2,
        mode: "TARGETED_INTERVIEW",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        activeQuestion: {
          id: "target-confirm-1",
          needId: "need-decision-authority",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          prompt:
            "Please confirm this interpretation before it becomes authoritative.",
          priorAnswerSummary: "The human operations lead has final approval.",
        },
      });
    assert.equal(
      confirmQuestion.status,
      201,
      JSON.stringify(confirmQuestion.body),
    );

    const confirmation = await httpRequest(app)
      .post("/assessments/assessment-1/interview/answers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        questionId: "target-confirm-1",
        confirmed: true,
      });
    assert.equal(confirmation.status, 201, JSON.stringify(confirmation.body));

    const resolved = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 3,
        mode: "TARGETED_INTERVIEW",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
        contextAuthority:
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
        confirmedContext: { decision_authority: "human operations lead" },
        resolutionCriteria: ["forged"],
        continuation: { investigatorExecutionId: "forged-run" },
      });
    assert.equal(resolved.status, 201, JSON.stringify(resolved.body));
    const resolvedState = successBody<{
      outcome: string;
      continuation: {
        originatingInvestigationReference: string;
        investigatorExecutionId: string;
        checkpointId: string;
        workflowRunId: string;
        affectedRuleIds: string[];
        artifactVersions: Record<string, string>;
      };
    }>(resolved);
    assert.equal(
      resolvedState.outcome,
      ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
    );
    assert.equal(
      resolvedState.continuation.originatingInvestigationReference,
      "investigator:investigator-run-1:need-decision-authority",
    );
    assert.equal(
      resolvedState.continuation.investigatorExecutionId,
      "investigator-run-1",
    );
    assert.equal(resolvedState.continuation.workflowRunId, "workflow-run-1");
    assert.equal(resolvedState.continuation.checkpointId, "checkpoint-1");
    assert.deepEqual(resolvedState.continuation.affectedRuleIds, ["ENG-1"]);
    assert.deepEqual(resolvedState.continuation.artifactVersions, {
      technicalEvidenceReportId: "ter-original",
      repositorySnapshotId: "snap-original",
      legalRuleCatalogVersionId: "catalog-original",
      legalCorpusVersionId: "corpus-original",
    });
  });

  it("keeps raw saved draft out of Agent-decision runtime events", async () => {
    await seedWaitingQuestion(prisma);
    const saved = await httpRequest(app)
      .post("/assessments/assessment-1/interview/blocked-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        action: ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
        draft: RAW_DRAFT,
      });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));

    const more = await httpRequest(app)
      .post("/assessments/assessment-1/interview/blocked-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        action: ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
      });
    assert.equal(more.status, 201, JSON.stringify(more.body));

    const decision = await httpRequest(app)
      .post("/internal/assessment-interviews/assessment-1/agent-decisions")
      .set("x-worker-api-key", WORKER_KEY)
      .send({
        expectedContextRevision: 0,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "more-context-question",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          prompt: "Please provide the additional context.",
        },
      });
    assert.equal(decision.status, 201, JSON.stringify(decision.body));

    const runtimeEvent = await prisma.assessmentRuntimeEvent.findFirstOrThrow({
      where: {
        assessmentId: "assessment-1",
        summary: { contains: "guarded decision persisted" },
      },
      orderBy: { sequence: "desc" },
    });
    assert.doesNotMatch(
      JSON.stringify(runtimeEvent.outputSummaryJson),
      /Need internal legal owner/u,
    );
  });

  it("re-enters Interview when Customer chooses Provide More Context", async () => {
    await prisma.outboxMessage.deleteMany({
      where: { aggregateId: "assessment-1" },
    });
    await seedWaitingQuestion(prisma);
    const blocked = await httpRequest(app)
      .post("/assessments/assessment-1/interview/blocked-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        action: ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
      });
    assert.equal(blocked.status, 201, JSON.stringify(blocked.body));
    assert.equal(
      successBody<{ orchestrationRequested: boolean }>(blocked)
        .orchestrationRequested,
      true,
    );
    const resumeCommand = await prisma.outboxMessage.findFirstOrThrow({
      where: {
        aggregateId: "assessment-1",
        eventType: ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox,
      },
    });
    assert.match(
      JSON.stringify(resumeCommand.payload),
      /PROVIDE_MORE_CONTEXT/u,
    );
  });
});

async function seedWaitingQuestion(prisma: PrismaClient): Promise<void> {
  await prisma.assessmentInterviewThread.upsert({
    where: { assessmentId: "assessment-1" },
    update: {
      contextRevision: 0,
      activeQuestionId: QUESTION_ID,
      processedRevision: 0,
      privateContextJson: [],
      stateJson: {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        threadId: "interview:assessment-1",
        contextRevision: 0,
        activeQuestion: {
          id: QUESTION_ID,
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          prompt: "Runtime-authored Interview Agent question",
        },
        answerHistory: [],
      },
    },
    create: {
      id: "interview:assessment-1",
      assessmentId: "assessment-1",
      contextRevision: 0,
      activeQuestionId: QUESTION_ID,
      processedRevision: 0,
      privateContextJson: [],
      stateJson: {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        threadId: "interview:assessment-1",
        contextRevision: 0,
        activeQuestion: {
          id: QUESTION_ID,
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          prompt: "Runtime-authored Interview Agent question",
        },
        answerHistory: [],
      },
    },
  });
}
