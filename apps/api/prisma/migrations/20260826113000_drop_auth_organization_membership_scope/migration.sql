-- Remove organization/membership tenancy after RBAC was reduced to user-level roles.

DROP INDEX IF EXISTS "AuthSession_organizationId_idx";
DROP INDEX IF EXISTS "AuthAuditEvent_organizationId_idx";
DROP INDEX IF EXISTS "AuthAuditEvent_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "AuthDecisionLog_organizationId_idx";
DROP INDEX IF EXISTS "Assessment_organizationId_status_idx";
DROP INDEX IF EXISTS "WizardProfile_organizationId_idx";
DROP INDEX IF EXISTS "ReadinessExport_organizationId_idx";
DROP INDEX IF EXISTS "AuditExportRequest_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "AuditExportRequest_organizationId_version_idx";
DROP INDEX IF EXISTS "RepositoryConnection_organizationId_idx";
DROP INDEX IF EXISTS "GitHubAppInstallState_organizationId_idx";
DROP INDEX IF EXISTS "DocumentRequest_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "DocumentRequest_assessmentId_organizationId_documentType_status_crea_idx";
DROP INDEX IF EXISTS "DocumentRequest_assessmentId_organizationId_documentType_st_idx";
DROP INDEX IF EXISTS "ClassificationResult_assessmentId_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "ClassificationReviewRequest_organizationId_idempotencyKey_key";
DROP INDEX IF EXISTS "VerifiedProfile_organizationId_idempotencyKey_key";
DROP INDEX IF EXISTS "TargetedReanalysisRequest_organizationId_idempotencyKey_key";
DROP INDEX IF EXISTS "TargetedReanalysisRequest_organizationId_state_createdAt_idx";
DROP INDEX IF EXISTS "AssessmentRuntimeEvent_organizationId_createdAt_idx";

ALTER TABLE IF EXISTS "AuthSession" DROP CONSTRAINT IF EXISTS "AuthSession_organizationId_fkey";
ALTER TABLE IF EXISTS "AuthAuditEvent" DROP CONSTRAINT IF EXISTS "AuthAuditEvent_organizationId_fkey";
ALTER TABLE IF EXISTS "AuthDecisionLog" DROP CONSTRAINT IF EXISTS "AuthDecisionLog_organizationId_fkey";
ALTER TABLE IF EXISTS "Assessment" DROP CONSTRAINT IF EXISTS "Assessment_organizationId_fkey";
ALTER TABLE IF EXISTS "WizardProfile" DROP CONSTRAINT IF EXISTS "WizardProfile_organizationId_fkey";
ALTER TABLE IF EXISTS "ReadinessExport" DROP CONSTRAINT IF EXISTS "ReadinessExport_organizationId_fkey";
ALTER TABLE IF EXISTS "AuditExportRequest" DROP CONSTRAINT IF EXISTS "AuditExportRequest_organizationId_fkey";
ALTER TABLE IF EXISTS "RepositoryConnection" DROP CONSTRAINT IF EXISTS "RepositoryConnection_organizationId_fkey";
ALTER TABLE IF EXISTS "RepositorySnapshot" DROP CONSTRAINT IF EXISTS "RepositorySnapshot_organizationId_fkey";
ALTER TABLE IF EXISTS "RepositoryScanJob" DROP CONSTRAINT IF EXISTS "RepositoryScanJob_organizationId_fkey";
ALTER TABLE IF EXISTS "TargetedReanalysisRequest" DROP CONSTRAINT IF EXISTS "TargetedReanalysisRequest_organizationId_fkey";
ALTER TABLE IF EXISTS "TechnicalEvidenceReport" DROP CONSTRAINT IF EXISTS "TechnicalEvidenceReport_organizationId_fkey";
ALTER TABLE IF EXISTS "TechnicalProfile" DROP CONSTRAINT IF EXISTS "TechnicalProfile_organizationId_fkey";
ALTER TABLE IF EXISTS "AIUsageFlow" DROP CONSTRAINT IF EXISTS "AIUsageFlow_organizationId_fkey";
ALTER TABLE IF EXISTS "ConflictRecord" DROP CONSTRAINT IF EXISTS "ConflictRecord_organizationId_fkey";
ALTER TABLE IF EXISTS "AssessmentRuntimeEvent" DROP CONSTRAINT IF EXISTS "AssessmentRuntimeEvent_organizationId_fkey";
ALTER TABLE IF EXISTS "VerifiedProfile" DROP CONSTRAINT IF EXISTS "VerifiedProfile_organizationId_fkey";
ALTER TABLE IF EXISTS "ClassificationResult" DROP CONSTRAINT IF EXISTS "ClassificationResult_organizationId_fkey";
ALTER TABLE IF EXISTS "ClassificationReviewRequest" DROP CONSTRAINT IF EXISTS "ClassificationReviewRequest_organizationId_fkey";
ALTER TABLE IF EXISTS "DocumentRequest" DROP CONSTRAINT IF EXISTS "DocumentRequest_organizationId_fkey";
ALTER TABLE IF EXISTS "GitHubAppInstallState" DROP CONSTRAINT IF EXISTS "GitHubAppInstallState_organizationId_fkey";
ALTER TABLE IF EXISTS "LegalRuleMatch" DROP CONSTRAINT IF EXISTS "LegalRuleMatch_organizationId_fkey";

