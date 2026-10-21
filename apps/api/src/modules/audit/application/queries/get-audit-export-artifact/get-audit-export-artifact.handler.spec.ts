import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
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
  checksum_sha256: "abc123def456",
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

function buildHandler(
  contentJson: unknown = mockArtifact,
  recordExists = true,
) {
  const findFirst = jest.fn(() =>
    recordExists
      ? {
          contentJson,
        }
      : null,
  );

  const prisma = {
    auditExportRequest: { findFirst },
  } as unknown as PrismaService;

  const handler = new GetAuditExportArtifactHandler(prisma);
  const query = new GetAuditExportArtifactQuery("export-1", "corr-1");

  return { handler, query, findFirst };
}

describe("GetAuditExportArtifactHandler", () => {
  it("returns persisted audit export artifact when valid", async () => {
    const { handler, query } = buildHandler(mockArtifact);

    const result = await handler.execute(query);

    expect(result).toEqual(mockArtifact);
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
