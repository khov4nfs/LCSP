import { z } from "zod";

import {
  ASSESSMENT_ACTIVITY_KINDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  agentExecutionStateSchema,
  assessmentLifecycleStateSchema,
  decisionResolutionStateSchema,
  humanResolutionRequestStatusSchema,
  openHumanResolutionRequestSchema,
  ruleDecisionSchema,
} from "../assessment/agentic-runtime.ts";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
} from "./constants.ts";

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
  openHumanResolutionRequestSchema;
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
export const finishAssessmentRootRequestSchema = z.object({
  state: agentExecutionStateSchema,
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
