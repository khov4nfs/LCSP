import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  AuthUserRole,
  LegalSourceDocumentIngestionState,
  LegalSourceLifecycleStatus,
  Prisma,
  UserAccessStatus,
} from "@prisma/client";
import { LEGAL_DOCUMENT_GRAPH } from "@lcsp/contracts/legal-source";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../src/platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { LegalDocumentGraphService } from "../src/modules/legal-source/application/services/legal-document-graph.service.js";
import { LegalSourceDocumentService } from "../src/modules/legal-source/application/services/legal-source-document.service.js";
import { LegalSourceManagementService } from "../src/modules/legal-source/application/services/legal-source-management.service.js";
import { LegalSourceService } from "../src/modules/legal-source/application/services/legal-source.service.js";
import { managedChunkId } from "../src/modules/legal-source/application/services/legal-source-structure.js";
import {
  NodeSafeFetchTransport,
  SafeUrlFetcherService,
} from "../src/modules/legal-source/application/services/safe-url-fetcher.service.js";

// Explicit factories also work with tsx, which does not emit constructor metadata.
@Module({
  providers: [
    PrismaService,
    NodeSafeFetchTransport,
    {
      provide: AuditWriterService,
      inject: [PrismaService],
      useFactory: (p: PrismaService) => new AuditWriterService(p),
    },
    {
      provide: OutboxRepository,
      inject: [PrismaService],
      useFactory: (p: PrismaService) => new OutboxRepository(p),
    },
    {
      provide: SafeUrlFetcherService,
      inject: [NodeSafeFetchTransport],
      useFactory: (t: NodeSafeFetchTransport) => new SafeUrlFetcherService(t),
    },
    {
      provide: LegalSourceService,
      inject: [PrismaService, OutboxRepository, AuditWriterService],
      useFactory: (
        p: PrismaService,
        o: OutboxRepository,
        a: AuditWriterService,
      ) => new LegalSourceService(p, o, a),
    },
    {
      provide: LegalSourceDocumentService,
      inject: [
        PrismaService,
        OutboxRepository,
        AuditWriterService,
        SafeUrlFetcherService,
      ],
      useFactory: (
        p: PrismaService,
        o: OutboxRepository,
        a: AuditWriterService,
        f: SafeUrlFetcherService,
      ) => new LegalSourceDocumentService(p, o, a, f),
    },
    {
      provide: LegalSourceManagementService,
      inject: [
        PrismaService,
        AuditWriterService,
        LegalSourceDocumentService,
        LegalSourceService,
      ],
      useFactory: (
        p: PrismaService,
        a: AuditWriterService,
        d: LegalSourceDocumentService,
        s: LegalSourceService,
      ) => new LegalSourceManagementService(p, a, d, s),
    },
    {
      provide: LegalDocumentGraphService,
      inject: [PrismaService],
      useFactory: (p: PrismaService) => new LegalDocumentGraphService(p),
    },
  ],
})
class Phase0Module {}

const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: `${root}.env`, override: true });
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.pathname, "/lcsp_dev");
assert(["127.0.0.1", "localhost"].includes(url.hostname));
assert.equal(url.port || "5432", "5432");
assert(process.argv.slice(2).every((arg) => arg === "--execute"));
const baseId = "3edc9c2a-4900-4c5a-a4a0-660cf99639fc";
const removedId =
  "quyet-dinh-so-1671-qd-ttg-chien-luoc-quoc-gia-ve-tri-tue-nha";
