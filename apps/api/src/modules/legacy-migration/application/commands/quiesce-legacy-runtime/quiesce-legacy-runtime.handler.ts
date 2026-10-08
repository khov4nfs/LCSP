import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGACY_CLOSURE_MARKERS,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/legacy-migration";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { LEGACY_OUTBOX_EVENT_TYPE_LIST } from "../../../domain/legacy-outbox-classification.js";
import { LegacyArchiveRepository } from "../../../infrastructure/persistence/legacy-archive.repository.js";
import { legacyAuditEvent } from "../../services/legacy-audit.js";
import {
  QuiesceLegacyRuntimeCommand,
  type QuiesceLegacyRuntimeResult,
} from "./quiesce-legacy-runtime.command.js";

const BATCH = 200;

@CommandHandler(QuiesceLegacyRuntimeCommand)
export class QuiesceLegacyRuntimeHandler implements ICommandHandler<QuiesceLegacyRuntimeCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: LegacyArchiveRepository,
    private readonly audit: AuditWriterService,
  ) {}

  async execute(
    command: QuiesceLegacyRuntimeCommand,
  ): Promise<QuiesceLegacyRuntimeResult> {
    const result: QuiesceLegacyRuntimeResult = {
      cancelled: 0,
      byEventType: {},
    };
    for (;;) {
      const batch = await this.prisma.$transaction(
        async (tx) => {
          const cancelled = await this.archive.cancelLegacyOutboxBatch(tx, {
            runId: command.runId,
            eventTypes: LEGACY_OUTBOX_EVENT_TYPE_LIST,
            marker: LEGACY_CLOSURE_MARKERS.OUTBOX_CANCELLED,
            limit: BATCH,
          });
          for (const message of cancelled)
            await this.audit.writeInTx(
              legacyAuditEvent({
                eventType:
                  LEGACY_MIGRATION_AUDIT_EVENT_TYPES.OUTBOX_LEGACY_CANCELLED,
                correlationId: command.correlationId,
                resourceType: AUDIT_RESOURCE_TYPES.outbox,
                resourceId: message.id,
                payload: {
                  runId: command.runId,
                  eventType: message.eventType,
                  aggregateType: message.aggregateType,
                  aggregateId: message.aggregateId,
                  previousStatus: message.previousStatus,
                },
              }),
              tx,
            );
          return cancelled;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      if (batch.length === 0) break;
      result.cancelled += batch.length;
      for (const message of batch)
        result.byEventType[message.eventType] =
          (result.byEventType[message.eventType] ?? 0) + 1;
    }
    await this.archive.recordPhase(command.runId, "QUIESCE", result);
    return result;
  }
}
