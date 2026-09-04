import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { ExportAuditTrailHandler } from "./application/commands/export-audit-trail/export-audit-trail.handler.js";
import { GetAuditExportArtifactHandler } from "./application/queries/get-audit-export-artifact/get-audit-export-artifact.handler.js";
import { GetAuditExportHandler } from "./application/queries/get-audit-export/get-audit-export.handler.js";
import { GetInterviewAuditTrailHandler } from "./application/queries/get-interview-audit-trail/get-interview-audit-trail.handler.js";
import { ListAuditEventsHandler } from "./application/queries/list-audit-events/list-audit-events.handler.js";
import { AuditRedactorService } from "./application/services/audit/audit-redactor.service.js";
import { InterviewAuditService } from "./application/services/interview-audit.service.js";
import { AuditExportStorageService } from "./infrastructure/storage/audit-export-storage.service.js";
import { AuditController } from "./presentation/http/audit.controller.js";

/**
 * Wires RBAC-protected audit browsing, export flows, and Interview Agent audit/provenance services.
 */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [AuditController],
  providers: [
    ExportAuditTrailHandler,
    GetAuditExportArtifactHandler,
    GetAuditExportHandler,
    GetInterviewAuditTrailHandler,
    ListAuditEventsHandler,
    AuditExportStorageService,
    AuditRedactorService,
    InterviewAuditService,
  ],
  exports: [InterviewAuditService, AuditRedactorService],
})
export class AuditModule {}
