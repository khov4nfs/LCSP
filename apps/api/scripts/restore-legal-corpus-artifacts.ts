import { PrismaPg } from "@prisma/adapter-pg";
import {
  LegalRetrievalIndexStatus,
  LegalRuleLifecycleStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const projectRoot = resolve(import.meta.dirname, "../../..");
const defaultStorageRoot = resolve(projectRoot, ".corpus");
const storageRoot = resolve(
  process.env.LEGAL_SOURCE_STORAGE_ROOT ?? defaultStorageRoot,
);
const artifactRoot = resolve(storageRoot, "recovery-artifacts");
const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

async function main(): Promise<void> {
  const corpusArtifacts = await readArtifacts("legal-corpus");
  for (const artifact of corpusArtifacts) {
    await restoreCorpus(artifact);
  }

  const indexArtifacts = await readArtifacts("legal-retrieval-index");
  for (const artifact of indexArtifacts) {
    await restoreRetrievalIndex(artifact);
  }

  const catalogArtifacts = await readArtifacts("legal-rule-catalog");
  for (const artifact of catalogArtifacts) {
    await restoreCatalog(artifact);
  }

  const engineeringRuleArtifacts = await readArtifacts("engineering-rules");
  console.log(
    `restore complete: corpus=${corpusArtifacts.length}, indexes=${indexArtifacts.length}, catalogs=${catalogArtifacts.length}, engineeringRuleBundles=${engineeringRuleArtifacts.length}`,
  );
}

async function readArtifacts(category: string): Promise<JsonRecord[]> {
  const directory = resolve(artifactRoot, category);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const artifacts: JsonRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === "latest.json") {
      continue;
    }
    const parsed = JSON.parse(
      await readFile(resolve(directory, name), "utf-8"),
    ) as JsonRecord;
    const payload = record(parsed.payload);
    if (payload) {
      artifacts.push(payload);
    }
  }
  return artifacts;
}

async function restoreCorpus(artifact: JsonRecord): Promise<void> {
  const ingestPayload = record(artifact.ingestPayload);
  if (!ingestPayload) {
    return;
  }
  const version = stringValue(ingestPayload.version);
  if (!version) {
    return;
  }
  const corpus = await prisma.legalCorpusVersion.upsert({
    where: { version },
    update: {
      sourceManifest: jsonValue(ingestPayload.sourceManifest),
      status: LegalRuleLifecycleStatus.APPROVED,
      approvedAt: new Date(),
    },
    create: {
      version,
      sourceManifest: jsonValue(ingestPayload.sourceManifest),
      status: LegalRuleLifecycleStatus.APPROVED,
      approvedAt: new Date(),
    },
  });

  const documents = arrayValue(ingestPayload.documents);
  for (const value of documents) {
    const document = record(value);
    if (!document) {
      continue;
    }
    const documentId = stringValue(document.documentId);
    if (!documentId) {
      continue;
    }
    const sourceDocument = await prisma.legalSourceDocument.upsert({
      where: {
        legalCorpusVersionId_documentId: {
          legalCorpusVersionId: corpus.id,
          documentId,
        },
      },
      update: {
        title: stringValue(document.title) || documentId,
        sourceUrl: stringValue(document.sourceUrl) || "",
        sourceSha256: stringValue(document.sourceSha256) || "",
        sourceEffectStatus:
          stringValue(document.sourceEffectStatus) || "ACTIVE",
        effectiveDate: dateValue(document.effectiveDate),
        snapshotPath: stringValue(document.snapshotPath),
      },
      create: {
        legalCorpusVersionId: corpus.id,
        documentId,
        title: stringValue(document.title) || documentId,
        sourceUrl: stringValue(document.sourceUrl) || "",
        sourceSha256: stringValue(document.sourceSha256) || "",
        sourceEffectStatus:
          stringValue(document.sourceEffectStatus) || "ACTIVE",
        effectiveDate: dateValue(document.effectiveDate),
        snapshotPath: stringValue(document.snapshotPath),
      },
    });

    for (const value of arrayValue(document.chunks)) {
      const chunk = record(value);
      const id = stringValue(chunk?.id);
      if (!chunk || !id) {
        continue;
      }
      await prisma.legalDocumentChunk.upsert({
        where: { id },
        update: {
          legalCorpusVersionId: corpus.id,
          legalSourceDocumentId: sourceDocument.id,
          documentId,
          locator: stringValue(chunk.locator) || id,
          content: stringValue(chunk.content) || "",
          contentSha256: stringValue(chunk.contentSha256) || "",
          hierarchy: jsonValue(chunk.hierarchy),
          legalStatus: stringValue(chunk.legalStatus) || "ACTIVE",
          pageStart: numberValue(chunk.pageStart),
          pageEnd: numberValue(chunk.pageEnd),
        },
        create: {
          id,
          legalCorpusVersionId: corpus.id,
          legalSourceDocumentId: sourceDocument.id,
          documentId,
          locator: stringValue(chunk.locator) || id,
          content: stringValue(chunk.content) || "",
          contentSha256: stringValue(chunk.contentSha256) || "",
          hierarchy: jsonValue(chunk.hierarchy),
          legalStatus: stringValue(chunk.legalStatus) || "ACTIVE",
          pageStart: numberValue(chunk.pageStart),
          pageEnd: numberValue(chunk.pageEnd),
        },
      });
    }
  }
}

