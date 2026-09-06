import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  LegalRuleLifecycleStatus,
  PrismaClient,
  RepositoryScanJobStatus,
} from "@prisma/client";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";

import {
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositoryScanGraph,
} from "../support/auth-workspace-test-helpers.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for LCSP-278 release seed");
}

const prisma = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });

const ASSESSMENT_ID = "assessment-lcsp-278-release";
const BLOCKED_ASSESSMENT_ID = "assessment-lcsp-278-blocked";
const USER_ID = "user-1";
const SCAN_JOB_ID = "scan-lcsp-278-release";
const BLOCKED_SCAN_JOB_ID = "scan-lcsp-278-blocked";
const SNAPSHOT_ID = "snapshot-lcsp-278-release";
const BLOCKED_SNAPSHOT_ID = "snapshot-lcsp-278-blocked";
const CONNECTION_ID = "connection-lcsp-278-release";
const BLOCKED_CONNECTION_ID = "connection-lcsp-278-blocked";
const CORPUS_ID = "corpus-lcsp-278-release";
const CATALOG_ID = "catalog-lcsp-278-release";
const DOCUMENT_ROW_ID = "doc-row-lcsp-278-release";
const DOCUMENT_ID = "LAW-LCSP-278";
const CHUNK_ID = "chunk_lcsp278_release";
const LEGAL_RULE_ID = "LEGAL-LCSP-278-RELEASE";
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

