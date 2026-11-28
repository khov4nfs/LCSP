import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";
import { AUDIT_EXPORT_STATUSES } from "@lcsp/contracts/audit";
import { createHash } from "node:crypto";
import { auditExportChecksum } from "../../services/audit/audit-export-checksum.js";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { AuditExportArtifact } from "../../contracts/audit/audit-export.contract.js";
import { GetAuditExportArtifactHandler } from "./get-audit-export-artifact.handler.js";
import { GetAuditExportArtifactQuery } from "./get-audit-export-artifact.query.js";

const mockArtifact: AuditExportArtifact = {
  export_request_id: "export-1",
  version: 1,
  generated_at: "2026-07-28T10:00:00.000Z",
  filter_criteria: {
    from_date: "2026-07-01T00:00:00.000Z",
    to_date: "2026-07-31T23:59:59.999Z",
  },
  total_events: 1,
  checksum_sha256: "",
  events: [
    {
      event_id: "evt-1",
      event_type: "auth.sign_in",
      actor_id: "user-1",
      decision: "ALLOW",
      payload: { user: "alice" },
      occurred_at: "2026-07-15T12:00:00.000Z",
    },
  ],
};
mockArtifact.checksum_sha256 = auditExportChecksum({
  export_request_id: mockArtifact.export_request_id,
  version: mockArtifact.version,
  generated_at: mockArtifact.generated_at,
  filter_criteria: mockArtifact.filter_criteria,
  total_events: mockArtifact.total_events,
  events: mockArtifact.events,
});

function buildHandler(
  contentJson: unknown = mockArtifact,
  recordExists = true,
) {
  const findFirst = jest.fn(() =>
    recordExists
      ? {
          id: "export-1",
          version: 1,
          status: AUDIT_EXPORT_STATUSES.ready,
          checksumSha256: mockArtifact.checksum_sha256,
          contentJson,
        }
      : null,
  );

  const prisma = {
    auditExportRequest: { findFirst },
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write } as unknown as AuditWriterService;

  const handler = new GetAuditExportArtifactHandler(prisma, auditWriter);
  const query = new GetAuditExportArtifactQuery("export-1", "corr-1");

  return { handler, query, findFirst, write };
}

describe("GetAuditExportArtifactHandler", () => {
  it("does not release artifact bytes when durable download audit fails", async () => {
    const { handler, query, write } = buildHandler();
    write.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(handler.execute(query)).rejects.toThrow("audit unavailable");
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("rejects persisted content whose checksum does not match the artifact", async () => {
    const { handler, query } = buildHandler({ ...mockArtifact, events: [] });
    await expect(handler.execute(query)).rejects.toMatchObject({
      response: {
        ok: false,
        problem: { code: AUDIT_ERROR_CODES.exportNotFound },
      },
    });
  });
  it("rejects an injected field that was not part of the signed artifact", async () => {
    const { handler, query } = buildHandler({
      ...mockArtifact,
      injected: "unexpected",
    });
    await expect(handler.execute(query)).rejects.toMatchObject({
      response: { problem: { code: AUDIT_ERROR_CODES.exportNotFound } },
    });
  });
  it("returns persisted audit export artifact when valid", async () => {
    const { handler, query } = buildHandler(mockArtifact);

    const result = await handler.execute(query);

    expect(result).toEqual(mockArtifact);
  });

  it("accepts a JSONB-style artifact with reordered object keys", async () => {
    const reordered = {
      events: [{ ...mockArtifact.events[0], payload: { user: "alice" } }],
      total_events: mockArtifact.total_events,
      filter_criteria: {
        to_date: mockArtifact.filter_criteria.to_date,
        from_date: mockArtifact.filter_criteria.from_date,
      },
      generated_at: mockArtifact.generated_at,
      version: mockArtifact.version,
      export_request_id: mockArtifact.export_request_id,
      checksum_sha256: mockArtifact.checksum_sha256,
    };
    const { handler, query } = buildHandler(reordered);
    await expect(handler.execute(query)).resolves.toEqual(reordered);
  });

  it("continues to serve an intact export created with the original checksum format", async () => {
    const base = {
      export_request_id: mockArtifact.export_request_id,
      version: mockArtifact.version,
      generated_at: mockArtifact.generated_at,
      filter_criteria: mockArtifact.filter_criteria,
      total_events: mockArtifact.total_events,
      events: mockArtifact.events,
    };
    const legacyChecksum = createHash("sha256")
      .update(JSON.stringify(base))
      .digest("hex");
    // JSONB reorders the persisted object's keys after the old pre-storage digest was made.
    const legacyArtifact = {
      events: base.events.map((event) => ({
        payload: event.payload,
        occurred_at: event.occurred_at,
        decision: event.decision,
        actor_id: event.actor_id,
        event_type: event.event_type,
        event_id: event.event_id,
      })),
      total_events: base.total_events,
      filter_criteria: {
        to_date: base.filter_criteria.to_date,
        from_date: base.filter_criteria.from_date,
      },
      generated_at: base.generated_at,
      version: base.version,
      export_request_id: base.export_request_id,
      checksum_sha256: legacyChecksum,
    };
    const { handler, query, findFirst } = buildHandler(legacyArtifact);
    findFirst.mockReturnValueOnce({
      id: "export-1",
      version: 1,
      status: AUDIT_EXPORT_STATUSES.ready,
      checksumSha256: legacyChecksum,
      contentJson: legacyArtifact,
    });
    await expect(handler.execute(query)).resolves.toEqual(legacyArtifact);
  });

  it("throws exportNotFound problem when audit export record is not found", async () => {
    const { handler, query } = buildHandler(null, false);

    await expect(handler.execute(query)).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: AUDIT_ERROR_CODES.exportNotFound,
          correlationId: "corr-1",
        },
      },
    });
  });

  it("throws exportNotFound problem when contentJson is null or malformed", async () => {
    const { handler, query } = buildHandler({ invalid: "content" });

    await expect(handler.execute(query)).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: AUDIT_ERROR_CODES.exportNotFound,
          correlationId: "corr-1",
        },
      },
    });
  });
});
