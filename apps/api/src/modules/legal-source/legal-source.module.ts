import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { LegalSourceController } from "./presentation/http/legal-source.controller.js";
import { GetActiveLegalSourceHandler } from "./application/queries/get-active-legal-source/get-active-legal-source.handler.js";
import { CitationLocatorValidatorService } from "./application/services/citation-locator-validator.service.js";
import { LegalSourceService } from "./application/services/legal-source.service.js";
import { OfficialSourceSnapshotService } from "./application/services/official-source-snapshot.service.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";

const Handlers = [GetActiveLegalSourceHandler];

@Module({
  imports: [CqrsModule, OutboxModule],
  controllers: [LegalSourceController],
  providers: [
    ...Handlers,
    CitationLocatorValidatorService,
    LegalSourceService,
    OfficialSourceSnapshotService,
  ],
})
export class LegalSourceModule {}
