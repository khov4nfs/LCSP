import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PbacModule } from "../../platform/pbac/pbac.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictHandler } from "./application/commands/accept-conflict/accept-conflict.handler.js";
import { AcceptVerifiedProfileHandler } from "./application/commands/accept-verified-profile/accept-verified-profile.handler.js";
import { ApproveVerifiedProfileHandler } from "./application/commands/approve-verified-profile/approve-verified-profile.handler.js";
import { ResolveConflictHandler } from "./application/commands/resolve-conflict/resolve-conflict.handler.js";
import { ListConflictsHandler } from "./application/queries/list-conflicts/list-conflicts.handler.js";
import { GetVerifiedProfileByIdHandler } from "./application/queries/get-verified-profile-by-id/get-verified-profile-by-id.handler.js";
import { GetArtifactChainHandler } from "./application/queries/get-artifact-chain/get-artifact-chain.handler.js";
import { GetReconciliationContextHandler } from "./application/queries/get-reconciliation-context/get-reconciliation-context.handler.js";
import {
  InternalReconciliationController,
  ReconciliationController,
} from "./presentation/http/reconciliation.controller.js";

@Module({
  imports: [CqrsModule, PbacModule],
  controllers: [InternalReconciliationController, ReconciliationController],
  providers: [
    AcceptConflictHandler,
    AcceptVerifiedProfileHandler,
    ApproveVerifiedProfileHandler,
    GetVerifiedProfileByIdHandler,
    GetArtifactChainHandler,
    GetReconciliationContextHandler,
    ListConflictsHandler,
    ResolveConflictHandler,
    WorkerApiKeyGuard,
  ],
})
export class ReconciliationModule {}
