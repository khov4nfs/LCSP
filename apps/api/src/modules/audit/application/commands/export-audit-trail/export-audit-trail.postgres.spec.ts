import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  AUDIT_DECISIONS,
  AUDIT_ERROR_CODES,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";

import { toPrismaAuditExportStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { GetAuditExportArtifactHandler } from "../../queries/get-audit-export-artifact/get-audit-export-artifact.handler.js";
import { GetAuditExportArtifactQuery } from "../../queries/get-audit-export-artifact/get-audit-export-artifact.query.js";
import { ExportAuditTrailCommand } from "./export-audit-trail.command.js";
import { ExportAuditTrailHandler } from "./export-audit-trail.handler.js";

const databaseUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
);
// This mutation test may run only against the designated disposable local database.
const runDatabaseTest =
  process.env.LCSP_AUDIT_POSTGRES_TEST === "1" &&
  ["127.0.0.1", "[::1]"].includes(databaseUrl.hostname) &&
  ["55432", "55435"].includes(databaseUrl.port) &&
  databaseUrl.pathname === "/lcsp_api_test";

(runDatabaseTest ? describe : describe.skip)(
  "audit export PostgreSQL transaction",
  () => {
    it("rolls back on audit failure and allocates distinct versions for concurrent exports", async () => {
      const prisma = new PrismaService();
      const actorId = randomUUID();
      const correlationId = randomUUID();
      const exportIds: string[] = [];
      const sourceId = randomUUID();
      await prisma.$connect();
      try {
        await prisma.user.create({
          data: {
            id: actorId,
            email: `${actorId}@example.invalid`,
            passwordHash: "test-only",
            emailVerified: false,
            failedLoginCount: 0,
          },
        });
        const command = new ExportAuditTrailCommand(
          actorId,
          "2100-01-01T00:00:00.000Z",
          "2100-01-02T00:00:00.000Z",
          correlationId,
        );
        const failingWriter = {
          writeInTx: () => Promise.reject(new Error("audit unavailable")),
        } as unknown as AuditWriterService;
        await expect(
          new ExportAuditTrailHandler(
            prisma,
            new AuditRedactorService(),
            failingWriter,
          ).execute(command),
        ).rejects.toThrow("audit unavailable");
        expect(
          await prisma.auditExportRequest.count({ where: { correlationId } }),
        ).toBe(0);

        const handler = new ExportAuditTrailHandler(
          prisma,
          new AuditRedactorService(),
          new AuditWriterService(prisma),
        );
        const results = await Promise.all([
          handler.execute(command),
          handler.execute(command),
        ]);
        exportIds.push(...results.map((result) => result.export_request_id));
        expect(new Set(results.map((result) => result.version)).size).toBe(2);
        expect(
          await prisma.auditEvent.count({
            where: { resourceId: { in: exportIds } },
          }),
        ).toBe(2);
        // JSONB round-trip must retain a verifiable artifact before a download is audited.
        const artifact = await new GetAuditExportArtifactHandler(
          prisma,
          new AuditWriterService(prisma),
        ).execute(new GetAuditExportArtifactQuery(exportIds[0], correlationId));
        expect(artifact.export_request_id).toBe(exportIds[0]);

        // Recreate a historical export using an event loaded from JSONB, then verify the old digest after another JSONB round-trip.
        await new AuditWriterService(prisma).write({
          eventType: AUDIT_EVENT_TYPES.exportGenerated,
          actorId,
          resourceType: AUDIT_RESOURCE_TYPES.auditExportRequest,
          resourceId: sourceId,
          correlationId,
          decision: AUDIT_DECISIONS.allow,
          payload: {
            zeta: "last",
            alpha: "first",
            nested: { second: 2, first: 1 },
          },
        });
        const source = await prisma.auditEvent.findFirstOrThrow({
          where: { resourceId: sourceId },
        });
        const legacyId = randomUUID();
        const generatedAt = new Date();
        const legacyBase = {
          export_request_id: legacyId,
          version: 1,
          generated_at: generatedAt.toISOString(),
          filter_criteria: {
            from_date: command.fromDate,
            to_date: command.toDate,
          },
          total_events: 1,
          events: [
            {
              event_id: source.id,
              event_type: source.eventType,
              actor_id: source.actorId,
              decision: AUDIT_DECISIONS.allow,
              payload: new AuditRedactorService().redact(source.payload),
              occurred_at: source.createdAt.toISOString(),
            },
          ],
        };
        const legacyChecksum = createHash("sha256")
          .update(JSON.stringify(legacyBase))
          .digest("hex");
        await prisma.auditExportRequest.create({
          data: {
            id: legacyId,
            requestedById: actorId,
            fromDate: new Date(command.fromDate),
            toDate: new Date(command.toDate),
            status: toPrismaAuditExportStatus(AUDIT_EXPORT_STATUSES.ready),
            version: 1,
            checksumSha256: legacyChecksum,
            contentJson: {
              ...legacyBase,
              checksum_sha256: legacyChecksum,
            } as unknown as Prisma.InputJsonValue,
            correlationId,
            createdAt: generatedAt,
            completedAt: generatedAt,
          },
        });
        exportIds.push(legacyId);
        const legacy = await new GetAuditExportArtifactHandler(
          prisma,
          new AuditWriterService(prisma),
        ).execute(new GetAuditExportArtifactQuery(legacyId, correlationId));
        expect(legacy.checksum_sha256).toBe(legacyChecksum);

        // A large JSON payload in the current time window must be rejected before Prisma hydrates it.
        const observedAt = new Date();
        const oversizedCommand = new ExportAuditTrailCommand(
          actorId,
          new Date(observedAt.getTime() - 60_000).toISOString(),
          new Date(observedAt.getTime() + 60_000).toISOString(),
          correlationId,
        );
        await prisma.auditEvent.create({
          data: {
            id: randomUUID(),
            eventType: AUDIT_EVENT_TYPES.exportGenerated,
            resourceId: sourceId,
            correlationId,
            payload: { note: "x".repeat(6 * 1024 * 1024) },
            createdAt: observedAt,
          },
        });
        await expect(handler.execute(oversizedCommand)).rejects.toMatchObject({
          response: { problem: { code: AUDIT_ERROR_CODES.invalidQuery } },
        });
        expect(
          await prisma.auditExportRequest.count({ where: { correlationId } }),
        ).toBe(3);
      } finally {
        const ownedExports = await prisma.auditExportRequest.findMany({
          where: { requestedById: actorId },
          select: { id: true },
        });
        const ownedIds = ownedExports.map((item) => item.id);
        await prisma.auditEvent.deleteMany({
          where: { resourceId: { in: [...ownedIds, sourceId] } },
        });
        await prisma.auditExportRequest.deleteMany({
          where: { requestedById: actorId },
        });
        await prisma.user.deleteMany({ where: { id: actorId } });
        await prisma.$disconnect();
      }
    }, 30_000);
  },
);
