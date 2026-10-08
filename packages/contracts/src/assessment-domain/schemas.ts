import { z } from "zod";

import {
  ASSESSMENT_ACTIVITY_KINDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  agentExecutionStateSchema,
  assessmentLifecycleStateSchema,
  assessmentLifecycleSchema,
  artifactLifecycleStateSchema,
  decisionResolutionStateSchema,
  humanResolutionRequestStatusSchema,
  openHumanResolutionRequestSchema,
  answerHumanResolutionRequestSchema,
  ruleDecisionSchema,
} from "../assessment/agentic-runtime.ts";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_COMPLETION_BLOCKER_CODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
} from "./constants.ts";
import { assessmentRuntimeSchema } from "../evidence/assessment-runtime.ts";
import {
  ASSESSMENT_DESCRIPTION_MAX_LENGTH,
  ASSESSMENT_NAME_MAX_LENGTH,
} from "../assessment/constants.ts";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "../github-integration/statuses.ts";

const uuidSchema = z.uuid();
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const identifierSchema = z.string().trim().min(1).max(200);
const privateTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(ASSESSMENT_DOMAIN_LIMITS.MAX_STATEMENT_LENGTH);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const pathSchema = z
  .string()
  .min(1)
  .max(ASSESSMENT_DOMAIN_LIMITS.MAX_PATH_LENGTH)
  // Repository-relative only: no absolute path, no traversal, no NUL.
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\0") &&
      !value.split("/").includes(".."),
    { message: "Path must be repository-relative without traversal" },
  );

/** Tool-minted source evidence. The Python tool reads the pinned sandbox range and computes
 * the excerpt hash; the API verifies the pin and identity and mints the evidence ID. Agent
 * text never supplies an evidence ID. */
export const repositorySourceEvidenceRequestSchema = z
  .strictObject({
    type: z.literal(ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE),
    repositoryCommit: commitSchema,
    path: pathSchema,
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    excerptSha256: sha256Schema,
  })
  .refine(
    (value) =>
      value.endLine >= value.startLine &&
      value.endLine - value.startLine < ASSESSMENT_DOMAIN_LIMITS.MAX_LINE_SPAN,
    { path: ["endLine"], message: "Invalid or oversized line range" },
  );
export type RepositorySourceEvidenceRequest = z.infer<
  typeof repositorySourceEvidenceRequestSchema
>;

const boundedList = <T extends z.ZodType>(item: T, min = 0) =>
  z.array(item).min(min).max(ASSESSMENT_DOMAIN_LIMITS.MAX_COVERAGE_ITEMS);

/** Authenticated record of what a search actually covered. The Root decides sufficiency; the
 * server only verifies pin and shape. */
