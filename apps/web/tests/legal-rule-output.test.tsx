import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_EXECUTION_STATES as EXEC,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES as LIFE,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  assessmentEventSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentProvenanceArtifactSchema,
  ruleAuditCatalogSchema,
  type AssessmentDetail,
} from "@lcsp/contracts/assessment-domain";
import { setAppLocale } from "../src/lib/locale.ts";
import { projectConversation } from "../src/features/assessment-runtime/utils/conversation-projection.ts";
import {
  CONVERSATION_TURN_KINDS,
  type DecisionRecord,
} from "../src/features/assessment-runtime/types/conversation.types.ts";
import { ConversationDecisionTurn } from "../src/features/assessment-runtime/components/molecules/conversation-decision-turn.tsx";
import { AssessmentContextPanel } from "../src/features/assessment-runtime/components/organisms/assessment-context-panel.tsx";
import {
  buildLegalRulePresentationModel,
  extractLegalDocumentNumber,
} from "../src/features/assessment-runtime/utils/legal-rule-presentation.ts";
import { render, settle, installFetch } from "./support/dom.ts";
import {
  ASSESSMENT_ID,
  COMMIT,
  DECISION_ID,
  EVIDENCE_ID,
  EXECUTION_ID,
  RULE_SET_ID,
  SNAPSHOT_ID,
  THREAD_ID,
  detail,
  events,
} from "./support/assessment-conversation-fixtures.ts";

setAppLocale("en");

const REPOSITORY = { fullName: "acme/notice-service", commit: "c14f518" };
const SECOND_DECISION_ID = "99999999-9999-4999-9999-999999999999";
const NOT_APPLICABLE_DECISION_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function createDecisionEvent(
  sequence: number,
  seconds: number,
  decisionId: string,
  assessmentRuleId: string,
) {
  return assessmentEventSchema.parse({
    eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    assessmentId: ASSESSMENT_ID,
    threadId: THREAD_ID,
    sequence,
    timestamp: new Date(Date.UTC(2026, 9, 11, 10, 0, seconds)).toISOString(),
    actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
    eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
    payload: {
      decisionId,
      assessmentRuleId,
      decisionRevision: 1,
    },
  });
}

function withClient(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

test("UI-01: conversation projection filters out NOT_APPLICABLE decisions and retains only APPLICABLE rules", () => {
  const baseDetail = detail({ decisions: true });

  const applicableDecisionRecord: DecisionRecord = {
    decisionId: DECISION_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRuleId: "ER-RET",
    scopeId: "ASSESSMENT",
    decisionRevision: 1,
    state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    createdAt: new Date().toISOString(),
    decision: {
      assessmentRuleId: "ER-RET",
      assessmentRuleVersion: "2026.10",
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      scopeId: "ASSESSMENT",
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "LC-1" }],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
      rationale: "Deletion uses draft timestamp instead of receipt timestamp.",
      references: [
        {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: EVIDENCE_ID,
        },
      ],
      criteria: [
        {
          criterionId: "C-1",
          outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
          rationale: "Timestamp calculation does not adhere to receipt date.",
          references: [],
        },
      ],
    },
  };

  const notApplicableDecisionRecord: DecisionRecord = {
    decisionId: NOT_APPLICABLE_DECISION_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRuleId: "ER-PAYMENT",
    scopeId: "ASSESSMENT",
    decisionRevision: 1,
    state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    createdAt: new Date().toISOString(),
    decision: {
      assessmentRuleId: "ER-PAYMENT",
      assessmentRuleVersion: "2026.10",
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      scopeId: "ASSESSMENT",
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "LC-2" }],
      applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
      compliance: null,
      rationale: "Repository does not process intermediary payment gateways.",
      references: [],
      criteria: [],
    },
  };

  const multiDecisionDetail: AssessmentDetail = {
    ...baseDetail,
    case: {
      ...baseDetail.case!,
      decisions: [applicableDecisionRecord, notApplicableDecisionRecord],
      coverage: [
        {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          resolutionState: "RESOLVED",
          currentDecisionId: DECISION_ID,
          decisionRevision: 1,
          concept: "Notice retention",
        },
        {
          assessmentRuleId: "ER-PAYMENT",
          assessmentRuleVersion: "2026.10",
          resolutionState: "RESOLVED",
          currentDecisionId: NOT_APPLICABLE_DECISION_ID,
          decisionRevision: 1,
          concept: "Payment gateway compliance",
        },
      ],
    },
  };

  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [
      events.lifecycle(1, 0, LIFE.PREPARING, LIFE.ACTIVE),
      events.execution(2, 0, EXEC.QUEUED, EXEC.RUNNING),
      createDecisionEvent(3, 10, DECISION_ID, "ER-RET"),
      createDecisionEvent(4, 20, NOT_APPLICABLE_DECISION_ID, "ER-PAYMENT"),
    ],
    detail: multiDecisionDetail,
    requests: [],
    repository: REPOSITORY,
  });

  const decisionTurns = projection.turns.filter(
    (turn) => turn.kind === CONVERSATION_TURN_KINDS.DECISION,
  );

  assert.equal(
    decisionTurns.length,
    1,
    "Only the APPLICABLE legal rule must be projected as a conversation decision turn",
  );
  assert.equal(decisionTurns[0]?.decisionId, DECISION_ID);
  assert.equal(decisionTurns[0]?.concept, "Notice retention");
});

