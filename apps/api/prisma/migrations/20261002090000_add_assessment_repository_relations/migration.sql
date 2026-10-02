CREATE TYPE "AssessmentRepositoryRelationType" AS ENUM ('RUNTIME_API_INTERACTION', 'BUILD_PACKAGE_DEPENDENCY', 'DATA_EVENT_FLOW', 'SHARED_LIBRARY');

CREATE TABLE "AssessmentRepositoryRelation" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "fromSnapshotId" TEXT NOT NULL,
    "toSnapshotId" TEXT NOT NULL,
    "type" "AssessmentRepositoryRelationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentRepositoryRelation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssessmentRepositoryRelation_no_self_relation_check" CHECK ("fromSnapshotId" <> "toSnapshotId"),
    CONSTRAINT "AssessmentRepositoryRelation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentRepositoryRelation_fromSnapshotId_fkey" FOREIGN KEY ("fromSnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentRepositoryRelation_toSnapshotId_fkey" FOREIGN KEY ("toSnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssessmentRepositoryRelation_fromSnapshotId_toSnapshotId_type_key" ON "AssessmentRepositoryRelation"("fromSnapshotId", "toSnapshotId", "type");
CREATE INDEX "AssessmentRepositoryRelation_assessmentId_idx" ON "AssessmentRepositoryRelation"("assessmentId");
CREATE INDEX "AssessmentRepositoryRelation_toSnapshotId_idx" ON "AssessmentRepositoryRelation"("toSnapshotId");
