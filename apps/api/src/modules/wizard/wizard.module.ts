import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PbacModule } from "../../platform/pbac/pbac.module.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { WIZARD_PROFILE_REPOSITORY } from "./application/ports/persistence/wizard-profile.repository.js";
import { PrismaWizardRepository } from "./infrastructure/persistence/prisma-wizard.repository.js";
import { SaveWizardDraftHandler } from "./application/commands/save-wizard-draft/save-wizard-draft.handler.js";
import { SubmitWizardHandler } from "./application/commands/submit-wizard/submit-wizard.handler.js";
import { GenerateReadinessExportHandler } from "./application/commands/generate-readiness-export/generate-readiness-export.handler.js";
import { GetReadinessHandler } from "./application/queries/get-readiness/get-readiness.handler.js";
import { DownloadReadinessExportHandler } from "./application/queries/download-readiness-export/download-readiness-export.handler.js";
import { WizardValidatorService } from "./application/services/wizard/wizard-validator.service.js";
import { ReadinessEvaluatorService } from "./application/services/wizard/readiness-evaluator.service.js";
import { ReadinessExportGuardrailService } from "./application/services/wizard/readiness-export-guardrail.service.js";
import { ReadinessExportPdfService } from "./application/services/wizard/readiness-export-pdf.service.js";
import { ReadinessExportDocumentService } from "./application/services/wizard/readiness-export-document.service.js";
import { WizardController } from "./presentation/http/wizard.controller.js";
import { InternalWizardController } from "./presentation/http/internal-wizard.controller.js";
import { ReadinessExportDocumentController } from "./presentation/http/readiness-export-document.controller.js";

@Module({
  imports: [CqrsModule, PbacModule, OutboxModule],
  controllers: [
    WizardController,
    InternalWizardController,
    ReadinessExportDocumentController,
  ],
  providers: [
    SaveWizardDraftHandler,
    SubmitWizardHandler,
    GenerateReadinessExportHandler,
    GetReadinessHandler,
    DownloadReadinessExportHandler,
    WizardValidatorService,
    ReadinessEvaluatorService,
    ReadinessExportGuardrailService,
    ReadinessExportPdfService,
    ReadinessExportDocumentService,
    PrismaWizardRepository,
    WorkerApiKeyGuard,
    {
      provide: WIZARD_PROFILE_REPOSITORY,
      useExisting: PrismaWizardRepository,
    },
  ],
})
export class WizardModule {}