async function main(): Promise<void> {
  await prisma.$connect();
  await resetAuthWorkspaceDatabase(prisma);
  await resetWorkerCheckpointFixtures();
  await deleteLegalFixtures();
  await seedAuthWorkspaceFixture(prisma);
  await seedRepositoryScanGraph(prisma, {
    assessmentId: ASSESSMENT_ID,
    userId: USER_ID,
    connectionId: CONNECTION_ID,
    snapshotId: SNAPSHOT_ID,
    scanJobId: SCAN_JOB_ID,
    scanJobStatus: RepositoryScanJobStatus.RUNNING,
  });
  await seedRepositoryScanGraph(prisma, {
    assessmentId: BLOCKED_ASSESSMENT_ID,
    userId: USER_ID,
    connectionId: BLOCKED_CONNECTION_ID,
    snapshotId: BLOCKED_SNAPSHOT_ID,
    scanJobId: BLOCKED_SCAN_JOB_ID,
    scanJobStatus: RepositoryScanJobStatus.RUNNING,
  });
  await prisma.assessment.update({
    where: { id: ASSESSMENT_ID },
    data: {
      name: "LCSP-278 production release vertical",
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });
  await prisma.assessment.update({
    where: { id: BLOCKED_ASSESSMENT_ID },
    data: {
      name: "LCSP-278 production release vertical blocked",
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
    },
  });
  await seedLegalFixtures();
  await seedSnapshotArchiveCache(SNAPSHOT_ID);
  await seedSnapshotArchiveCache(BLOCKED_SNAPSHOT_ID);
}

async function resetWorkerCheckpointFixtures(): Promise<void> {
  await deleteCheckpointFixtures("lcsp_interview_post_guard_continuation");
  await deleteCheckpointFixtures("lcsp_managed_investigator_execution");
}

async function deleteCheckpointFixtures(tableName: string): Promise<void> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS "exists"
  `;
  if (!rows[0]?.exists) return;

  if (tableName === "lcsp_interview_post_guard_continuation") {
    await prisma.$executeRaw`
      DELETE FROM "lcsp_interview_post_guard_continuation"
      WHERE assessment_id IN (${ASSESSMENT_ID}, ${BLOCKED_ASSESSMENT_ID})
    `;
    return;
  }

  await prisma.$executeRaw`
    DELETE FROM "lcsp_managed_investigator_execution"
    WHERE assessment_id IN (${ASSESSMENT_ID}, ${BLOCKED_ASSESSMENT_ID})
  `;
}

async function deleteLegalFixtures(): Promise<void> {
  await prisma.legalRule.deleteMany({
    where: { legalRuleCatalogVersionId: CATALOG_ID },
  });
  await prisma.legalDocumentChunk.deleteMany({
    where: { legalCorpusVersionId: CORPUS_ID },
  });
  await prisma.legalSourceDocument.deleteMany({
    where: { legalCorpusVersionId: CORPUS_ID },
  });
  await prisma.legalRuleCatalogVersion.deleteMany({
    where: { id: CATALOG_ID },
  });
  await prisma.legalCorpusVersion.deleteMany({
    where: { id: CORPUS_ID },
  });
}

async function seedLegalFixtures(): Promise<void> {
  const content =
    "AI recommendation systems must preserve human approval authority before automated action.";
  const contentSha256 = createHash("sha256").update(content).digest("hex");

  await prisma.legalCorpusVersion.create({
    data: {
      id: CORPUS_ID,
      version: CORPUS_ID,
      status: LegalRuleLifecycleStatus.APPROVED,
      sourceManifest: { source: "lcsp-278-release-vertical" },
      approvedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });
  await prisma.legalSourceDocument.create({
    data: {
      id: DOCUMENT_ROW_ID,
      legalCorpusVersionId: CORPUS_ID,
      documentId: DOCUMENT_ID,
      title: "LCSP-278 governed release fixture",
      sourceUrl: "https://example.test/lcsp-278-release",
      sourceSha256: contentSha256,
      sourceEffectStatus: "ACTIVE",
    },
  });
  await prisma.legalDocumentChunk.create({
    data: {
      id: CHUNK_ID,
      legalCorpusVersionId: CORPUS_ID,
      legalSourceDocumentId: DOCUMENT_ROW_ID,
      documentId: DOCUMENT_ID,
      locator: "Article 1",
      content,
      contentSha256,
      hierarchy: {
        parentChunkId: null,
        outgoingRefIds: [],
        incomingRefIds: [],
        normativeRole: "ENGINEERING_RULE_SOURCE",
      },
      legalStatus: "ACTIVE",
    },
  });
  await prisma.legalRuleCatalogVersion.create({
    data: {
      id: CATALOG_ID,
      version: CATALOG_ID,
      status: LegalRuleLifecycleStatus.APPROVED,
      ruleRefs: [LEGAL_RULE_ID],
      approvedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });
  await prisma.legalRule.create({
    data: {
      legalRuleId: LEGAL_RULE_ID,
      legalRuleCatalogVersionId: CATALOG_ID,
      ruleFamily: "AI_RECOMMENDATION_HUMAN_APPROVAL",
      requiredFacts: {
        concept: "approval authority",
        requiredEvidence: ["CONTROL"],
      },
      optionalFacts: {},
      blockingFacts: {},
      unknownFactPolicy: "BLOCK_ON_UNKNOWN",
      citationLocatorRefs: [
        {
          legalCorpusVersionId: CORPUS_ID,
          documentId: DOCUMENT_ID,
          locator: "Article 1",
        },
      ],
      status: LegalRuleLifecycleStatus.APPROVED,
      authoredBy: "lcsp-278-release-seed",
    },
  });
}

async function seedSnapshotArchiveCache(snapshotId: string): Promise<void> {
  const cacheRoot =
    process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR?.trim() ||
    join(tmpdir(), "lcsp-snapshot-archive-cache");
  const key = createHash("sha256")
    .update(`${snapshotId}:${COMMIT_SHA}`)
    .digest("hex");

  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(cacheRoot, `${key}.archive`), fixtureArchive(), {
    mode: 0o600,
  });
  await writeFile(
    join(cacheRoot, `${key}.json`),
    JSON.stringify({
      snapshotId,
      commitSha: COMMIT_SHA,
      contentType: "application/gzip",
      resolvedUrl: "fixture://lcsp-278-release-snapshot",
      expiresAt: Date.now() + 60 * 60 * 1000,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}

function fixtureArchive(): Buffer {
  return gzipSync(
    Buffer.concat([
      tarEntry(
        "repo/README.md",
        "# LCSP-278 fixture\n\nAI-assisted recommendations require human approval.\n",
      ),
      tarEntry(
        "repo/src/recommendation-service.ts",
        [
          "export function recommend(input: string): string {",
          "  return `human-approved:${input}`;",
          "}",
          "",
        ].join("\n"),
      ),
      Buffer.alloc(1024),
    ]),
  );
}

function tarEntry(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(octal(body.length, 11) + "\0", 124, 12, "ascii");
  header.write(octal(0, 11) + "\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(octal(checksum, 6) + "\0 ", 148, 8, "ascii");

  return Buffer.concat([header, body, Buffer.alloc(paddingFor(body.length))]);
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}

function paddingFor(size: number): number {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
