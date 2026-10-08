import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { LegalPortfolioAdminController } from "./presentation/http/legal-portfolio-admin.controller.js";
import { ListLegalPortfolioHistoryHandler } from "./application/queries/list-legal-portfolio-history/list-legal-portfolio-history.handler.js";
import { LegalPortfolioHistoryLoader } from "./infrastructure/persistence/legal-portfolio-history.loader.js";

import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { ClaimLegalPreparationHandler } from "./application/commands/claim-legal-preparation/claim-legal-preparation.handler.js";
import { FailLegalPreparationHandler } from "./application/commands/fail-legal-preparation/fail-legal-preparation.handler.js";
import { StartLegalPreparationHandler } from "./application/commands/start-legal-preparation/start-legal-preparation.handler.js";
import { SubmitLegalPortfolioHandler } from "./application/commands/submit-legal-portfolio/submit-legal-portfolio.handler.js";
import { GetActiveLegalPortfolioHandler } from "./application/queries/get-active-legal-portfolio/get-active-legal-portfolio.handler.js";
import { GetLegalPortfolioVersionHandler } from "./application/queries/get-legal-portfolio-version/get-legal-portfolio-version.handler.js";
import { ValidateLegalPortfolioHandler } from "./application/queries/validate-legal-portfolio/validate-legal-portfolio.handler.js";
import { LegalCorpusSnapshotLoader } from "./infrastructure/persistence/legal-corpus-snapshot.service.js";
import { LegalPortfolioActivation } from "./infrastructure/persistence/legal-portfolio-activation.service.js";
import { LegalPortfolioReadModelLoader } from "./infrastructure/persistence/legal-portfolio-read-model.service.js";
import { LegalPortfolioController } from "./presentation/http/legal-portfolio.controller.js";

/**
 * Legal portfolio use cases. Other modules reach it only through its queries
 * (e.g. GetLegalPortfolioVersionQuery), never its internals.
 */
@Module({
  imports: [CqrsModule, OutboxModule, RbacModule],
  controllers: [LegalPortfolioController, LegalPortfolioAdminController],
  providers: [
    LegalCorpusSnapshotLoader,
    ListLegalPortfolioHistoryHandler,
    LegalPortfolioHistoryLoader,
    LegalPortfolioActivation,
    LegalPortfolioReadModelLoader,
    StartLegalPreparationHandler,
    ClaimLegalPreparationHandler,
    FailLegalPreparationHandler,
    SubmitLegalPortfolioHandler,
    ValidateLegalPortfolioHandler,
    GetActiveLegalPortfolioHandler,
    GetLegalPortfolioVersionHandler,
  ],
})
export class LegalPortfolioModule {}
