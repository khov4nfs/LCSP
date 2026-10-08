import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { OutboxRepository } from "../../platform/outbox/outbox.repository.js";
import { AssessmentLifecycleCoordinator } from "../assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimePreparation } from "../assessment/application/services/assessment-runtime-preparation.service.js";
import { ArchiveLegacyDataHandler } from "./application/commands/archive-legacy-data/archive-legacy-data.handler.js";
import { BackfillLegacyAssessmentsHandler } from "./application/commands/backfill-legacy-assessments/backfill-legacy-assessments.handler.js";
import { QuiesceLegacyRuntimeHandler } from "./application/commands/quiesce-legacy-runtime/quiesce-legacy-runtime.handler.js";
import {
  CloseLegacyRestoreBoundaryHandler,
  RecordLegacyRestorePointHandler,
} from "./application/commands/record-legacy-restore-point/record-legacy-restore-point.handler.js";
import { PreflightLegacyMigrationHandler } from "./application/queries/preflight-legacy-migration/preflight-legacy-migration.handler.js";
import { ValidateLegacyMigrationHandler } from "./application/queries/validate-legacy-migration/validate-legacy-migration.handler.js";
import { LegacyMigrationRunner } from "./application/services/legacy-migration-runner.service.js";
import { LegacyReevaluationService } from "./application/services/legacy-reevaluation.service.js";
import { LegacyReportArchiver } from "./application/services/legacy-report-archiver.service.js";
import { LegacyArchiveRepository } from "./infrastructure/persistence/legacy-archive.repository.js";
import { LegacyReevaluationRepository } from "./infrastructure/persistence/legacy-reevaluation.repository.js";
import { LegacyValidationRepository } from "./infrastructure/persistence/legacy-validation.repository.js";
import { LegacyArchiveBlobStore } from "../legacy-archive/infrastructure/storage/legacy-archive-blob.store.js";

/**
 * Cutover tooling. It is only imported by the CLI context: it provides the plain OutboxRepository
 * and never `OutboxModule`, because the module's publisher would start delivering on init.
 */
@Module({
  imports: [CqrsModule],
  providers: [
    QuiesceLegacyRuntimeHandler,
    ArchiveLegacyDataHandler,
    BackfillLegacyAssessmentsHandler,
    RecordLegacyRestorePointHandler,
    CloseLegacyRestoreBoundaryHandler,
    PreflightLegacyMigrationHandler,
    ValidateLegacyMigrationHandler,
    LegacyArchiveRepository,
    LegacyValidationRepository,
    LegacyReevaluationRepository,
    LegacyArchiveBlobStore,
    LegacyReportArchiver,
    LegacyMigrationRunner,
    LegacyReevaluationService,
    OutboxRepository,
    AssessmentLifecycleCoordinator,
    AssessmentRuntimePreparation,
  ],
  exports: [
    LegacyMigrationRunner,
    LegacyReevaluationService,
    LegacyArchiveBlobStore,
  ],
})
export class LegacyMigrationModule {}
