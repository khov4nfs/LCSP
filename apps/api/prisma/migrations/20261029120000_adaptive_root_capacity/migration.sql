CREATE TYPE "AssessmentRootCapacityReason" AS ENUM (
  'INITIAL', 'ADAPTIVE_DISABLED', 'EMERGENCY_DISABLED', 'SERVER_DRAINING', 'METRICS_STALE_OR_MISSING',
  'METRICS_INCONSISTENT', 'MEMORY_PRESSURE', 'DISK_PRESSURE', 'CPU_PRESSURE', 'DATABASE_PRESSURE',
  'CHECKPOINT_PRESSURE', 'PROVIDER_PRESSURE', 'BUDGET_ADMISSION_DENIED', 'PROVIDER_LIMIT_UNKNOWN',
  'PHYSICAL_CAPACITY', 'BACKLOG_HEADROOM', 'LOW_DEMAND', 'COOLDOWN_OR_HYSTERESIS', 'MANUAL_OVERRIDE',
  'GLOBAL_CAPACITY_FULL', 'OWNER_FAIRNESS', 'ASSESSMENT_ALREADY_ADMITTED', 'SERVER_INCARNATION_FENCED', 'SERVER_HOST_MISMATCH'
);
CREATE TABLE "AssessmentRootCapacity" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'ASSESSMENT_ROOT'),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "desired" INTEGER NOT NULL DEFAULT 2 CHECK ("desired" BETWEEN 0 AND 64),
  "effective" INTEGER NOT NULL DEFAULT 0 CHECK ("effective" BETWEEN 0 AND 64),
  "policy" JSONB NOT NULL,
  "reason" "AssessmentRootCapacityReason" NOT NULL,
  "healthySamples" INTEGER NOT NULL DEFAULT 0,
  "idleSamples" INTEGER NOT NULL DEFAULT 0,
  "lastScaleUpAt" TIMESTAMPTZ(3),
  "lastScaleDownAt" TIMESTAMPTZ(3),
  "evaluatedAt" TIMESTAMPTZ(3),
  "reportedAt" TIMESTAMPTZ(3),
  "hostId" TEXT,
  "incarnationId" UUID,
  "runtimeMetrics" JSONB,
  "databaseMetrics" JSONB,
  "admissionDeferrals" INTEGER NOT NULL DEFAULT 0,
  "recoveredSlots" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "AssessmentRootAdmissionRequest" (
  "commandId" TEXT NOT NULL PRIMARY KEY REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "assessmentId" TEXT NOT NULL REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "admittedRunId" UUID,
  "deliveredAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AssessmentRootAdmissionRequest_completedAt_admittedRunId_requestedAt_idx" ON "AssessmentRootAdmissionRequest"("completedAt", "admittedRunId", "requestedAt");
CREATE INDEX "AssessmentRootAdmissionRequest_assessmentId_requestedAt_idx" ON "AssessmentRootAdmissionRequest"("assessmentId", "requestedAt");
CREATE TABLE "AssessmentRootExecutionSlot" (
  "runId" UUID NOT NULL PRIMARY KEY,
  "assessmentId" TEXT NOT NULL REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  "incarnationId" UUID NOT NULL,
  "commandId" TEXT NOT NULL REFERENCES "AssessmentRootAdmissionRequest"("commandId") ON DELETE CASCADE ON UPDATE RESTRICT,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "startedAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  CHECK ("releasedAt" IS NULL OR "releasedAt" >= "admittedAt")
);
CREATE INDEX "AssessmentRootExecutionSlot_releasedAt_admittedAt_idx" ON "AssessmentRootExecutionSlot"("releasedAt", "admittedAt");
CREATE INDEX "AssessmentRootExecutionSlot_assessmentId_admittedAt_idx" ON "AssessmentRootExecutionSlot"("assessmentId", "admittedAt");
CREATE INDEX "AssessmentRootExecutionSlot_commandId_startedAt_idx" ON "AssessmentRootExecutionSlot"("commandId", "startedAt");
CREATE UNIQUE INDEX "AssessmentRootExecutionSlot_one_active_assessment" ON "AssessmentRootExecutionSlot"("assessmentId") WHERE "releasedAt" IS NULL;
CREATE TABLE "AssessmentRootCapacityDecision" (
  "id" UUID NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL UNIQUE,
  "previous" INTEGER NOT NULL CHECK ("previous" BETWEEN 0 AND 64),
  "desired" INTEGER NOT NULL CHECK ("desired" BETWEEN 0 AND 64),
  "effective" INTEGER NOT NULL CHECK ("effective" BETWEEN 0 AND 64),
  "reason" "AssessmentRootCapacityReason" NOT NULL,
  "actorId" TEXT,
  "operatorReason" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AssessmentRootCapacityDecision_createdAt_idx" ON "AssessmentRootCapacityDecision"("createdAt");
