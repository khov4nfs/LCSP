import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("Admin corpus lifecycle concurrency (e2e)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows exactly one concurrent terminal transition and preserves the active corpus", async () => {
    const activeId = "e2e-lifecycle-active";
    const draftId = "e2e-lifecycle-draft";
    await prisma.legalCorpusVersion.deleteMany({
      where: { id: { in: [activeId, draftId] } },
    });
    await prisma.legalCorpusVersion.createMany({
      data: [
        {
          id: activeId,
          version: "e2e-active-v1",
          status: "APPROVED",
          sourceManifest: {},
          approvedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: draftId,
          version: "e2e-draft-v1",
          status: "DRAFT",
          sourceManifest: {},
        },
      ],
    });

    const transition = async (action: "publish" | "discard") =>
      prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_advisory_xact_lock(hashtext('lcsp:legal-corpus-lifecycle')) IS NOT NULL AS acquired
        `;
        assert.equal(lock[0]?.acquired, true);
        const claimed = await tx.legalCorpusVersion.updateMany({
          where: { id: draftId, status: "DRAFT" },
          data: { status: "APPROVED", approvedAt: new Date() },
        });
        if (claimed.count !== 1) return { won: false, action };
        const terminalStatus = action === "publish" ? "APPROVED" : "REJECTED";
        await tx.legalCorpusVersion.update({
          where: { id: draftId },
          data: { status: terminalStatus },
        });
        if (action === "publish") {
          await tx.legalCorpusVersion.updateMany({
            where: { id: activeId, status: "APPROVED" },
            data: { status: "SUPERSEDED" },
          });
        }
        return { won: true, action };
      });

    const results = await Promise.all([
      transition("publish"),
      transition("discard"),
    ]);
    assert.equal(results.filter((result) => result.won).length, 1);

    const versions = await prisma.legalCorpusVersion.findMany({
      where: { id: { in: [activeId, draftId] } },
      select: { id: true, status: true },
    });
    const statusById = new Map(
      versions.map((version) => [version.id, version.status]),
    );
    const winner = results.find((result) => result.won)?.action;
    assert.equal(
      winner === "publish"
        ? statusById.get(draftId) === "APPROVED" &&
            statusById.get(activeId) === "SUPERSEDED"
        : statusById.get(draftId) === "REJECTED" &&
            statusById.get(activeId) === "APPROVED",
      true,
    );

    await prisma.legalCorpusVersion.deleteMany({
      where: { id: { in: [activeId, draftId] } },
    });
  });
});
