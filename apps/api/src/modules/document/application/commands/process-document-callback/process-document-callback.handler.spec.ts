import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { DOCUMENT_REQUEST_STATUSES } from "@lcsp/contracts/document";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ProcessDocumentCallbackHandler } from "./process-document-callback.handler.js";
import { ProcessDocumentCallbackCommand } from "./process-document-callback.command.js";

type DocumentRequestProjection = {
  id: string;
  assessmentId: string;
  correlationId?: string;
};

function buildHandler(options?: {
  request?: DocumentRequestProjection | null;
}) {
  const request =
    options?.request === undefined
      ? {
          id: "dr-1",
          assessmentId: "asmt-1",
          correlationId: "corr-1",
        }
      : options.request;

  const findUnique = jest
    .fn<() => Promise<DocumentRequestProjection | null>>()
    .mockResolvedValue(request);
  const update = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
  const createAuthAudit = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({});

  const prisma = {
    documentRequest: { findUnique, update },
    auditEvent: { create: createAuthAudit },
  } as unknown as PrismaService;

  const auditWriter = {} as unknown as AuditWriterService;

  const handler = new ProcessDocumentCallbackHandler(prisma, auditWriter);

  return { handler, findUnique, update, createAuthAudit };
}

describe("ProcessDocumentCallbackHandler", () => {
  it("throws NotFoundException when document request missing", async () => {
    const { handler } = buildHandler({ request: null });
    const command = new ProcessDocumentCallbackCommand(
      {
        document_request_id: "missing",
        status: DOCUMENT_REQUEST_STATUSES.ready,
      },
      "corr-1",
    );

    await expect(handler.execute(command)).rejects.toThrow(NotFoundException);
  });

  it("updates document request and writes audit when callback arrives", async () => {
    const { handler, findUnique, update, createAuthAudit } = buildHandler();
    const command = new ProcessDocumentCallbackCommand(
      {
        document_request_id: "dr-1",
        status: DOCUMENT_REQUEST_STATUSES.ready,
        document_url: "https://obj/store/1",
      },
      "corr-1",
    );

    const result = await handler.execute(command);

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(createAuthAudit).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(true);
    expect(result.document_request_id).toBe("dr-1");
  });
});