const cache = "/home/khovan/.cache/lcsp360-fbd/phase0";
const correlationId = `lcsp360-phase0-${randomUUID()}`;
const app = await NestFactory.createApplicationContext(Phase0Module, {
  logger: ["error", "warn"],
});
const p = app.get(PrismaService);
try {
  const identity = await p.$queryRaw<
    Array<{ database: string; role: string }>
  >`SELECT current_database() AS database, current_user AS role`;
  assert.equal(identity[0].database, "lcsp_dev");
  const base = await p.legalSourceVersion.findUniqueOrThrow({
    where: { id: baseId },
    include: { documents: { include: { chunks: true } } },
  });
  assert.equal(base.version, "vn-ai-official-2026.v3");
  assert.equal(base.status, LegalSourceLifecycleStatus.ACTIVE);
  assert(base.legalSourceId);
  const existing = await p.legalSourceVersion.findMany({
    where: {
      legalSourceId: base.legalSourceId,
      status: LegalSourceLifecycleStatus.DRAFT,
    },
    include: { documents: { select: { documentId: true } } },
  });
  if (existing.length) {
    console.log(
      JSON.stringify(
        { stopped: "Existing DRAFT; no mutation", drafts: existing },
        null,
        2,
      ),
    );
  } else {
    assert.equal(base.documents.length, 9);
    assert(
      base.documents.every(
        (d) => d.ingestionState === LegalSourceDocumentIngestionState.READY,
      ),
    );
    assert.equal(
      base.documents.filter((d) => d.documentId === removedId).length,
      1,
    );
    const kept33 = base.documents.filter((d) =>
      d.documentId.startsWith("quyet-dinh-so-33-2026"),
    );
    assert.equal(kept33.length, 1);
    const actor = await p.user.findFirstOrThrow({
      where: {
        id: base.createdBy ?? undefined,
        role: AuthUserRole.ADMIN,
        accessStatus: UserAccessStatus.ACTIVE,
      },
      select: { id: true, role: true, accessStatus: true },
    });
    const historical = await p.legalSourceVersion.findMany({
      where: { legalSourceId: base.legalSourceId },
      select: { id: true, version: true, status: true },
      orderBy: { version: "asc" },
    });
    const ids = historical.map((v) => v.id);
    const fingerprint = async () => {
      const tables = [
        "LegalSourceVersion",
        "LegalSourceDocument",
        "LegalDocumentChunk",
        "LegalRetrievalIndex",
        "LegalDocumentMaterialization",
        "LegalDocumentNode",
        "LegalDocumentReference",
        "LegalDocumentChunkNode",
        "LegalDocumentRetrievalUnit",
        "LegalSourceActivationRecord",
        "RuleSetPreparationRun",
        "OutboxMessage",
      ];
      const result: Record<string, unknown> = {};
      for (const table of tables) {
        const filter = ["RuleSetPreparationRun", "OutboxMessage"].includes(
          table,
        )
          ? Prisma.sql`TRUE`
          : Prisma.sql`${Prisma.raw(table === "LegalSourceVersion" ? "t.id" : 't."legalSourceVersionId"')} IN (${Prisma.join(ids)})`;
        result[table] = await p.$queryRaw(
          Prisma.sql`SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM ${Prisma.raw(`"${table}"`)} t WHERE ${filter}`,
        );
      }
      return result;
    };
    const before = await fingerprint();
    const baseReferences = await p.legalDocumentReference.findMany({
      where: { legalSourceVersionId: baseId },
      select: {
        fromNode: { select: { documentId: true } },
        toNode: { select: { documentId: true } },
      },
    });
    const touchingRemoved = (refs: typeof baseReferences) =>
      refs.filter(
        (r) =>
          (r.fromNode.documentId === removedId ||
            r.toNode?.documentId === removedId) &&
          r.toNode !== null &&
          r.fromNode.documentId !== r.toNode.documentId,
      ).length;
    assert.equal(touchingRemoved(baseReferences), 0);
    const preflight = {
      identity,
      actor,
      historical,
      baseDocuments: base.documents.map((d) => ({
        id: d.id,
        documentId: d.documentId,
        chunks: d.chunks.length,
      })),
      baseCrossReferencesTouchingRemoved: touchingRemoved(baseReferences),
      before,
      correlationId,
    };
    await mkdir(cache, { recursive: true });
    await writeFile(
      `${cache}/${correlationId}-before.json`,
      JSON.stringify(preflight, null, 2),
      { flag: "wx" },
    );
    console.log(
      JSON.stringify(
        { preflight, execute: process.argv.includes("--execute") },
        null,
        2,
      ),
    );
    if (process.argv.includes("--execute")) {
      const management = app.get(LegalSourceManagementService);
      const documents = app.get(LegalSourceDocumentService);
      const draft = await management.createVersion({
        sourceId: base.legalSourceId,
        actorId: actor.id,
        correlationId,
        request: { basedOnVersionId: baseId },
      });
      console.log(
        JSON.stringify({
          created: draft.id,
          version: draft.version,
          status: draft.status,
        }),
      );
      // A competing request may have created a draft while this script performed preflight.
      const creation = await p.auditEvent.findFirst({
        where: {
          resourceId: draft.id,
          correlationId,
          eventType: "LEGAL_SOURCE_VERSION_CREATED",
        },
      });
      assert(
        creation,
        "Draft was created elsewhere; stop without modifying it",
      );
      const copied = await p.legalSourceDocument.findMany({
        where: { legalSourceVersionId: draft.id },
        include: { chunks: true },
      });
      assert.equal(copied.length, 9);
      for (const d of copied) {
        const original = base.documents.find(
          (item) => item.documentId === d.documentId,
        );
        assert(original);
        assert.equal(d.sourceSha256, original.sourceSha256);
        assert.equal(d.chunks.length, original.chunks.length);
        for (const chunk of d.chunks) {
          assert.equal(
            chunk.id,
            managedChunkId(draft.id, d.documentId, chunk.locator),
          );
          assert.equal(
            chunk.contentSha256,
            original.chunks.find((c) => c.locator === chunk.locator)
              ?.contentSha256,
          );
        }
      }
      const removed = copied.find((d) => d.documentId === removedId);
      assert(removed);
      await documents.remove({
        versionId: draft.id,
        documentRowId: removed.id,
        actorId: actor.id,
        correlationId,
      });
      const index = await p.$transaction((tx) =>
        documents.ensureStructuralIndex(tx, {
          id: draft.id,
          version: draft.version,
          status: draft.status,
        }),
      );
      assert(index, "Draft failed structural validation");
      const graph = await app
        .get(LegalDocumentGraphService)
        .materialize(draft.id);
      assert.equal(graph.parserRevision, LEGAL_DOCUMENT_GRAPH.parserRevision);
      assert.equal(
        graph.materializationRevision,
        LEGAL_DOCUMENT_GRAPH.materializationRevision,
      );
      const materialization =
        await p.legalDocumentMaterialization.findUniqueOrThrow({
          where: { id: graph.materializationId },
        });
      const nodes = await p.legalDocumentNode.findMany({
        where: { materializationId: graph.materializationId },
        select: { nodeId: true, documentId: true },
      });
      const references = await p.legalDocumentReference.findMany({
        where: { materializationId: graph.materializationId },
        select: {
          fromNode: { select: { documentId: true } },
          toNode: { select: { documentId: true } },
          resolutionState: true,
        },
      });
      assert.equal(nodes.length, graph.nodes.length);
      assert.equal(references.length, graph.references.length);
      assert(!nodes.some((n) => n.documentId === removedId));
      assert.equal(touchingRemoved(references), 0);
      const final = await p.legalSourceVersion.findUniqueOrThrow({
        where: { id: draft.id },
        include: {
          documents: {
            include: { _count: { select: { chunks: true } } },
            orderBy: { documentId: "asc" },
          },
          _count: {
            select: { ruleSetPreparationRuns: true, activations: true },
          },
        },
      });
      assert.equal(final.status, LegalSourceLifecycleStatus.DRAFT);
      assert.equal(final.activatedAt, null);
      assert.equal(final.basedOnVersionId, baseId);
      assert.equal(final.documents.length, 8);
      assert(!final.documents.some((d) => d.documentId === removedId));
      assert(
        final.documents.some((d) => d.documentId === kept33[0].documentId),
      );
      assert.equal(final._count.ruleSetPreparationRuns, 0);
      assert.equal(final._count.activations, 0);
      const after = await fingerprint();
      assert.deepEqual(
        after,
        before,
        "Protected historical/preparation/outbox rows changed during execution",
      );
      const v3 = await p.legalSourceVersion.findUniqueOrThrow({
        where: { id: baseId },
        select: {
          id: true,
          version: true,
          status: true,
          _count: { select: { documents: true } },
        },
      });
      assert.equal(v3.status, LegalSourceLifecycleStatus.ACTIVE);
      assert.equal(v3._count.documents, 9);
      const rows = final.documents.map((d) => ({
        documentId: d.documentId,
        rowId: d.id,
        state: d.ingestionState,
        chunks: d._count.chunks,
        nodes: nodes.filter((n) => n.documentId === d.documentId).length,
        outgoingReferences: references.filter(
          (r) => r.fromNode.documentId === d.documentId,
        ).length,
        incomingReferences: references.filter(
          (r) => r.toNode?.documentId === d.documentId,
        ).length,
      }));
      assert(
        rows.every(
          (d) =>
            d.nodes > 0 &&
            d.chunks > 0 &&
            d.state === LegalSourceDocumentIngestionState.READY,
        ),
      );
      const audits = await p.auditEvent.findMany({
        where: { correlationId },
        select: { id: true, eventType: true, actorId: true, resourceId: true },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(audits.length, 2);
      const result = {
        verifiedAt: new Date().toISOString(),
        identity,
        actor,
        correlationId,
        version: {
          id: final.id,
          label: final.version,
          status: final.status,
          basedOnVersionId: final.basedOnVersionId,
        },
        removedDocumentId: removedId,
        copiedDocuments: copied.length,
        documents: rows,
        materialization,
        nodeCount: nodes.length,
        referenceCount: references.length,
        crossDocumentReferencesTouchingRemoved: touchingRemoved(references),
        v3,
        protectedRowsUnchanged: true,
        before,
        after,
        audits,
        preparationRuns: final._count.ruleSetPreparationRuns,
        activations: final._count.activations,
      };
      await writeFile(`${cache}/result.json`, JSON.stringify(result, null, 2), {
        flag: "wx",
      });
      console.log(JSON.stringify(result, null, 2));
    }
  }
} finally {
  await app.close();
}
