import {
  AGENTIC_TOOL_STATUSES,
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
} from "@lcsp/contracts/evidence";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { VerifiedAgentEpisodeDeduplicationService } from "../../services/verified-agent-episode-deduplication.service.js";
import { ConsolidateVerifiedAgentEpisodesCommand } from "./consolidate-verified-agent-episodes.command.js";

@CommandHandler(ConsolidateVerifiedAgentEpisodesCommand)
export class ConsolidateVerifiedAgentEpisodesHandler implements ICommandHandler<ConsolidateVerifiedAgentEpisodesCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deduplicationService: VerifiedAgentEpisodeDeduplicationService,
  ) {}

  async execute(command: ConsolidateVerifiedAgentEpisodesCommand) {
    const ttlExpiredRows = await this.prisma.verifiedAgentEpisode.findMany({
      where: {
        assessmentId: command.assessmentId,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        expiresAt: { not: null, lte: new Date() },
      },
      select: { id: true },
    });
    const expired = await this.prisma.verifiedAgentEpisode.updateMany({
      where: {
        assessmentId: command.assessmentId,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        expiresAt: { not: null, lte: new Date() },
      },
      data: { status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.expired },
    });
    const deduplication = await this.deduplicationService.expireNearDuplicates({
      assessmentId: command.assessmentId,
    });

    const active = await this.prisma.verifiedAgentEpisode.count({
      where: {
        assessmentId: command.assessmentId,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
      },
    });
    const activeRows = await this.prisma.verifiedAgentEpisode.findMany({
      where: {
        assessmentId: command.assessmentId,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
      },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 500,
    });

    return {
      status: AGENTIC_TOOL_STATUSES.ready,
      expiredCount: expired.count,
      duplicateCount: deduplication.duplicateCount,
      activeCount: active,
      expiredEpisodeIds: [
        ...ttlExpiredRows.map((row) => row.id),
        ...deduplication.duplicateIds,
      ],
      activeEpisodeIds: activeRows.map((row) => row.id),
      canonicalEpisodeIds: deduplication.canonicalIds,
    };
  }
}
