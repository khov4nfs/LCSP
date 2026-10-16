import { Module } from "@nestjs/common";
import { LegalDocumentGraphService } from "./application/services/legal-document-graph.service.js";
import { LegalDocumentGraphController } from "./presentation/http/legal-document-graph.controller.js";
import { CqrsModule } from "@nestjs/cqrs";

import { LegalLibraryController } from "./presentation/http/legal-library.controller.js";
import { LegalSourceAdminController } from "./presentation/http/legal-source-admin.controller.js";
import { LegalSourceController } from "./presentation/http/legal-source.controller.js";
import { LegalSourceIngestionController } from "./presentation/http/legal-source-ingestion.controller.js";
import { GetActiveLegalSourceHandler } from "./application/queries/get-active-legal-source/get-active-legal-source.handler.js";
import { CitationLocatorValidatorService } from "./application/services/citation-locator-validator.service.js";
import { LegalSourceDocumentService } from "./application/services/legal-source-document.service.js";
import { LegalSourceManagementService } from "./application/services/legal-source-management.service.js";
import { LegalSourceService } from "./application/services/legal-source.service.js";
import { OfficialSourceSnapshotService } from "./application/services/official-source-snapshot.service.js";
import {
  NodeSafeFetchTransport,
  SafeUrlFetcherService,
} from "./application/services/safe-url-fetcher.service.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";

const Handlers = [GetActiveLegalSourceHandler];

@Module({
  imports: [CqrsModule, OutboxModule],
  controllers: [
    LegalDocumentGraphController,
    LegalSourceController,
    LegalSourceAdminController,
    LegalLibraryController,
    LegalSourceIngestionController,
  ],
  providers: [
    LegalDocumentGraphService,
    ...Handlers,
    CitationLocatorValidatorService,
    LegalSourceService,
    LegalSourceDocumentService,
    LegalSourceManagementService,
    NodeSafeFetchTransport,
    OfficialSourceSnapshotService,
    SafeUrlFetcherService,
  ],
  exports: [LegalDocumentGraphService],
})
export class LegalSourceModule {}
