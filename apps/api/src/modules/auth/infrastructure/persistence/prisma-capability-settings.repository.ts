import { TOOL_ACCESS_MODES, type ToolAccessMode } from "@lcsp/contracts/auth";
import { Injectable } from "@nestjs/common";
import { ToolAccessMode as PrismaToolAccessMode } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  CapabilitySettingsRecord,
  CapabilitySettingsRepository,
  CapabilitySettingsUpdate,
} from "../../application/ports/persistence/capability-settings.repository.ts";

/**
 * Maps Prisma ToolAccessMode enum values to canonical contract constants at the persistence boundary.
 */
function toContractToolAccessMode(mode: PrismaToolAccessMode): ToolAccessMode {
  switch (mode) {
    case PrismaToolAccessMode.GUIDED:
      return TOOL_ACCESS_MODES.guided;
    case PrismaToolAccessMode.LOAD_WHEN_NEEDED:
      return TOOL_ACCESS_MODES.loadWhenNeeded;
  }
}

/**
 * Maps canonical contract ToolAccessMode constants to Prisma enum values at the persistence boundary.
 */
function toPrismaToolAccessMode(mode: ToolAccessMode): PrismaToolAccessMode {
  switch (mode) {
    case TOOL_ACCESS_MODES.guided:
      return PrismaToolAccessMode.GUIDED;
    case TOOL_ACCESS_MODES.loadWhenNeeded:
      return PrismaToolAccessMode.LOAD_WHEN_NEEDED;
  }
}

/**
 * Prisma-backed implementation of CapabilitySettingsRepository.
 *
 * Rationale (Why): Encapsulates relational persistence for capability settings and translates Prisma enums at the boundary.
 * Mechanism (How): Uses PrismaService to perform user-scoped lookups and atomic upserts on CapabilitySetting.
 * Invariants (What): Every query and mutation is keyed by userId to prevent BOLA/IDOR.
 */
@Injectable()
export class PrismaCapabilitySettingsRepository implements CapabilitySettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find capability settings record for a given user ID.
   */
  async findByUserId(userId: string): Promise<CapabilitySettingsRecord | null> {
    const row = await this.prisma.capabilitySetting.findUnique({
      where: { userId },
    });
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      toolAccessMode: toContractToolAccessMode(row.toolAccessMode),
      connectorSearch: row.connectorSearch,
      artifactsEnabled: row.artifactsEnabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Atomically create or update capability settings for a user.
   */
  async upsert(
    userId: string,
    update: CapabilitySettingsUpdate,
  ): Promise<CapabilitySettingsRecord> {
    const row = await this.prisma.capabilitySetting.upsert({
      where: { userId },
      create: {
        userId,
        toolAccessMode: update.toolAccessMode
          ? toPrismaToolAccessMode(update.toolAccessMode)
          : PrismaToolAccessMode.LOAD_WHEN_NEEDED,
        connectorSearch: update.connectorSearch ?? true,
        artifactsEnabled: update.artifactsEnabled ?? true,
      },
      update: {
        ...(update.toolAccessMode !== undefined && {
          toolAccessMode: toPrismaToolAccessMode(update.toolAccessMode),
        }),
        ...(update.connectorSearch !== undefined && {
          connectorSearch: update.connectorSearch,
        }),
        ...(update.artifactsEnabled !== undefined && {
          artifactsEnabled: update.artifactsEnabled,
        }),
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      toolAccessMode: toContractToolAccessMode(row.toolAccessMode),
      connectorSearch: row.connectorSearch,
      artifactsEnabled: row.artifactsEnabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