export const searchCoverageEvidenceRequestSchema = z.strictObject({
  type: z.literal(ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE),
  repositoryCommit: commitSchema,
  scopes: boundedList(
    z.strictObject({
      kind: z.enum(SEARCH_COVERAGE_SCOPE_KINDS),
      path: pathSchema,
    }),
    1,
  ),
  queries: boundedList(
    z.strictObject({
      tool: identifierSchema,
      query: privateTextSchema,
      resultCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
  ),
  inspectedEntryPoints: boundedList(pathSchema),
  knownGaps: boundedList(privateTextSchema),
  directSourceFallbacks: boundedList(
    z.strictObject({ path: pathSchema, reason: privateTextSchema }),
  ),
});
export type SearchCoverageEvidenceRequest = z.infer<
  typeof searchCoverageEvidenceRequestSchema
>;

export const acceptEvidenceRequestSchema = z.discriminatedUnion("type", [
  repositorySourceEvidenceRequestSchema,
  searchCoverageEvidenceRequestSchema,
]);
export type AcceptEvidenceRequest = z.infer<typeof acceptEvidenceRequestSchema>;

export const assessmentEvidenceSchema = z.strictObject({
  evidenceId: uuidSchema,
  assessmentId: uuidSchema,
  type: z.enum(ASSESSMENT_EVIDENCE_TYPES),
  state: z.enum(ASSESSMENT_RECORD_STATES),
  repositoryCommit: commitSchema,
  contentSha256: sha256Schema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>;

/** Root proposes an evidence-backed fact. The API validates that every cited evidence is an
 * accepted record of this assessment at the pinned commit. */
export const acceptCaseFactRequestSchema = z.strictObject({
  expectedCaseRevision: revisionSchema,
  kind: z.enum(ASSESSMENT_FACT_KINDS),
  statement: privateTextSchema,
  evidenceIds: z
    .array(uuidSchema)
    .min(1)
    .max(ASSESSMENT_DOMAIN_LIMITS.MAX_EVIDENCE_REFERENCES),
});
export type AcceptCaseFactRequest = z.infer<typeof acceptCaseFactRequestSchema>;

export const assessmentCaseFactSchema = z.strictObject({
  factId: uuidSchema,
  assessmentId: uuidSchema,
  caseRevision: revisionSchema,
  kind: z.enum(ASSESSMENT_FACT_KINDS),
  authority: z.enum(ASSESSMENT_FACT_AUTHORITIES),
  state: z.enum(ASSESSMENT_RECORD_STATES),
  statement: privateTextSchema,
  evidenceIds: z.array(uuidSchema),
  createdAt: z.iso.datetime(),
});
export type AssessmentCaseFact = z.infer<typeof assessmentCaseFactSchema>;

export const submitRuleDecisionRequestSchema = z.strictObject({
  expectedDecisionRevision: revisionSchema,
  idempotencyKey: z.string().min(8).max(128),
  decision: ruleDecisionSchema,
});
export type SubmitRuleDecisionRequest = z.infer<
  typeof submitRuleDecisionRequestSchema
>;

export const ruleDecisionRecordSchema = z.strictObject({
  decisionId: uuidSchema,
  assessmentId: uuidSchema,
  engineeringRuleId: identifierSchema,
  scopeId: identifierSchema,
  decisionRevision: revisionSchema,
  state: z.enum(ASSESSMENT_DECISION_RECORD_STATES),
  decision: ruleDecisionSchema,
  createdAt: z.iso.datetime(),
});
export type RuleDecisionRecord = z.infer<typeof ruleDecisionRecordSchema>;

export const decisionCoverageSchema = z.strictObject({
  engineeringRuleId: identifierSchema,
  engineeringRuleVersion: identifierSchema,
  resolutionState: decisionResolutionStateSchema,
  currentDecisionId: uuidSchema.nullable(),
  decisionRevision: revisionSchema,
});
export type DecisionCoverage = z.infer<typeof decisionCoverageSchema>;

export const startRuleInvestigationRequestSchema = z.strictObject({
  engineeringRuleId: identifierSchema,
});
export type StartRuleInvestigationRequest = z.infer<
  typeof startRuleInvestigationRequestSchema
>;

export const openAssessmentHumanRequestSchema =
  openHumanResolutionRequestSchema.extend({
    idempotencyKey: z.string().min(8).max(128),
  });
export type OpenAssessmentHumanRequest = z.infer<
  typeof openAssessmentHumanRequestSchema
>;
export const openAssessmentHumanRequestResultSchema = z.strictObject({
  requestId: uuidSchema,
  caseRevision: revisionSchema,
  requestRevision: revisionSchema,
});
export type OpenAssessmentHumanRequestResult = z.infer<
  typeof openAssessmentHumanRequestResultSchema
>;

/** Root-authored dependency claim. Shape/provenance validation does not judge obtainability. */
export const reportUnresolvableHumanFactRequestSchema = z.strictObject({
  humanResolutionRequestId: uuidSchema,
  expectedCaseRevision: revisionSchema,
  expectedRequestRevision: revisionSchema,
  rationale: privateTextSchema,
  evidenceIds: z
    .array(uuidSchema)
    .min(1)
    .max(ASSESSMENT_DOMAIN_LIMITS.MAX_EVIDENCE_REFERENCES),
});
export type ReportUnresolvableHumanFactRequest = z.infer<
  typeof reportUnresolvableHumanFactRequestSchema
>;
export const reportUnresolvableHumanFactResultSchema = z.strictObject({
  requestId: uuidSchema,
  caseRevision: revisionSchema,
  lifecycleState: z.literal(ASSESSMENT_LIFECYCLE_STATES.BLOCKED),
  replayed: z.boolean(),
});
export type ReportUnresolvableHumanFactResult = z.infer<
  typeof reportUnresolvableHumanFactResultSchema
>;

const answerAuthorityShape = {
  expectedRequestRevision: revisionSchema,
  idempotencyKey: z.string().min(8).max(128),
};
/** Reuses the frozen fact-only answer contract; adds request CAS and replay identity. */
export const answerAssessmentHumanRequestSchema = z.discriminatedUnion(
  "doesNotKnow",
  [
    answerHumanResolutionRequestSchema.options[0].extend(answerAuthorityShape),
    answerHumanResolutionRequestSchema.options[1].extend(answerAuthorityShape),
  ],
);
export type AnswerAssessmentHumanRequest = z.infer<
  typeof answerAssessmentHumanRequestSchema
>;

export const humanAnswerAuditSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(128),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  actorId: z.string().min(1),
  answeredAt: z.iso.datetime(),
  caseRevision: revisionSchema,
  requestRevision: revisionSchema,
  doesNotKnow: z.boolean(),
  answer: privateTextSchema.nullable(),
});
export type HumanAnswerAudit = z.infer<typeof humanAnswerAuditSchema>;

export const assessmentHumanRequestViewSchema = z.strictObject({
  ...openHumanResolutionRequestSchema.omit({ expectedCaseRevision: true })
    .shape,
  requestId: uuidSchema,
  requestRevision: revisionSchema,
  openedCaseRevision: revisionSchema,
  status: humanResolutionRequestStatusSchema,
  checkpointId: uuidSchema.nullable(),
  resolvedFactId: uuidSchema.nullable(),
  answers: z.array(humanAnswerAuditSchema),
});
export type AssessmentHumanRequestView = z.infer<
  typeof assessmentHumanRequestViewSchema
>;

export const assessmentHumanRequestsResultSchema = z.strictObject({
  caseRevision: revisionSchema,
  requests: z.array(assessmentHumanRequestViewSchema),
});
export type AssessmentHumanRequestsResult = z.infer<
  typeof assessmentHumanRequestsResultSchema
>;

export const answerAssessmentHumanRequestResultSchema = z.strictObject({
  requestId: uuidSchema,
  requestRevision: revisionSchema,
  caseRevision: revisionSchema,
  status: humanResolutionRequestStatusSchema,
  factId: uuidSchema.nullable(),
  resumed: z.boolean(),
  replayed: z.boolean(),
});
export type AnswerAssessmentHumanRequestResult = z.infer<
  typeof answerAssessmentHumanRequestResultSchema
>;
export const humanRequestRecordSchema = z.strictObject({
  requestId: uuidSchema,
  assessmentId: uuidSchema,
  status: humanResolutionRequestStatusSchema,
  caseRevision: revisionSchema,
  engineeringRuleId: identifierSchema,
  createdAt: z.iso.datetime(),
});
export type HumanRequestRecord = z.infer<typeof humanRequestRecordSchema>;

/** Server-owned run claim. Identity, thread and lease are issued by the API and never
 * supplied by an agent. */
export const claimAssessmentRootRequestSchema = z.strictObject({
  assessmentId: uuidSchema,
});
export const finishAssessmentRootRequestSchema = z
  .object({
    state: agentExecutionStateSchema,
    checkpointId: uuidSchema.optional(),
    controlRequestId: uuidSchema.optional(),
    requestIds: z.array(uuidSchema).min(1).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.state === AGENT_EXECUTION_STATES.INTERRUPTED &&
      (!value.checkpointId || !value.requestIds?.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "A human interrupt requires its native checkpoint and blockers",
      });
    }
    if (
      value.state === AGENT_EXECUTION_STATES.PAUSED &&
      (!value.checkpointId || !value.controlRequestId)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Safe pause requires its native checkpoint and authorized Stop request",
      });
    }
  });