test("UI-02: each APPLICABLE legal rule produces its own distinct output turn", () => {
  const baseDetail = detail({ decisions: true });

  const firstRecord: DecisionRecord = {
    decisionId: DECISION_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRuleId: "ER-RET",
    scopeId: "ASSESSMENT",
    decisionRevision: 1,
    state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    createdAt: new Date().toISOString(),
    decision: {
      assessmentRuleId: "ER-RET",
      assessmentRuleVersion: "2026.10",
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      scopeId: "ASSESSMENT",
      caseRevision: 1,
      legalContextRefs: [],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
      rationale: "Retention duration not respected.",
      references: [],
      criteria: [],
    },
  };

  const secondRecord: DecisionRecord = {
    decisionId: SECOND_DECISION_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRuleId: "ER-CONSENT",
    scopeId: "ASSESSMENT",
    decisionRevision: 1,
    state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    createdAt: new Date().toISOString(),
    decision: {
      assessmentRuleId: "ER-CONSENT",
      assessmentRuleVersion: "2026.10",
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      scopeId: "ASSESSMENT",
      caseRevision: 1,
      legalContextRefs: [],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
      rationale: "User consent banner correctly captures affirmative opt-in.",
      references: [],
      criteria: [],
    },
  };

  const multiApplicableDetail: AssessmentDetail = {
    ...baseDetail,
    case: {
      ...baseDetail.case!,
      decisions: [firstRecord, secondRecord],
      coverage: [
        {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          resolutionState: "RESOLVED",
          currentDecisionId: DECISION_ID,
          decisionRevision: 1,
          concept: "Data Retention Duty",
        },
        {
          assessmentRuleId: "ER-CONSENT",
          assessmentRuleVersion: "2026.10",
          resolutionState: "RESOLVED",
          currentDecisionId: SECOND_DECISION_ID,
          decisionRevision: 1,
          concept: "Consent Notice Requirement",
        },
      ],
    },
  };

  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [
      events.lifecycle(1, 0, LIFE.PREPARING, LIFE.ACTIVE),
      events.execution(2, 0, EXEC.QUEUED, EXEC.RUNNING),
      createDecisionEvent(3, 10, DECISION_ID, "ER-RET"),
      createDecisionEvent(4, 25, SECOND_DECISION_ID, "ER-CONSENT"),
    ],
    detail: multiApplicableDetail,
    requests: [],
    repository: REPOSITORY,
  });

  const decisionTurns = projection.turns.filter(
    (turn) => turn.kind === CONVERSATION_TURN_KINDS.DECISION,
  );

  assert.equal(
    decisionTurns.length,
    2,
    "Each APPLICABLE rule must generate a separate output turn",
  );
  assert.equal(decisionTurns[0]?.decisionId, DECISION_ID);
  assert.equal(decisionTurns[1]?.decisionId, SECOND_DECISION_ID);
});

