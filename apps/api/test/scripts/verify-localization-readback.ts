import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { AuthoredLocalizationService } from "../../src/platform/localization/authored-localization.service.js";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";

// Separate-process readback probe for the disposable PostgreSQL integration fixture.
const url = process.env.LCSP_TEST_LOCALIZATION_DATABASE_URL;
const id = process.env.LCSP_TEST_PERSISTED_REQUEST_ID;
if (
  !url ||
  !id ||
  new URL(url).hostname !== "127.0.0.1" ||
  !new URL(url).pathname.includes("lcsp347_localization_test")
)
  throw new Error(
    "Dedicated disposable database and exact fixture request ID required",
  );
const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
globalThis.fetch = () =>
  Promise.reject(new Error("Readback must never call a provider"));
try {
  const job = await prisma.authoredLocalizationRequest.findUniqueOrThrow({
    where: { id },
  });
  const projection = await new AuthoredLocalizationService(
    prisma as PrismaService,
  ).project(
    [job.originalContent],
    job.locale === "EN" ? "en" : "vi",
    job.scopeId,
    {
      entityType: job.entityType,
      entityId: job.entityId,
      canonicalDigest: job.canonicalDigest,
      canonicalRevision: job.canonicalRevision,
    },
  );
  const hash = createHash("sha256")
    .update(projection.get(job.originalContent)!, "utf8")
    .digest("hex");
  assert.equal(hash, job.originSha256);
  console.log(
    JSON.stringify({
      requestId: id,
      sourceSha256: hash,
      providerCalls: 0,
      persistedRead: true,
    }),
  );
} finally {
  await prisma.$disconnect();
}