export type FinishAssessmentRootRequest = z.infer<
  typeof finishAssessmentRootRequestSchema
>;
export const assessmentRootClaimSchema = z.strictObject({
  assessmentId: uuidSchema,
  threadId: uuidSchema,
  executionId: uuidSchema,
  leaseToken: uuidSchema,
  leaseExpiresAt: z.iso.datetime(),
  checkpointNamespace: z.string().min(1),
  executionState: agentExecutionStateSchema,
  resumeCheckpointId: uuidSchema.nullable(),
});
export type AssessmentRootClaim = z.infer<typeof assessmentRootClaimSchema>;

/** What the Root loads at (re)start. Everything is server state: pins, revisions, coverage. */
export const assessmentRootContextSchema = z.strictObject({
  assessmentId: uuidSchema,
  threadId: uuidSchema,
  lifecycleState: assessmentLifecycleStateSchema,
  lifecycleRevision: revisionSchema,
  caseRevision: revisionSchema,
  legalPortfolioVersionId: uuidSchema,
  repositorySnapshotId: z.string().min(1),
  repositoryScanJobId: z.string().min(1),
  repositoryCommit: commitSchema,
  decisionScopeId: identifierSchema,
  coverage: z.array(decisionCoverageSchema),
  facts: z.array(assessmentCaseFactSchema),
  evidence: z.array(assessmentEvidenceSchema),
  openHumanRequestIds: z.array(uuidSchema),
});
export type AssessmentRootContext = z.infer<typeof assessmentRootContextSchema>;

