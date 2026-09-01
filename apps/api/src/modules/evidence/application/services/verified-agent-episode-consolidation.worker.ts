import { VERIFIED_AGENT_EPISODE_RECORD_STATUSES } from "@lcsp/contracts/evidence";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { VerifiedAgentEpisodeDeduplicationService } from "./verified-agent-episode-deduplication.service.js";

@Injectable()
export class VerifiedAgentEpisodeConsolidationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    VerifiedAgentEpisodeConsolidationWorker.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly deduplicationService: VerifiedAgentEpisodeDeduplicationService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.intervalMs();
    if (intervalMs === null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.consolidateExpiredEpisodes();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async consolidateExpiredEpisodes(): Promise<{
    expiredCount: number;
    duplicateCount: number;
    expiredEpisodeIds: string[];
  }> {
    if (this.running) {
      return { expiredCount: 0, duplicateCount: 0, expiredEpisodeIds: [] };
    }
    this.running = true;
    try {
      const ttlExpiredRows = await this.prisma.verifiedAgentEpisode.findMany({
        where: {
          status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
          expiresAt: { not: null, lte: new Date() },
        },
        select: { id: true },
      });
      const result = await this.prisma.verifiedAgentEpisode.updateMany({
        where: {
          status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
          expiresAt: { not: null, lte: new Date() },
        },
        data: { status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.expired },
      });
      const deduplication =
        await this.deduplicationService.expireNearDuplicates({});
      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} verified agent episodes.`);
      }
      return {
        expiredCount: result.count,
        duplicateCount: deduplication.duplicateCount,
        expiredEpisodeIds: [
          ...ttlExpiredRows.map((row) => row.id),
          ...deduplication.duplicateIds,
        ],
      };
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number | null {
    const configured = this.configService.get<number>(
      "verifiedEpisodes.consolidationIntervalMs",
      0,
    );
    return Number.isInteger(configured) && configured > 0 ? configured : null;
  }
}
