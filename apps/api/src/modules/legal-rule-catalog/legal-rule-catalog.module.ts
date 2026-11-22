import { Module } from "@nestjs/common";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { CqrsModule } from "@nestjs/cqrs";
import { ComplianceRuleSetModule } from "../compliance-rule-set/compliance-rule-set.module.js";
import { LegalSourceModule } from "../legal-source/legal-source.module.js";
import { LegalRuleCatalogService } from "./application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "./application/services/preparation-rule.service.js";
import {
  LegalRuleCatalogController,
  PreparationRuleWorkerController,
} from "./presentation/http/legal-rule-catalog.controller.js";

@Module({
  // Use the same graph provider and revision ownership as other legal-source readers.
  imports: [
    RbacModule,
    OutboxModule,
    CqrsModule,
    ComplianceRuleSetModule,
    LegalSourceModule,
  ],
  controllers: [LegalRuleCatalogController, PreparationRuleWorkerController],
  providers: [LegalRuleCatalogService, PreparationRuleService],
})
export class LegalRuleCatalogModule {}
