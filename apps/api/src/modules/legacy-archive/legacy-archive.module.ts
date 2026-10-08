import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { DownloadLegacyArchiveReportHandler } from "./application/queries/download-legacy-archive-report/download-legacy-archive-report.handler.js";
import { GetLegacyArchiveHandler } from "./application/queries/get-legacy-archive/get-legacy-archive.handler.js";
import { ListLegacyArchivesHandler } from "./application/queries/list-legacy-archives/list-legacy-archives.handler.js";
import { LegacyArchiveReadRepository } from "./infrastructure/persistence/legacy-archive-read.repository.js";
import { LegacyArchiveBlobStore } from "./infrastructure/storage/legacy-archive-blob.store.js";
import { LegacyArchiveController } from "./presentation/http/legacy-archive.controller.js";

/** Customer retrieval of archived V1 assessments, reports and their availability. Read-only. */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [LegacyArchiveController],
  providers: [
    ListLegacyArchivesHandler,
    GetLegacyArchiveHandler,
    DownloadLegacyArchiveReportHandler,
    LegacyArchiveReadRepository,
    LegacyArchiveBlobStore,
  ],
})
export class LegacyArchiveModule {}
