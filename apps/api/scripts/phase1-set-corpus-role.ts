import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import { fromPrismaLegalSourceLifecycleStatus } from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../src/platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { LegalSourceDocumentService } from "../src/modules/legal-source/application/services/legal-source-document.service.js";
import {
  NodeSafeFetchTransport,
  SafeUrlFetcherService,
} from "../src/modules/legal-source/application/services/safe-url-fetcher.service.js";

/** Uses the same locked, audited mutation as the admin endpoint; never activates a version. */
export async function setReferenceOnly(versionId: string, documentId: string) {
  z.string().uuid().parse(versionId);
  z.string().min(1).parse(documentId);
  if (!process.env.DATABASE_URL)
    throw new Error("Explicit DATABASE_URL required");
  const prisma = new PrismaService();
  try {
    const version = await prisma.legalSourceVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    if (
      fromPrismaLegalSourceLifecycleStatus(version.status) !==
      LEGAL_SOURCE_LIFECYCLE_STATUSES.draft
    )
      throw new Error("Only DRAFT versions can change corpus role");
    const document = await prisma.legalSourceDocument.findUniqueOrThrow({
      where: {
        legalSourceVersionId_documentId: {
          legalSourceVersionId: versionId,
          documentId,
        },
      },
    });
    if (!version.createdBy)
      throw new Error(
        "Draft must have a recorded administrator creator for the audit actor",
      );
    const service = new LegalSourceDocumentService(
      prisma,
      new OutboxRepository(prisma),
      new AuditWriterService(prisma),
      new SafeUrlFetcherService(new NodeSafeFetchTransport()),
    );
    const after = await service.updateCorpusRole({
      versionId,
      documentRowId: document.id,
      actorId: version.createdBy,
      correlationId: `lcsp360-corpus-role-${randomUUID()}`,
      request: {
        corpusRole: LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
      },
    });
    return {
      versionId,
      documentId,
      before: document.corpusRole,
      after: after.corpusRole,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.length !== 2)
    throw new Error(
      "Usage: phase1-set-corpus-role.ts <DRAFT-version-id> <documentId>",
    );
  console.log(JSON.stringify(await setReferenceOnly(args[0], args[1])));
}
