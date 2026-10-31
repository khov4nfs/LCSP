import { z } from "zod";
import { ruleDecisionSchema } from "../assessment/agentic-runtime.ts";

export const ASSESSMENT_AUDIT_MODES = {
  LEGACY_FULL: "LEGACY_FULL",
  CUSTOMER_SELECTED: "CUSTOMER_SELECTED",
} as const;
export const RULE_AUDIT_SCOPE_MODES = {
  SELECTED_RULES: "SELECTED_RULES",
  FULL_RULE_SET: "FULL_RULE_SET",
} as const;
export const RULE_AUDIT_STATUSES = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  WAITING_FOR_CUSTOMER: "WAITING_FOR_CUSTOMER",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
  CANCELLED: "CANCELLED",
} as const;
export const RULE_AUDIT_PROGRESS_STATES = {
  NOT_SELECTED: "NOT_SELECTED",
  QUEUED: "QUEUED",
  INVESTIGATING: "INVESTIGATING",
  WAITING_FOR_CUSTOMER: "WAITING_FOR_CUSTOMER",
  RESULT_READY: "RESULT_READY",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
  STALE: "STALE",
} as const;

const ruleIdentitySchema = z.strictObject({
  assessmentRuleId: z.string().min(1),
  assessmentRuleVersion: z.string().min(1),
});

/** Customer intent is pinned to exact server identities; FULL_RULE_SET is an explicit opt-in. */
export const submitRuleAuditSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  expectedAuditRevision: z.number().int().nonnegative(),
  ruleSetVersionId: z.uuid(),
  ruleSetDigest: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryCommit: z.string().regex(/^[a-f0-9]{40,64}$/i),
  scopeMode: z.enum(RULE_AUDIT_SCOPE_MODES),
  rules: z.array(ruleIdentitySchema).max(10000),
});
export type SubmitRuleAudit = z.infer<typeof submitRuleAuditSchema>;

export const ruleAuditCatalogSchema = z.strictObject({
  assessmentId: z.string().min(1),
  auditMode: z.enum(ASSESSMENT_AUDIT_MODES),
  auditRevision: z.number().int().nonnegative(),
  ruleSetVersionId: z.uuid(),
  ruleSetDigest: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryCommit: z.string().min(1),
  latestRequestId: z.uuid().nullable(),
  latestRequestStatus: z.enum(RULE_AUDIT_STATUSES).nullable(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  rules: z.array(
    ruleIdentitySchema.extend({
      concept: z.string().min(1),
      summary: z.string().min(1),
      legalRequirements: z.array(
        z.strictObject({
          legalRequirementId: z.string().min(1),
          title: z.string().min(1),
          sources: z
            .array(
              z.strictObject({
                documentId: z.string().min(1),
                locator: z.string().min(1),
              }),
            )
            .default([]),
        }),
      ),
      progress: z.enum(RULE_AUDIT_PROGRESS_STATES),
      decisionId: z.uuid().nullable(),
    }),
  ),
});
export type RuleAuditCatalog = z.infer<typeof ruleAuditCatalogSchema>;

export const ruleAuditRequestViewSchema = z.strictObject({
  requestId: z.uuid(),
  assessmentId: z.string().min(1),
  requestRevision: z.number().int().positive(),
  scopeMode: z.enum(RULE_AUDIT_SCOPE_MODES),
  status: z.enum(RULE_AUDIT_STATUSES),
  ruleSetVersionId: z.uuid(),
  ruleSetDigest: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryCommit: z.string().min(1),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  totalPinned: z.number().int().nonnegative(),
  requested: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  notRequested: z.number().int().nonnegative(),
  rules: z.array(
    ruleIdentitySchema.extend({
      ordinal: z.number().int().nonnegative(),
      progress: z.enum(RULE_AUDIT_PROGRESS_STATES),
      decisionId: z.uuid().nullable(),
    }),
  ),
});
export type RuleAuditRequestView = z.infer<typeof ruleAuditRequestViewSchema>;

export const RULE_AUDIT_EXPORT_KINDS = {
  PARTIAL_SELECTED_RULE_AUDIT: "PARTIAL_SELECTED_RULE_AUDIT",
} as const;
export const RULE_AUDIT_EXPORT_SCHEMA_VERSION =
  "SELECTED_RULE_AUDIT_V1" as const;
export const ruleAuditExportRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});
export const ruleAuditRetryRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
});
export const ruleAuditExportMetadataSchema = z.strictObject({
  exportId: z.uuid(),
  requestId: z.uuid(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});
export const ruleAuditExportSchema = z.strictObject({
  schemaVersion: z.literal(RULE_AUDIT_EXPORT_SCHEMA_VERSION),
  kind: z.literal(RULE_AUDIT_EXPORT_KINDS.PARTIAL_SELECTED_RULE_AUDIT),
  exportId: z.uuid(),
  requestId: z.uuid(),
  assessmentId: z.string().min(1),
  ruleSetVersionId: z.uuid(),
  ruleSetDigest: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryCommit: z.string().min(1),
  requestRevision: z.number().int().positive(),
  requestedRuleIds: z.array(z.string().min(1)).min(1),
  includedRuleIds: z.array(z.string().min(1)).min(1),
  notRequestedRuleCount: z.number().int().nonnegative(),
  exportedAt: z.iso.datetime(),
  results: z
    .array(
      z.strictObject({
        assessmentRuleId: z.string().min(1),
        assessmentRuleVersion: z.string().min(1),
        decisionId: z.uuid(),
        decisionRevision: z.number().int().positive(),
        decision: ruleDecisionSchema,
        evidence: z.array(
          z.strictObject({
            evidenceId: z.uuid(),
            type: z.string().min(1),
            repositoryCommit: z.string().min(1),
            payload: z.unknown(),
          }),
        ),
        legalBasis: z.strictObject({
          concept: z.string().min(1),
          legalIntent: z.string().min(1),
          legalRequirements: z.array(
            z.strictObject({
              legalRequirementId: z.string().min(1),
              title: z.string().min(1),
              sources: z.array(
                z.strictObject({
                  documentId: z.string().min(1),
                  locator: z.string().min(1),
                }),
              ),
            }),
          ),
        }),
      }),
    )
    .min(1),
});
export type RuleAuditExport = z.infer<typeof ruleAuditExportSchema>;