async function restoreRetrievalIndex(artifact: JsonRecord): Promise<void> {
  const payload = record(artifact.registerPayload);
  const version = stringValue(payload?.version);
  if (!payload || !version) {
    return;
  }
  const corpusVersion = stringValue(artifact.corpusVersionId);
  const corpus = corpusVersion
    ? await prisma.legalCorpusVersion.findFirst({
        where: { OR: [{ id: corpusVersion }, { version: corpusVersion }] },
      })
    : await prisma.legalCorpusVersion.findFirst({
        orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      });
  if (!corpus) {
    return;
  }
  await prisma.legalRetrievalIndex.upsert({
    where: { version },
    update: {
      legalCorpusVersionId: corpus.id,
      status: LegalRetrievalIndexStatus.VALID,
      configHash: stringValue(payload.configHash) || "",
      contentHash: stringValue(payload.contentHash) || "",
      validationManifestRef: stringValue(payload.validationManifestRef),
      validatedAt: dateValue(payload.validatedAt) ?? new Date(),
    },
    create: {
      legalCorpusVersionId: corpus.id,
      version,
      status: LegalRetrievalIndexStatus.VALID,
      configHash: stringValue(payload.configHash) || "",
      contentHash: stringValue(payload.contentHash) || "",
      validationManifestRef: stringValue(payload.validationManifestRef),
      validatedAt: dateValue(payload.validatedAt) ?? new Date(),
    },
  });
}

async function restoreCatalog(artifact: JsonRecord): Promise<void> {
  const activeCatalog = record(artifact.activeCatalog);
  const catalog = record(activeCatalog ?? artifact.catalog);
  const version =
    stringValue(catalog?.version) || stringValue(artifact.recoveryVersion);
  if (!catalog || !version) {
    return;
  }
  const catalogId =
    stringValue(catalog.versionId) ||
    stringValue(catalog.id) ||
    stableId(version);
  const restored = await prisma.legalRuleCatalogVersion.upsert({
    where: { id: catalogId },
    update: {
      version,
      status: LegalRuleLifecycleStatus.APPROVED,
      approvedAt: new Date(),
      ruleRefs: jsonValue(catalog.ruleRefs ?? []),
    },
    create: {
      id: catalogId,
      version,
      status: LegalRuleLifecycleStatus.APPROVED,
      approvedAt: new Date(),
      ruleRefs: jsonValue(catalog.ruleRefs ?? []),
    },
  });

  for (const value of arrayValue(catalog.rules)) {
    const rule = record(value);
    const legalRuleId = stringValue(rule?.legalRuleId) || stringValue(rule?.id);
    if (!rule || !legalRuleId) {
      continue;
    }
    await prisma.legalRule.upsert({
      where: { legalRuleId },
      update: {
        legalRuleCatalogVersionId: restored.id,
        ruleFamily:
          stringValue(rule.ruleFamily) ||
          "LEGAL_CORPUS_ENGINEERING_RULE_SOURCE",
        requiredFacts: jsonValue(rule.requiredFacts ?? []),
        optionalFacts: jsonValue(rule.optionalFacts ?? []),
        blockingFacts: jsonValue(rule.blockingFacts ?? []),
        unknownFactPolicy:
          stringValue(rule.unknownFactPolicy) || "BLOCK_ON_UNKNOWN",
        citationLocatorRefs: jsonValue(rule.citationLocatorRefs ?? []),
        status: LegalRuleLifecycleStatus.APPROVED,
        authoredBy:
          stringValue(rule.authoredBy) || "legal-rule-recovery-service",
      },
      create: {
        legalRuleId,
        legalRuleCatalogVersionId: restored.id,
        ruleFamily:
          stringValue(rule.ruleFamily) ||
          "LEGAL_CORPUS_ENGINEERING_RULE_SOURCE",
        requiredFacts: jsonValue(rule.requiredFacts ?? []),
        optionalFacts: jsonValue(rule.optionalFacts ?? []),
        blockingFacts: jsonValue(rule.blockingFacts ?? []),
        unknownFactPolicy:
          stringValue(rule.unknownFactPolicy) || "BLOCK_ON_UNKNOWN",
        citationLocatorRefs: jsonValue(rule.citationLocatorRefs ?? []),
        status: LegalRuleLifecycleStatus.APPROVED,
        authoredBy:
          stringValue(rule.authoredBy) || "legal-rule-recovery-service",
      },
    });
  }
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function dateValue(value: unknown): Date | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value ?? {};
}

function stableId(value: string): string {
  return `restored-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
