import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { ProcessScanCallbackHandler } from "./application/commands/process-scan-callback/process-scan-callback.handler.js";
import { GetScanJobHandler } from "./application/queries/get-scan-job/get-scan-job.handler.js";
import { EvidenceSchemaValidatorService } from "./application/services/scan/evidence-schema-validator.service.js";
import {
  InternalScanController,
  InternalTargetedReanalysisController,
  ScanController,
} from "./presentation/http/scan.controller.js";
import { WorkspaceRuntimeEventsController } from "./presentation/http/workspace-runtime-events.controller.js";
import { WorkerApiKeyGuard } from "./presentation/http/worker-api-key.guard.js";
import { RerunScanHandler } from "./application/commands/rerun-scan/rerun-scan.handler.js";
import { RequestTargetedReanalysisHandler } from "./application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";

/**
 * Wires scan-job reads/reruns, worker callbacks, targeted reanalysis, evidence validation, and workspace runtime-event streaming.
 */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [
    ScanController,
    InternalScanController,
    InternalTargetedReanalysisController,
    WorkspaceRuntimeEventsController,
  ],
  providers: [
    GetScanJobHandler,
    ProcessScanCallbackHandler,
    RerunScanHandler,
    RequestTargetedReanalysisHandler,
    EvidenceSchemaValidatorService,
    WorkerApiKeyGuard,
    AssessmentRuntimeEventService,
  ],
})
export class ScanModule {}
