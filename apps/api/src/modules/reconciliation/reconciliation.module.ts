import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PbacModule } from "../../platform/pbac/pbac.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictHandler } from "./application/commands/accept-conflict/accept-conflict.handler.js";
import { ApproveVerifiedProfileHandler } from "./application/commands/approve-verified-profile/approve-verified-profile.handler.js";
import { ResolveConflictHandler } from "./application/commands/resolve-conflict/resolve-conflict.handler.js";
import { ReconcileProfileToVerifiedProfileHandler } from "./application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.handler.js";
import { ListConflictsHandler } from "./application/queries/list-conflicts/list-conflicts.handler.js";
import { GetVerifiedProfileByIdHandler } from "./application/queries/get-verified-profile-by-id/get-verified-profile-by-id.handler.js";
import { GetVerifiedProfileHandler } from "./application/queries/get-verified-profile/get-verified-profile.handler.js";
import { GetArtifactChainHandler } from "./application/queries/get-artifact-chain/get-artifact-chain.handler.js";
import { GetAssessmentContextHandler } from "./application/queries/get-assessment-context/get-assessment-context.handler.js";
import { ListVerifiedProfilesHandler } from "./application/queries/list-verified-profiles/list-verified-profiles.handler.js";
import {
  COMPARE_WIZARD_CLAIM_CONTROLLERS,
  COMPARE_WIZARD_CLAIM_PROVIDERS,
} from "./compare-wizard-claim.registration.js";
import { GetReconciliationContextHandler } from "./application/queries/get-reconciliation-context/get-reconciliation-context.handler.js";
import { ProposeMissingTargetsHandler } from "./application/queries/propose-missing-targets/propose-missing-targets.handler.js";
import {
  InternalReconciliationController,
  ReconciliationController,
} from "./presentation/http/reconciliation.controller.js";

@Module({
  imports: [CqrsModule, PbacModule],
  controllers: [
    InternalReconciliationController,
    ReconciliationController,
    ...COMPARE_WIZARD_CLAIM_CONTROLLERS,
  ],
  providers: [
    AcceptConflictHandler,
    ApproveVerifiedProfileHandler,
    GetVerifiedProfileByIdHandler,
    GetVerifiedProfileHandler,
    GetArtifactChainHandler,
    GetAssessmentContextHandler,
    ...COMPARE_WIZARD_CLAIM_PROVIDERS,
    GetReconciliationContextHandler,
    ProposeMissingTargetsHandler,
    ListConflictsHandler,
    ListVerifiedProfilesHandler,
    ResolveConflictHandler,
    ReconcileProfileToVerifiedProfileHandler,
    WorkerApiKeyGuard,
  ],
})
export class ReconciliationModule {}
