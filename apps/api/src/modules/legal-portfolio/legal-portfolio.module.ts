import { Module } from "@nestjs/common";

import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { LegalPortfolioService } from "./application/services/legal-portfolio.service.js";
import { LegalPortfolioController } from "./presentation/http/legal-portfolio.controller.js";

@Module({
  imports: [OutboxModule],
  controllers: [LegalPortfolioController],
  providers: [LegalPortfolioService],
  exports: [LegalPortfolioService],
})
export class LegalPortfolioModule {}
