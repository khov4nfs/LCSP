import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PbacModule } from "../../platform/pbac/pbac.module.js";
import { ProcessScanCallbackHandler } from "./application/commands/process-scan-callback/process-scan-callback.handler.js";
import { GetScanJobHandler } from "./application/queries/get-scan-job/get-scan-job.handler.js";
import { EvidenceSchemaValidatorService } from "./application/services/scan/evidence-schema-validator.service.js";
import {
  InternalScanController,
  ScanController,
} from "./presentation/http/scan.controller.js";
import { WorkspaceRuntimeEventsController } from "./presentation/http/workspace-runtime-events.controller.js";
import { WorkerApiKeyGuard } from "./presentation/http/worker-api-key.guard.js";
import { RerunScanHandler } from "./application/commands/rerun-scan/rerun-scan.handler.js";

@Module({
  imports: [CqrsModule, PbacModule],
  controllers: [
    ScanController,
    InternalScanController,
    WorkspaceRuntimeEventsController,
  ],
  providers: [
    GetScanJobHandler,
    ProcessScanCallbackHandler,
    RerunScanHandler,
    EvidenceSchemaValidatorService,
    WorkerApiKeyGuard,
  ],
})
export class ScanModule {}
