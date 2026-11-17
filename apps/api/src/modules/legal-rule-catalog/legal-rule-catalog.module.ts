import { Module } from "@nestjs/common";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { CqrsModule } from "@nestjs/cqrs";
import { LegalRuleCatalogService } from "./application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "./application/services/preparation-rule.service.js";
import {
  LegalRuleCatalogController,
  PreparationRuleWorkerController,
} from "./presentation/http/legal-rule-catalog.controller.js";

@Module({
  imports: [RbacModule, OutboxModule, CqrsModule],
  controllers: [LegalRuleCatalogController, PreparationRuleWorkerController],
  providers: [LegalRuleCatalogService, PreparationRuleService],
})
export class LegalRuleCatalogModule {}
