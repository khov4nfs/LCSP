import { VERIFIED_AGENT_EPISODE_RECORD_STATUSES } from "@lcsp/contracts/evidence";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

type EpisodeRow = {
  id: string;
  assessmentId: string;
  ownerAgent: string;
  domainKey: string;
  inputSignature: string;
  promptVersion: string;
  modelId: string;
  contentHash: string;
  createdAt: Date;
};

@Injectable()
export class VerifiedAgentEpisodeDeduplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async expireNearDuplicates(input: {
    assessmentId?: string;
    take?: number;
  }): Promise<{
    duplicateCount: number;
    canonicalCount: number;
    duplicateIds: string[];
    canonicalIds: string[];
  }> {
    const rows = await this.prisma.verifiedAgentEpisode.findMany({
      where: {
        assessmentId: input.assessmentId,
        status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: input.take ?? 500,
    });
    const duplicateIds = this.findDuplicateIds(rows);
    const canonicalIds = rows
      .map((row) => row.id)
      .filter((id) => !duplicateIds.includes(id));
    if (duplicateIds.length === 0) {
      return {
        duplicateCount: 0,
        canonicalCount: rows.length,
        duplicateIds: [],
        canonicalIds,
      };
    }
    const result = await this.prisma.verifiedAgentEpisode.updateMany({
      where: { id: { in: duplicateIds } },
      data: { status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.expired },
    });
    return {
      duplicateCount: result.count,
      canonicalCount: rows.length - result.count,
      duplicateIds,
      canonicalIds,
    };
  }

  private findDuplicateIds(rows: EpisodeRow[]): string[] {
    const duplicateIds = new Set<string>();
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      const canonical = rows[leftIndex];
      if (!canonical || duplicateIds.has(canonical.id)) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < rows.length;
        rightIndex += 1
      ) {
        const candidate = rows[rightIndex];
        if (!candidate || duplicateIds.has(candidate.id)) continue;
        if (!sameCluster(canonical, candidate)) continue;
        if (canonical.inputSignature === candidate.inputSignature) {
          duplicateIds.add(candidate.id);
        }
      }
    }
    return [...duplicateIds];
  }
}

function sameCluster(left: EpisodeRow, right: EpisodeRow): boolean {
  return (
    left.assessmentId === right.assessmentId &&
    left.ownerAgent === right.ownerAgent &&
    left.domainKey === right.domainKey &&
    left.promptVersion === right.promptVersion &&
    left.modelId === right.modelId &&
    left.contentHash !== right.contentHash
  );
}

export type VerifiedAgentEpisodeDeduplicationRow =
  Prisma.VerifiedAgentEpisodeGetPayload<{
    select: {
      id: true;
      assessmentId: true;
      ownerAgent: true;
      domainKey: true;
      inputSignature: true;
      promptVersion: true;
      modelId: true;
      contentHash: true;
      createdAt: true;
    };
  }>;
