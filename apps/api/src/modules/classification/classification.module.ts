import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { AcceptClassificationHandler } from "./application/commands/accept-classification/accept-classification.handler.js";
import { RerunClassificationHandler } from "./application/commands/rerun-classification/rerun-classification.handler.js";
import { EvaluateGapMatrixHandler } from "./application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.js";
import { GetGapEvidenceTraceHandler } from "./application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.js";
import { OverclaimGuardrailService } from "./application/services/classification/overclaim-guardrail.service.js";
import { GAP_REQUIREMENTS_PROVIDERS } from "./gap-requirements.registration.js";

@Module({
  imports: [CqrsModule],
  controllers: [],
  providers: [
    AcceptClassificationHandler,
    RerunClassificationHandler,
    EvaluateGapMatrixHandler,
    GetGapEvidenceTraceHandler,
    ...GAP_REQUIREMENTS_PROVIDERS,
    OverclaimGuardrailService,
    AssessmentRuntimeEventService,
    WorkerApiKeyGuard,
  ],
})
export class ClassificationModule {}