export const assessmentCompletionBlockerSchema = z.strictObject({
  code: z.enum(ASSESSMENT_COMPLETION_BLOCKER_CODES),
  reference: identifierSchema.optional(),
});
export type AssessmentCompletionBlocker = z.infer<
  typeof assessmentCompletionBlockerSchema
>;

export const assessmentCompletionGateResultSchema = z.strictObject({
  lifecycleState: assessmentLifecycleStateSchema,
  blockers: z.array(assessmentCompletionBlockerSchema),
});
export type AssessmentCompletionGateResult = z.infer<
  typeof assessmentCompletionGateResultSchema
>;

export const requestAssessmentFinalizationSchema = z.strictObject({});
export type RequestAssessmentFinalization = z.infer<
  typeof requestAssessmentFinalizationSchema
>;

const finalReportFindingRequestSchema = z.strictObject({
  engineeringRuleId: identifierSchema,
  summary: privateTextSchema,
  recommendations: z.array(privateTextSchema).max(20),
});

/** Root-authored narrative only. Rule outcomes and provenance are reloaded from accepted state. */
export const submitAssessmentFinalReportRequestSchema = z
  .strictObject({
    kind: z.literal(ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT),
    summary: privateTextSchema,
    findings: z
      .array(finalReportFindingRequestSchema)
      .min(1)
      .max(ASSESSMENT_DOMAIN_LIMITS.MAX_COVERAGE_ITEMS),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, finding] of value.findings.entries()) {
      if (seen.has(finding.engineeringRuleId)) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", index, "engineeringRuleId"],
          message: "Duplicate final report finding",
        });
      }
      seen.add(finding.engineeringRuleId);
    }
  });
export type SubmitAssessmentFinalReportRequest = z.infer<
  typeof submitAssessmentFinalReportRequestSchema
>;

export const assessmentFinalReportArtifactSchema = z.strictObject({
  schemaVersion: z.literal(ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION),
  artifactId: uuidSchema,
  assessmentId: uuidSchema,
  kind: z.literal(ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT),
  pins: z.strictObject({
    legalPortfolioVersionId: uuidSchema,
    repositorySnapshotId: identifierSchema,
    repositoryScanJobId: identifierSchema,
    repositoryCommit: commitSchema,
  }),
  caseRevision: revisionSchema,
  decisionFingerprint: sha256Schema,
  summary: privateTextSchema,
  findings: z.array(
    z.strictObject({
      engineeringRuleId: identifierSchema,
      decisionId: uuidSchema,
      decisionRevision: revisionSchema,
      decision: ruleDecisionSchema,
      summary: privateTextSchema,
      recommendations: z.array(privateTextSchema).max(20),
    }),
  ),
  provenance: z.strictObject({
    evidenceIds: z.array(uuidSchema),
    factIds: z.array(uuidSchema),
    searchCoverageEvidenceIds: z.array(uuidSchema),
  }),
});
export type AssessmentFinalReportArtifact = z.infer<
  typeof assessmentFinalReportArtifactSchema
>;

export const assessmentFinalReportResultSchema = z.strictObject({
  artifactId: uuidSchema,
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  lifecycleState: assessmentLifecycleStateSchema,
  replayed: z.boolean(),
});
export type AssessmentFinalReportResult = z.infer<
  typeof assessmentFinalReportResultSchema
>;

export const rootActivityRequestSchema = z.strictObject({
  executionId: uuidSchema,
  parentExecutionId: uuidSchema.optional(),
  taskId: identifierSchema.optional(),
  actorType: z.enum([
    ASSESSMENT_EVENT_ACTOR_TYPES.ASSESSMENT_ROOT,
    ASSESSMENT_EVENT_ACTOR_TYPES.SUBAGENT,
    ASSESSMENT_EVENT_ACTOR_TYPES.TOOL,
  ]),
  kind: z.enum(ASSESSMENT_ACTIVITY_KINDS),
  labelKey: z.string().min(3).max(200),
});
export type RootActivityRequest = z.infer<typeof rootActivityRequestSchema>;

