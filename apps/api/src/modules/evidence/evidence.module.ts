import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptTechnicalProfileHandler } from "./application/commands/accept-technical-profile/accept-technical-profile.handler.js";
import { CaptureVerifiedAgentEpisodeHandler } from "./application/commands/capture-verified-agent-episode/capture-verified-agent-episode.handler.js";
import { ConsolidateVerifiedAgentEpisodesHandler } from "./application/commands/consolidate-verified-agent-episodes/consolidate-verified-agent-episodes.handler.js";
import { GetEvidenceHandler } from "./application/queries/get-evidence/get-evidence.handler.js";
import { RetrieveVerifiedAgentEpisodesHandler } from "./application/queries/retrieve-verified-agent-episodes/retrieve-verified-agent-episodes.handler.js";
import { EvidenceRedactorService } from "./application/services/evidence/evidence-redactor.service.js";
import { VerifiedAgentEpisodeConsolidationWorker } from "./application/services/verified-agent-episode-consolidation.worker.js";
import { VerifiedAgentEpisodeDeduplicationService } from "./application/services/verified-agent-episode-deduplication.service.js";
import { InternalAgenticToolDispatchController } from "./presentation/http/agentic-tool-dispatch.controller.js";
import {
  EvidenceController,
  InternalEvidenceController,
} from "./presentation/http/evidence.controller.js";

/**
 * Nest evidence module owns persistence/read boundaries only. Program graph traversal,
 * data/decision analysis, provider discovery and remediation processing execute through
 * Managed Deep Agent tools and therefore are intentionally not registered as Nest CQRS handlers.
 */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [
    EvidenceController,
    InternalEvidenceController,
    InternalAgenticToolDispatchController,
  ],
  providers: [
    GetEvidenceHandler,
    AcceptTechnicalProfileHandler,
    CaptureVerifiedAgentEpisodeHandler,
    ConsolidateVerifiedAgentEpisodesHandler,
    RetrieveVerifiedAgentEpisodesHandler,
    EvidenceRedactorService,
    VerifiedAgentEpisodeDeduplicationService,
    VerifiedAgentEpisodeConsolidationWorker,
    WorkerApiKeyGuard,
    AssessmentRuntimeEventService,
  ],
})
export class EvidenceModule {}
