import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUDIT_EVENT_TYPES } from "@lcsp/contracts/audit";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { LegalSourceManagementService } from "./legal-source-management.service.js";

const rawUrl = process.env.DATABASE_URL ?? "";
const url = rawUrl ? new URL(rawUrl) : null;
const dedicated =
  url?.hostname === "127.0.0.1" &&
  url.port === "55446" &&
  url.pathname === "/lcsp_legal_source_race_test";
const database = dedicated ? describe : describe.skip;

database("Legal Source catalog audit PostgreSQL transaction", () => {
  let prisma: PrismaClient;
  let service: LegalSourceManagementService;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(rawUrl) });
    await prisma.$connect();
    service = new LegalSourceManagementService(
      prisma as never,
      new AuditWriterService(prisma as never),
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("rolls back catalog creation when audit persistence fails", async () => {
    // Why: A visible source without Admin audit evidence must never survive a failed write.
    // How: Force the audit writer to reject inside a real PostgreSQL transaction.
    // Invariant: The source insert is rolled back with the audit failure.
    const slug = `audit-create-${randomUUID()}`;
    const failing = new LegalSourceManagementService(
      prisma as never,
      {
        writeInTx: () => Promise.reject(new Error("audit unavailable")),
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      failing.createSource({
        actorId: randomUUID(),
        correlationId: randomUUID(),
        request: { name: "Atomic source", slug },
      }),
    ).rejects.toThrow("audit unavailable");
    expect(await prisma.legalSource.count({ where: { slug } })).toBe(0);
  });

  it("commits update with actor-attributed audit and rolls it back on audit failure", async () => {
    // Why: Source metadata controls the identity Admins and customers see.
    // How: Inspect a successful update and then reject a second audit in the same database.
    // Invariant: The failed second update cannot alter the committed name or add an audit.
    const actorId = randomUUID();
    const correlationId = randomUUID();
    const source = await service.createSource({
      actorId,
      correlationId,
      request: {
        name: "Original source",
        slug: `audit-update-${randomUUID()}`,
      },
    });
    await service.updateSource({
      sourceId: source.id,
      actorId,
      correlationId,
      request: { name: "Accepted source" },
    });
    const event = await prisma.auditEvent.findFirst({
      where: {
        eventType: AUDIT_EVENT_TYPES.legalSourceUpdated,
        resourceId: source.id,
        correlationId,
      },
    });
    expect(event).toMatchObject({ actorId, resourceId: source.id });
    const failing = new LegalSourceManagementService(
      prisma as never,
      {
        writeInTx: () => Promise.reject(new Error("audit unavailable")),
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      failing.updateSource({
        sourceId: source.id,
        actorId,
        correlationId: randomUUID(),
        request: { name: "Rejected source" },
      }),
    ).rejects.toThrow("audit unavailable");
    expect(
      await prisma.legalSource.findUnique({
        where: { id: source.id },
        select: { name: true },
      }),
    ).toEqual({ name: "Accepted source" });
  });

  it("retries only the generated slug after a real unique-index collision", async () => {
    // Why: Tight P2002 classification must still allow the catalog's numbered-slug behavior.
    // How: Create two sources with the same name against PostgreSQL's LegalSource slug index.
    // Invariant: Each committed source has one matching creation audit and a distinct slug.
    const name = `Collision ${randomUUID()}`;
    const actorId = randomUUID();
    const first = await service.createSource({
      actorId,
      correlationId: randomUUID(),
      request: { name },
    });
    const second = await service.createSource({
      actorId,
      correlationId: randomUUID(),
      request: { name },
    });
    expect(second.slug).toBe(`${first.slug}-2`);
    expect(
      await prisma.auditEvent.count({
        where: {
          eventType: AUDIT_EVENT_TYPES.legalSourceCreated,
          resourceId: { in: [first.id, second.id] },
        },
      }),
    ).toBe(2);
  });
});