/** Customer projections of persisted authorities. No legacy stage/readiness inference. */
export const assessmentArtifactViewSchema = z.strictObject({
  artifactId: uuidSchema,
  kind: z.enum(ASSESSMENT_ARTIFACT_KINDS),
  lifecycleState: artifactLifecycleStateSchema,
  legalPortfolioVersionId: uuidSchema,
  repositorySnapshotId: identifierSchema,
  repositoryCommit: commitSchema,
  caseRevision: revisionSchema,
  contentSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  sizeBytes: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
});
export const assessmentCaseViewSchema = z.strictObject({
  caseRevision: revisionSchema,
  legalPortfolioVersionId: uuidSchema.nullable(),
  repositorySnapshotId: identifierSchema.nullable(),
  repositoryScanJobId: identifierSchema.nullable(),
  repositoryCommit: commitSchema.nullable(),
  coverage: z.array(decisionCoverageSchema),
  decisions: z.array(ruleDecisionRecordSchema),
  facts: z.array(assessmentCaseFactSchema),
  artifacts: z.array(assessmentArtifactViewSchema),
});
export const assessmentDetailSchema = z.strictObject({
  assessment_id: uuidSchema,
  name: z.string().trim().min(1).max(ASSESSMENT_NAME_MAX_LENGTH),
  owner_id: z.string().min(1),
  lifecycle: assessmentLifecycleSchema.nullable(),
  runtime: assessmentRuntimeSchema.nullable(),
  case: assessmentCaseViewSchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  correlationId: z.string(),
});
export type AssessmentDetail = z.infer<typeof assessmentDetailSchema>;

export const createAssessmentSchema = z.strictObject({
  name: assessmentDetailSchema.shape.name.trim(),
  description: z
    .string()
    .trim()
    .max(ASSESSMENT_DESCRIPTION_MAX_LENGTH)
    .optional(),
});
export const renameAssessmentSchema = createAssessmentSchema.pick({
  name: true,
});

export const assessmentListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  lifecycleState: assessmentLifecycleStateSchema.optional(),
});
export type AssessmentListQuery = z.infer<typeof assessmentListQuerySchema>;
export const assessmentListSchema = z.strictObject({
  assessments: z.array(
    assessmentDetailSchema.omit({
      owner_id: true,
      case: true,
      correlationId: true,
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  correlationId: z.string(),
});
export type AssessmentList = z.infer<typeof assessmentListSchema>;

/** Repository hydration has resource-local status; it never determines ALS/AES. */
export const assessmentRepositorySetupSchema = z.strictObject({
  assessmentId: uuidSchema,
  lifecycle: assessmentLifecycleSchema.nullable(),
  connection: z
    .strictObject({
      connectionId: identifierSchema,
      provider: z.enum(CREDENTIAL_PROVIDERS),
      repositoryId: identifierSchema,
      repositoryFullName: identifierSchema,
      defaultBranch: identifierSchema,
      status: z.enum(REPOSITORY_CONNECTION_STATUSES),
    })
    .nullable(),
  snapshot: z
    .strictObject({
      id: identifierSchema,
      assessmentId: uuidSchema,
      connectionId: identifierSchema,
      provider: z.enum(CREDENTIAL_PROVIDERS),
      repositoryFullName: identifierSchema,
      branch: identifierSchema.nullable(),
      commitSha: commitSchema,
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  scanJob: z
    .strictObject({
      id: identifierSchema,
      assessmentId: uuidSchema,
      snapshotId: identifierSchema,
      status: z.enum(REPOSITORY_SCAN_JOB_STATUSES),
      attemptCount: z.number().int().nonnegative(),
      blockedReason: identifierSchema.nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type AssessmentRepositorySetup = z.infer<
  typeof assessmentRepositorySetupSchema
>;

export const completeAssessmentRepositorySetupResultSchema = z.strictObject({
  assessment_id: uuidSchema,
  repository_connection_id: identifierSchema,
  snapshot_id: identifierSchema,
  commit_sha: commitSchema,
});