test("UI-03: extractLegalDocumentNumber parses official regulatory document numbers", () => {
  assert.equal(
    extractLegalDocumentNumber(
      "Nghị định số 147/2024/NĐ-CP về quản lý internet",
    ),
    "147/2024/NĐ-CP",
  );
  assert.equal(
    extractLegalDocumentNumber("Luật An toàn thông tin mạng số 86/2015/QH13"),
    "86/2015/QH13",
  );
  assert.equal(
    extractLegalDocumentNumber("Thông tư 05/2023/TT-BTTTT quy định kỹ thuật"),
    "05/2023/TT-BTTTT",
  );
  assert.equal(
    extractLegalDocumentNumber("13/2023/NĐ-CP Bảo vệ dữ liệu cá nhân"),
    "13/2023/NĐ-CP",
  );
  assert.equal(
    extractLegalDocumentNumber("nghi-dinh-so-147-2024-nd-cp"),
    "147/2024/NĐ-CP",
  );
  assert.equal(
    extractLegalDocumentNumber("luat-so-86-2015-qh13"),
    "86/2015/QH13",
  );
  assert.equal(
    extractLegalDocumentNumber("Generic Guideline Without Number"),
    null,
  );
});

test("UI-03 & UI-04: buildLegalRulePresentationModel formats verbatim rule and strips technical jargon", () => {
  const model = buildLegalRulePresentationModel({
    turn: {
      kind: CONVERSATION_TURN_KINDS.DECISION,
      id: "decision:1",
      sequence: 1,
      at: "2026-10-11T10:00:00.000Z",
      decisionId: DECISION_ID,
      assessmentRuleId: "ER-RET",
      concept: "Customer Notice Retention",
      record: {
        decisionId: DECISION_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRuleId: "ER-RET",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        createdAt: "2026-10-11T10:00:00.000Z",
        decision: {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          scopeId: "ASSESSMENT",
          caseRevision: 1,
          legalContextRefs: [],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
          rationale: "Retention period uses draft creation timestamp.",
          references: [
            {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_ID,
            },
          ],
          criteria: [
            {
              criterionId: "C-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
              rationale: "Calculates expiry from draft rather than receipt.",
              references: [],
            },
          ],
        },
      },
    },
    catalog: {
      assessmentId: ASSESSMENT_ID,
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      auditRevision: 1,
      ruleSetVersionId: RULE_SET_ID,
      ruleSetDigest: "digest-1",
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      latestRequestId: null,
      latestRequestStatus: null,
      total: 1,
      offset: 0,
      nextOffset: null,
      groups: [],
      groupingState: "APPROVED" as const,
      localizationState: "READY" as const,
      excludedRuleCount: 0,
      rules: [
        {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          concept: "Customer Notice Retention",
          summary: "Mandatory retention of customer notices for 90 days.",
          legalRequirements: [
            {
              legalRequirementId: "LR-1",
              title: "Notice retention obligation",
              sources: [
                {
                  documentId: "DOC-147",
                  locator: "Điều 23, Khoản 2, Điểm b",
                },
              ],
            },
          ],
          progress: "RESULT_READY" as const,
          decisionId: DECISION_ID,
          membership: null,
        },
      ],
    },
    library: {
      versionId: "ver-147",
      version: "2024.12",
      sourceName: "National Legal Database",
      activatedAt: "2024-12-25T00:00:00.000Z",
      documents: [
        {
          id: "doc-row-147",
          documentId: "DOC-147",
          title:
            "Nghị định số 147/2024/NĐ-CP về quản lý, cung cấp, sử dụng internet",
          sourceUrl: "https://vanban.chinhphu.vn/147-2024-nd-cp",
          sourceEffectStatus: "EFFECTIVE",
          effectiveDate: "2024-12-25",
          chunkCount: 1,
          mediaType: null,
          hasOriginal: true,
        },
      ],
    },
    provenance: {
      schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
      assessmentId: ASSESSMENT_ID,
      name: "Notice Service Assessment",
      ownerId: "owner-1",
      generatedAt: "2026-10-11T10:00:00.000Z",
      contentFingerprintSha256: "0".repeat(64),
      checksumSha256: "0".repeat(64),
      correlationId: "corr-1",
      lifecycle: { state: "ACTIVE", assessmentRevision: 1 },
      pins: {
        ruleSet: {
          ruleSetVersionId: RULE_SET_ID,
          version: "1.0",
          legalSourceVersion: "1.0",
          legalRequirementCount: 1,
          assessmentRuleCount: 1,
        },
        repositorySnapshotId: SNAPSHOT_ID,
        repositoryScanJobId: "job-1",
        repositoryCommit: COMMIT,
        repositorySetDigest: null,
        repositories: [],
        pinnedAt: "2026-10-11T10:00:00.000Z",
      },
      runtime: {
        threadId: THREAD_ID,
        rootAgentVersion: "1.0",
        checkpointNamespace: "ns-1",
        checkpointId: null,
        currentExecutionId: EXECUTION_ID,
        executionState: "RUNNING",
        eventSequence: 1,
        startedAt: "2026-10-11T10:00:00.000Z",
        lastResumedAt: null,
        updatedAt: "2026-10-11T10:00:00.000Z",
      },
      acceptedFacts: [],
      acceptedEvidence: [
        {
          evidenceId: EVIDENCE_ID,
          assessmentId: ASSESSMENT_ID,
          type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
          state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
          repositoryCommit: COMMIT,
          repositoryKey: null,
          contentSha256: "sha256:abcdef",
          payload: {
            path: "src/services/notice-retention.ts",
            startLine: 45,
            endLine: 62,
            excerpt: "const expiryDate = draft.createdAt + RETENTION_MS;",
            scopes: ["retention-job"],
            queries: ["draft.createdAt"],
          },
          createdAt: "2026-10-11T10:00:00.000Z",
        },
      ],
      humanResolutions: [],
      decisions: [],
      coverage: [],
      events: [],
      artifacts: [],
    },
  });

  // Verify Identity
  assert.equal(model.identity.concept, "Customer Notice Retention");
  assert.equal(
    model.identity.documentTitle,
    "Nghị định số 147/2024/NĐ-CP về quản lý, cung cấp, sử dụng internet",
  );
  assert.equal(model.identity.documentNumber, "147/2024/NĐ-CP");
  assert.equal(model.identity.locator, "Điều 23, Khoản 2, Điểm b");
  assert.equal(model.identity.effectiveStatus, "EFFECTIVE");

  // Verify Applicability explanation
  assert.equal(model.applicability.isApplicable, true);
  assert.ok(model.applicability.targetActivity.length > 0);
  assert.ok(model.applicability.nonEquivalenceNote.length > 0);

  // Verify Compliance & Obligation
  assert.equal(
    model.compliance.outcome,
    RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
  );
  assert.equal(
    model.obligation.summary,
    "Mandatory retention of customer notices for 90 days.",
  );
  assert.equal(model.obligation.criteria.length, 1);
  assert.equal(
    model.obligation.criteria[0]?.outcome,
    RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
  );

  // Verify Evidence
  assert.equal(model.evidenceList.length, 1);
  assert.equal(model.evidenceList[0]?.path, "src/services/notice-retention.ts");
  assert.equal(model.evidenceList[0]?.startLine, 45);
  assert.equal(model.evidenceList[0]?.endLine, 62);
  assert.match(model.evidenceList[0]?.excerpt ?? "", /draft\.createdAt/);

  // Verify 5-step Reasoning Synthesis
  assert.ok(model.synthesis.step1Obligation.length > 0);
  assert.ok(model.synthesis.step2Scope.length > 0);
  assert.ok(model.synthesis.step3Evidence.length > 0);
  assert.ok(model.synthesis.step4Fulfillment.length > 0);
  assert.ok(model.synthesis.step5Conclusion.length > 0);

  // Verify no technical jargon is present in the user model
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(
    serialized,
    /Rule Engineer|Preparation Rule|RulePreparationActivity/i,
  );
});

