import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { LegalRuleCatalogController } from "./presentation/http/legal-rule-catalog.controller.js";
import { GetActiveLegalCorpusHandler } from "./application/queries/get-active-legal-corpus/get-active-legal-corpus.handler.js";
import { CitationLocatorValidatorService } from "./application/services/citation-locator-validator.service.js";
import { LegalCorpusService } from "./application/services/legal-corpus.service.js";
import { OfficialSourceSnapshotService } from "./application/services/official-source-snapshot.service.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";

const Handlers = [GetActiveLegalCorpusHandler];

@Module({
  imports: [CqrsModule, OutboxModule],
  controllers: [LegalRuleCatalogController],
  providers: [
    ...Handlers,
    CitationLocatorValidatorService,
    LegalCorpusService,
    OfficialSourceSnapshotService,
  ],
})
export class LegalRuleCatalogModule {}