ALTER TABLE IF EXISTS "AuthSession" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "AuthAuditEvent" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "AuthDecisionLog" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "Assessment" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "WizardProfile" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "ReadinessExport" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "AuditExportRequest" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "RepositoryConnection" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "RepositorySnapshot" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "RepositoryScanJob" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "TargetedReanalysisRequest" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "TechnicalEvidenceReport" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "TechnicalProfile" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "AIUsageFlow" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "ConflictRecord" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "AssessmentRuntimeEvent" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "VerifiedProfile" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "ClassificationResult" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "ClassificationReviewRequest" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "DocumentRequest" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "GitHubAppInstallState" DROP COLUMN IF EXISTS "organizationId";
ALTER TABLE IF EXISTS "LegalRuleMatch" DROP COLUMN IF EXISTS "organizationId";

CREATE UNIQUE INDEX IF NOT EXISTS "TargetedReanalysisRequest_idempotencyKey_key"
ON "TargetedReanalysisRequest"("idempotencyKey");

UPDATE "AuthAuditEvent"
SET "resourceType" = NULL
WHERE "resourceType"::text IN ('AUTH_MEMBERSHIP', 'AUTH_ORGANIZATION');

UPDATE "AuthDecisionLog"
SET "resourceType" = 'WORKSPACE'
WHERE "resourceType"::text IN ('AUTH_MEMBERSHIP', 'AUTH_ORGANIZATION');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'AuditResourceType'
      AND e.enumlabel IN ('AUTH_MEMBERSHIP', 'AUTH_ORGANIZATION')
  ) THEN
    ALTER TYPE "AuditResourceType" RENAME TO "AuditResourceType_old";

    CREATE TYPE "AuditResourceType" AS ENUM (
      'AI_USAGE_FLOW',
      'ASSESSMENT',
      'ASSESSMENT_RECORD',
      'AUDIT_EXPORT_REQUEST',
      'AUTH_INVITATION',
      'AUTH_MFA_RECOVERY_CODE',
      'AUTH_SESSION',
      'CLASSIFICATION_REVIEW_REQUEST',
      'CLASSIFICATION_RESULT',
      'CONFLICT_RECORD',
      'DOCUMENT_REQUEST',
      'GITHUB_APP_INSTALL_STATE',
      'HTTP_ROUTE',
      'LEGAL_RULE',
      'LEGAL_RULE_CATALOG_VERSION',
      'LEGAL_RULE_MATCH',
      'OUTBOX',
      'READINESS_EXPORT',
      'REPOSITORY_CONNECTION',
      'REPOSITORY_SCAN_JOB',
      'REPOSITORY_SNAPSHOT',
      'TECHNICAL_EVIDENCE_REPORT',
      'TECHNICAL_PROFILE',
      'VERIFIED_PROFILE',
      'WORKER_TASK',
      'WORKSPACE',
      'WIZARD_PROFILE'
    );

    ALTER TABLE IF EXISTS "AuthAuditEvent"
      ALTER COLUMN "resourceType" TYPE "AuditResourceType"
      USING "resourceType"::text::"AuditResourceType";

    ALTER TABLE IF EXISTS "AuthDecisionLog"
      ALTER COLUMN "resourceType" TYPE "AuditResourceType"
      USING "resourceType"::text::"AuditResourceType";

    DROP TYPE "AuditResourceType_old";
  END IF;