test("UI-03, UI-05, UI-06, UI-07, UI-09: ConversationDecisionTurn renders the enterprise LegalTech compliance workflow", async () => {
  const baseDetail = detail({ decisions: true });
  const catalogData = {
    rules: [
      {
        assessmentRuleId: "ER-RET",
        assessmentRuleVersion: "2026.10",
        concept: "Notice retention",
        summary: "Mandatory 90-day retention of notices.",
        legalRequirements: [
          {
            legalRequirementId: "LR-1",
            title: "Notice retention obligation",
            sources: [
              {
                documentId: "DOC-147",
                locator: "Điều 23, Khoản 2, Điểm b",
              },
            ],
          },
        ],
        progress: "RESULT_READY",
        decisionId: DECISION_ID,
        membership: null,
      },
    ],
    offset: 0,
    nextOffset: null,
    total: 1,
    localizationFallback: false,
    localizationState: "READY",
    groupingState: "APPROVED",
    groups: [],
    excludedRuleCount: 0,
    assessmentId: ASSESSMENT_ID,
    auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
    auditRevision: 1,
    ruleSetVersionId: RULE_SET_ID,
    ruleSetDigest: "digest-1",
    repositorySnapshotId: SNAPSHOT_ID,
    repositoryCommit: COMMIT,
    latestRequestId: null,
    latestRequestStatus: null,
  };

  const provenanceData = {
    schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
    assessmentId: ASSESSMENT_ID,
    name: "Notice Service Assessment",
    ownerId: "owner-1",
    generatedAt: new Date().toISOString(),
    contentFingerprintSha256: "0".repeat(64),
    checksumSha256: "0".repeat(64),
    correlationId: "corr-1",
    lifecycle: { state: "ACTIVE", assessmentRevision: 1 },
    pins: {
      ruleSet: {
        ruleSetVersionId: RULE_SET_ID,
        version: "1.0",
        legalSourceVersion: "1.0",
        legalRequirementCount: 1,
        assessmentRuleCount: 1,
      },
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryScanJobId: "job-1",
      repositoryCommit: COMMIT,
      pinnedAt: new Date().toISOString(),
    },
    runtime: {
      threadId: THREAD_ID,
      rootAgentVersion: "1.0",
      checkpointNamespace: ASSESSMENT_ID,
      checkpointId: null,
      currentExecutionId: EXECUTION_ID,
      executionState: "RUNNING",
      eventSequence: 1,
      startedAt: new Date().toISOString(),
      lastResumedAt: null,
      updatedAt: new Date().toISOString(),
    },
    acceptedFacts: [],
    acceptedEvidence: [
      {
        evidenceId: EVIDENCE_ID,
        assessmentId: ASSESSMENT_ID,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        repositoryCommit: COMMIT,
        contentSha256: `sha256:${"0".repeat(64)}`,
        payload: {
          path: "src/retention/policy.ts",
          startLine: 12,
          endLine: 28,
          excerpt: "const retentionDays = 30;",
          scopes: ["retention-config"],
          queries: ["retentionDays"],
        },
        createdAt: new Date().toISOString(),
      },
    ],
    humanResolutions: [],
    decisions: [],
    coverage: [],
    events: [],
    artifacts: [],
  };

  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}`]: baseDetail,
    [`GET /api/assessments/${ASSESSMENT_ID}/rules`]: catalogData,
    [`GET /api/legal-library`]: {
      versionId: "ver-147",
      version: "2024.12",
      sourceName: "National Legal Database",
      activatedAt: new Date().toISOString(),
      documents: [
        {
          id: "doc-147",
          documentId: "DOC-147",
          title: "Nghị định 147/2024/NĐ-CP",
          sourceUrl: "https://vanban.chinhphu.vn/147",
          sourceEffectStatus: "EFFECTIVE",
          effectiveDate: "2024-12-25",
          chunkCount: 1,
          mediaType: null,
          hasOriginal: true,
        },
      ],
    },
    [`GET /api/legal-sources/doc-147/chunks`]: {
      chunks: [
        {
          chunkId: "chunk-1",
          documentRowId: "doc-147",
          locator: "Điều 23, Khoản 2, Điểm b",
          content:
            "Doanh nghiệp cung cấp dịch vụ mạng xã hội phải lưu trữ thông tin tối thiểu 90 ngày.",
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    },
    [`GET /api/assessments/${ASSESSMENT_ID}/provenance`]: provenanceData,
  });

  try {
    const turn = {
      kind: CONVERSATION_TURN_KINDS.DECISION,
      id: "decision:ret-1",
      sequence: 6,
      at: new Date().toISOString(),
      decisionId: DECISION_ID,
      assessmentRuleId: "ER-RET",
      concept: "Notice retention",
      record: {
        decisionId: DECISION_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRuleId: "ER-RET",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        createdAt: new Date().toISOString(),
        decision: {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          scopeId: "ASSESSMENT",
          caseRevision: 1,
          legalContextRefs: [],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
          rationale:
            "Deletion is based on draft timestamp instead of receipt timestamp.",
          references: [
            {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_ID,
            },
          ],
          criteria: [
            {
              criterionId: "C-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
              rationale:
                "Retention period configured as 30 days instead of required 90 days.",
              references: [
                {
                  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                  evidenceId: EVIDENCE_ID,
                },
              ],
            },
          ],
        },
      },
    };

    const view = render(withClient(<ConversationDecisionTurn turn={turn} />));
    await settle();

    // 1. Overall slot present
    const output = view.querySelector('[data-slot="legal-rule-output"]');
    assert.ok(output, "LegalRuleOutput must be rendered");

    // 2. Step flow rendered
    const stepFlow = view.querySelector('[data-slot="compliance-step-flow"]');
    assert.ok(stepFlow, "Visual compliance step flow must be present");
    assert.match(stepFlow.textContent ?? "", /Rule/);
    assert.match(stepFlow.textContent ?? "", /Applicability/);
    assert.match(stepFlow.textContent ?? "", /Obligation/);
    assert.match(stepFlow.textContent ?? "", /Compliance/);
    assert.match(stepFlow.textContent ?? "", /Evidence/);
    assert.match(stepFlow.textContent ?? "", /Conclusion/);

    // 3. Raw Legal Rule Viewer
    const rawViewer = view.querySelector('[data-slot="raw-legal-rule-viewer"]');
    assert.ok(rawViewer, "Raw legal rule viewer must be present");
    assert.match(rawViewer.textContent ?? "", /147\/2024\/NĐ-CP/);
    assert.match(rawViewer.textContent ?? "", /Điều 23, Khoản 2, Điểm b/);

    // 4. Applicability Explanation
    const applicability = view.querySelector(
      '[data-slot="applicability-explanation"]',
    );
    assert.ok(applicability, "Applicability explanation must be present");
    assert.match(
      applicability.textContent ?? "",
      /Notice retention obligation/,
    );

    // 5. Compliance Assessment
    const complianceBadge = view.querySelector(
      '[data-slot="compliance-outcome-badge"]',
    );
    assert.ok(complianceBadge, "Compliance outcome badge must be present");
    assert.match(complianceBadge.textContent ?? "", /Non-compliant/);

    // 6. Evidence Relationship Viewer
    const evidenceViewer = view.querySelector(
      '[data-slot="evidence-relationship-viewer"]',
    );
    assert.ok(evidenceViewer, "Evidence relationship viewer must be present");
    assert.match(
      evidenceViewer.textContent ?? "",
      /src\/retention\/policy\.ts/,
    );
    assert.match(evidenceViewer.textContent ?? "", /12[–-]28/);
    assert.match(evidenceViewer.textContent ?? "", /const retentionDays = 30;/);

    // 7. Reasoning Synthesis (Area F)
    const synthesis = view.querySelector(
      '[data-slot="compliance-reasoning-summary"]',
    );
    assert.ok(synthesis, "Reasoning synthesis must be present");
    assert.match(synthesis.textContent ?? "", /Notice retention obligation/);
    assert.match(
      synthesis.textContent ?? "",
      /Deletion is based on draft timestamp/,
    );

    // 8. Follow-up Action
    const followUpBtn = view.querySelector('[data-slot="ask-follow-up-rule"]');
    assert.ok(followUpBtn, "Follow-up question action must be present");
  } finally {
    stub.restore();
  }
});

test("UI-15: AssessmentContextPanel provides quick-jump navigation links for all APPLICABLE rules", async () => {
  const baseDetail = detail({ decisions: true });
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}`]: baseDetail,
    [`GET /api/assessments/${ASSESSMENT_ID}/repository-setup`]: {
      assessmentId: ASSESSMENT_ID,
      lifecycle: null,
      connection: {
        connectionId: "c1",
        provider: "GITHUB",
        repositoryId: "r1",
        repositoryFullName: "acme/notice-service",
        defaultBranch: "main",
        status: "ACTIVE",
      },
      snapshot: null,
      scanJob: null,
    },
  });

  try {
    const view = render(
      withClient(<AssessmentContextPanel assessmentId={ASSESSMENT_ID} />),
    );
    await settle();

    const quickJumpList = view.querySelector(
      '[data-slot="applicable-rules-quick-jump"]',
    );
    assert.ok(
      quickJumpList,
      "Quick jump list for applicable rules must be rendered in context panel",
    );

    const quickJumpLink = view.querySelector(
      `a[href="#decision-${DECISION_ID}"]`,
    );
    assert.ok(
      quickJumpLink,
      `Anchor link to #decision-${DECISION_ID} must be present`,
    );
    assert.match(quickJumpLink.textContent ?? "", /Notice retention/);
  } finally {
    stub.restore();
  }
});
