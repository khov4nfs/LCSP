import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { LegalRuleCatalogController } from "./presentation/http/legal-rule-catalog.controller.js";
import { AdminCorpusVersionsController } from "./presentation/http/admin-corpus-versions.controller.js";
import { ResumeWaitingRunsHandler } from "./application/commands/resume-waiting-runs/resume-waiting-runs.handler.js";
import { GetAdminSourceCatalogHandler } from "./application/queries/get-admin-source-catalog/get-admin-source-catalog.handler.js";
import { GetActiveLegalCorpusHandler } from "./application/queries/get-active-legal-corpus/get-active-legal-corpus.handler.js";
import { GetLegalCorpusReadinessHandler } from "./application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.handler.js";
import { RetrieveLegalBasisHandler } from "./application/queries/retrieve-legal-basis/retrieve-legal-basis.handler.js";
import { ValidateCitationSetHandler } from "./application/queries/validate-citation-set/validate-citation-set.handler.js";
import { AdminSourceCatalogService } from "./application/services/admin-source-catalog.service.js";
import { AdminCorpusVersionsService } from "./application/services/admin-corpus-versions.service.js";
import { CitationLocatorValidatorService } from "./application/services/citation-locator-validator.service.js";
import { LegalCorpusService } from "./application/services/legal-corpus.service.js";
import { OfficialSourceSnapshotService } from "./application/services/official-source-snapshot.service.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";

const Handlers = [
  ResumeWaitingRunsHandler,
  GetAdminSourceCatalogHandler,
  GetActiveLegalCorpusHandler,
  GetLegalCorpusReadinessHandler,
  RetrieveLegalBasisHandler,
  ValidateCitationSetHandler,
];

@Module({
  imports: [CqrsModule, OutboxModule],
  controllers: [LegalRuleCatalogController, AdminCorpusVersionsController],
  providers: [
    ...Handlers,
    AdminSourceCatalogService,
    AdminCorpusVersionsService,
    CitationLocatorValidatorService,
    LegalCorpusService,
    OfficialSourceSnapshotService,
  ],
})
export class LegalRuleCatalogModule {}
