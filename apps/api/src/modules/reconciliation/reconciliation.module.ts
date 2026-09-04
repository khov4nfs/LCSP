import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictHandler } from "./application/commands/accept-conflict/accept-conflict.handler.js";
import { ResolveConflictHandler } from "./application/commands/resolve-conflict/resolve-conflict.handler.js";
import { ListConflictsHandler } from "./application/queries/list-conflicts/list-conflicts.handler.js";
import { GetArtifactChainHandler } from "./application/queries/get-artifact-chain/get-artifact-chain.handler.js";
import { GetReconciliationContextHandler } from "./application/queries/get-reconciliation-context/get-reconciliation-context.handler.js";
import { ProposeMissingTargetsHandler } from "./application/queries/propose-missing-targets/propose-missing-targets.handler.js";
import {
  InternalReconciliationController,
  ReconciliationController,
} from "./presentation/http/reconciliation.controller.js";

@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [InternalReconciliationController, ReconciliationController],
  providers: [
    AcceptConflictHandler,
    GetArtifactChainHandler,
    GetReconciliationContextHandler,
    ProposeMissingTargetsHandler,
    ListConflictsHandler,
    ResolveConflictHandler,
    WorkerApiKeyGuard,
  ],
})
export class ReconciliationModule {}
