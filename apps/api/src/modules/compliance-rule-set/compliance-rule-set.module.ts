import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { ComplianceRuleSetAdminController } from "./presentation/http/compliance-rule-set-admin.controller.js";
import { ListComplianceRuleSetHistoryHandler } from "./application/queries/list-compliance-rule-set-history/list-compliance-rule-set-history.handler.js";
import { ComplianceRuleSetHistoryLoader } from "./infrastructure/persistence/compliance-rule-set-history.loader.js";

import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { ClaimRuleSetPreparationHandler } from "./application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { FailRuleSetPreparationHandler } from "./application/commands/fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { RetryRuleSetPreparationHandler } from "./application/commands/retry-rule-set-preparation/retry-rule-set-preparation.handler.js";
import { StartRuleSetPreparationHandler } from "./application/commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { SubmitComplianceRuleSetHandler } from "./application/commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { GetActiveComplianceRuleSetHandler } from "./application/queries/get-active-compliance-rule-set/get-active-compliance-rule-set.handler.js";
import { GetComplianceRuleSetVersionHandler } from "./application/queries/get-compliance-rule-set-version/get-compliance-rule-set-version.handler.js";
import { ValidateComplianceRuleSetHandler } from "./application/queries/validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { LegalCorpusSnapshotLoader } from "./infrastructure/persistence/legal-corpus-snapshot.service.js";
import { ComplianceRuleSetActivation } from "./infrastructure/persistence/compliance-rule-set-activation.service.js";
import { ComplianceRuleSetReadModelLoader } from "./infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { LegalSourceActivatedConsumer } from "./infrastructure/messaging/legal-source-activated.consumer.js";
import { ComplianceRuleSetController } from "./presentation/http/compliance-rule-set.controller.js";

/**
 * Compliance rule set use cases: a validated Legal Source Version activation automatically starts
 * one Rule Set Preparation, whose valid result becomes the shared ACTIVE rule set. Other modules
 * reach it only through its queries (e.g. GetComplianceRuleSetVersionQuery), never its internals.
 */
@Module({
  imports: [CqrsModule, OutboxModule, RbacModule],
  controllers: [ComplianceRuleSetController, ComplianceRuleSetAdminController],
  providers: [
    LegalCorpusSnapshotLoader,
    ListComplianceRuleSetHistoryHandler,
    ComplianceRuleSetHistoryLoader,
    ComplianceRuleSetActivation,
    ComplianceRuleSetReadModelLoader,
    StartRuleSetPreparationHandler,
    RetryRuleSetPreparationHandler,
    LegalSourceActivatedConsumer,
    ClaimRuleSetPreparationHandler,
    FailRuleSetPreparationHandler,
    SubmitComplianceRuleSetHandler,
    ValidateComplianceRuleSetHandler,
    GetActiveComplianceRuleSetHandler,
    GetComplianceRuleSetVersionHandler,
  ],
})
export class ComplianceRuleSetModule {}
