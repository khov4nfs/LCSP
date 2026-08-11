import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptClassificationHandler } from "./application/commands/accept-classification/accept-classification.handler.js";
import { AcceptLegalRuleMatchHandler } from "./application/commands/accept-legal-rule-match/accept-legal-rule-match.handler.js";
import { RerunClassificationHandler } from "./application/commands/rerun-classification/rerun-classification.handler.js";
import { CitationGuardrailService } from "./application/services/classification/citation-guardrail.service.js";
import { OverclaimGuardrailService } from "./application/services/classification/overclaim-guardrail.service.js";
import { ClassificationController } from "./presentation/http/classification.controller.js";
import { AssessmentClassificationController } from "./presentation/http/assessment-classification.controller.js";
import { ClassificationRuntimeController } from "./presentation/http/classification-runtime.controller.js";

@Module({
  imports: [CqrsModule],
  controllers: [
    ClassificationController,
    ClassificationRuntimeController,
    AssessmentClassificationController,
  ],
  providers: [
    AcceptLegalRuleMatchHandler,
    AcceptClassificationHandler,
    RerunClassificationHandler,
    CitationGuardrailService,
    OverclaimGuardrailService,
    WorkerApiKeyGuard,
  ],
})
export class ClassificationModule {}