END $$;

UPDATE "AuthDecisionLog"
SET "reasonCode" = 'RBAC_DENIED'
WHERE "reasonCode"::text IN (
  'AUTHZ_POLICY_UNAVAILABLE',
  'AUTHZ_SUBJECT_INCOMPLETE',
  'AUTHZ_TENANT_SCOPE_MISMATCH',
  'MEMBERSHIP_MISSING',
  'ORGANIZATION_MISMATCH',
  'POLICY_NOT_FOUND',
  'SUBJECT_ATTRIBUTE_MISSING'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'AuthorizationReasonCode'
      AND e.enumlabel IN (
        'AUTHZ_POLICY_UNAVAILABLE',
        'AUTHZ_SUBJECT_INCOMPLETE',
        'AUTHZ_TENANT_SCOPE_MISMATCH',
        'MEMBERSHIP_MISSING',
        'ORGANIZATION_MISMATCH',
        'POLICY_NOT_FOUND',
        'SUBJECT_ATTRIBUTE_MISSING'
      )
  ) THEN
    ALTER TYPE "AuthorizationReasonCode" RENAME TO "AuthorizationReasonCode_old";

    CREATE TYPE "AuthorizationReasonCode" AS ENUM (
      'ACTION_NOT_GRANTED',
      'ACCOUNT_NOT_FOUND',
      'AUTHORIZED',
      'AUTHZ_EVALUATOR_FAILURE',
      'AUTHZ_STATE_GATE_BLOCKED',
      'AUTH_REQUIRED',
      'EMAIL_VERIFICATION_REQUIRED',
      'EVALUATOR_ERROR',
      'INVALID_CREDENTIALS',
      'INVALID_INVITE_STATE',
      'INVALID_REDIRECT_URI',
      'LOAD_ERROR',
      'MFA_REQUIRED',
      'MFA_INVALID',
      'MFA_RATE_LIMITED',
      'OAUTH_CALLBACK_INVALID',
      'OAUTH_STATE_INVALID',
      'RBAC_DENIED',
      'RBAC_METADATA_MISSING',
      'REAUTH_REQUIRED',
      'RECOVERY_INVALID',
      'SESSION_INVALID',
      'STATE_GATE_FAILED',
      'SUBJECT_ROLE_MISMATCH',
      'TEMPORARY_LOCKED',
      'UNSUPPORTED_PROVIDER',
      'VALIDATION_FAILED'
    );

    ALTER TABLE IF EXISTS "AuthDecisionLog"
      ALTER COLUMN "reasonCode" TYPE "AuthorizationReasonCode"
      USING "reasonCode"::text::"AuthorizationReasonCode";

    DROP TYPE "AuthorizationReasonCode_old";
  END IF;
END $$;

DROP TABLE IF EXISTS "AuthMembership" CASCADE;
DROP TABLE IF EXISTS "AuthOrganization" CASCADE;
DROP TYPE IF EXISTS "AuthMembershipStatus";
