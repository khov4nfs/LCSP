import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { AcceptClassificationHandler } from "./application/commands/accept-classification/accept-classification.handler.js";
import { AcceptLegalRuleMatchHandler } from "./application/commands/accept-legal-rule-match/accept-legal-rule-match.handler.js";
import { RerunClassificationHandler } from "./application/commands/rerun-classification/rerun-classification.handler.js";
import { SubmitClassificationReviewHandler } from "./application/commands/submit-classification-review/submit-classification-review.handler.js";
import { EvaluateGapMatrixHandler } from "./application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.js";
import { GetGapEvidenceTraceHandler } from "./application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.js";
import { GetClassificationBaselineHandler } from "./application/queries/get-classification-baseline/get-classification-baseline.handler.js";
import { ProposeGapRemediationHandler } from "./application/queries/propose-gap-remediation/propose-gap-remediation.handler.js";
import { ValidateClassificationProposalHandler } from "./application/queries/validate-classification-proposal/validate-classification-proposal.handler.js";
import { CitationGuardrailService } from "./application/services/classification/citation-guardrail.service.js";
import { OverclaimGuardrailService } from "./application/services/classification/overclaim-guardrail.service.js";
import {
  CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS,
  CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS,
} from "./classification-review-resolution.registration.js";
import { ClassificationController } from "./presentation/http/classification.controller.js";
import { AssessmentClassificationController } from "./presentation/http/assessment-classification.controller.js";
import { ClassificationBaselineController } from "./presentation/http/classification-baseline.controller.js";
import { ClassificationProposalValidationController } from "./presentation/http/classification-proposal-validation.controller.js";
import { ClassificationReviewSubmissionController } from "./presentation/http/classification-review-submission.controller.js";
import { ClassificationRuntimeController } from "./presentation/http/classification-runtime.controller.js";
import { GapMatrixEvaluationController } from "./presentation/http/gap-matrix-evaluation.controller.js";
import { GapEvidenceTraceController } from "./presentation/http/gap-evidence-trace.controller.js";
import { GapRemediationController } from "./presentation/http/gap-remediation.controller.js";
import {
  GAP_REQUIREMENTS_CONTROLLERS,
  GAP_REQUIREMENTS_PROVIDERS,
} from "./gap-requirements.registration.js";

@Module({
  imports: [CqrsModule],
  controllers: [
    ClassificationController,
    ClassificationRuntimeController,
    AssessmentClassificationController,
    ClassificationBaselineController,
    ClassificationProposalValidationController,
    ClassificationReviewSubmissionController,
    ...CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS,
    ...GAP_REQUIREMENTS_CONTROLLERS,
    GapMatrixEvaluationController,
    GapEvidenceTraceController,
    GapRemediationController,
  ],
  providers: [
    AcceptLegalRuleMatchHandler,
    AcceptClassificationHandler,
    RerunClassificationHandler,
    SubmitClassificationReviewHandler,
    ...CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS,
    EvaluateGapMatrixHandler,
    GetGapEvidenceTraceHandler,
    GetClassificationBaselineHandler,
    ...GAP_REQUIREMENTS_PROVIDERS,
    ProposeGapRemediationHandler,
    ValidateClassificationProposalHandler,
    CitationGuardrailService,
    OverclaimGuardrailService,
    AssessmentRuntimeEventService,
    WorkerApiKeyGuard,
  ],
})
export class ClassificationModule {}
