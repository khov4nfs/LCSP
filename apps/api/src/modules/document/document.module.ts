import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PbacModule } from "../../platform/pbac/pbac.module.js";
import { RequestFinalReportHandler } from "./application/commands/request-final-report/request-final-report.handler.js";
import { RequestGapAnalysisHandler } from "./application/commands/request-gap-analysis/request-gap-analysis.handler.js";
import { ProcessDocumentCallbackHandler } from "./application/commands/process-document-callback/process-document-callback.handler.js";
import { GetDocumentGenerationContextHandler } from "./application/queries/get-document-generation-context/get-document-generation-context.handler.js";
import { GetDocumentHandler } from "./application/queries/get-document/get-document.handler.js";
import { ListDocumentsHandler } from "./application/queries/list-documents/list-documents.handler.js";
import { DocumentStorageService } from "./infrastructure/storage/document-storage.service.js";
import { DocumentController } from "./presentation/http/document.controller.js";
import { InternalDocumentController } from "./presentation/http/internal-document.controller.js";

/**
 * Wires document generation, worker callbacks, PBAC-filtered reads, and signed artifact downloads.
 */
@Module({
  imports: [CqrsModule, PbacModule],
  controllers: [DocumentController, InternalDocumentController],
  providers: [
    RequestFinalReportHandler,
    RequestGapAnalysisHandler,
    ProcessDocumentCallbackHandler,
    GetDocumentGenerationContextHandler,
    GetDocumentHandler,
    ListDocumentsHandler,
    DocumentStorageService,
  ],
})
export class DocumentModule {}
