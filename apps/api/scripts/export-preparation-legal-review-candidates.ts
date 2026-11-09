import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import {
  Prisma,
  PrismaClient,
  LegalSourceLifecycleStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Retrieval navigation only. These phrases never decide scope, legal actor, duty, inclusion or gold.
const searches = {
  RISK_CLASSIFICATION_BEFORE_USE: ["hồ sơ phân loại", "phân loại rủi ro"],
  DATA_PROCESSING_IMPACT_DOSSIER: [
    "đánh giá tác động xử lý dữ liệu",
    "đánh giá tác động bảo vệ dữ liệu",
  ],
  RISK_DOSSIER_CONTENT: ["hồ sơ phân loại"],
  RISK_DOSSIER_RETENTION: ["lưu giữ hồ sơ", "lưu trữ hồ sơ"],
  MATERIAL_CHANGE_REASSESSMENT: ["thay đổi đáng kể", "đánh giá lại"],
  OPERATIONAL_INFORMATION_MEASURES: ["biện pháp quản lý", "biện pháp kỹ thuật"],
  CHILD_PRIVACY_DISCLOSURE_CONSENT: [
    "từ đủ 7 tuổi",
    "từ đủ bảy tuổi",
    "07 tuổi",
    "7 tuổi",
    "bảy tuổi",
  ],
  UNREVIEWED_DEVELOPER_CONTEXT: ["nhà phát triển", "giai đoạn phát triển"],
};
const file = process.env.LCSP_PREFLIGHT_ENV_FILE,
  id = process.env.LCSP_PREFLIGHT_SOURCE_VERSION_ID;
if (!file || !id || !/^[a-f0-9-]{36}$/i.test(id))
  throw Error("Explicit private env file and selected source UUID required");
const url = parse(readFileSync(file)).DATABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw Error("Local diagnostic database required");
const db = new PrismaClient({ adapter: new PrismaPg(url) });
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
try {
  const evidence = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
      const source = await tx.legalSourceVersion.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          version: true,
          status: true,
          createdAt: true,
          integrityManifestRef: true,
        },
      });
      if (source.status !== LegalSourceLifecycleStatus.ACTIVE)
        throw Error("Selected source is not ACTIVE");
      const columns = await tx.$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='LegalDocumentChunk'`;
      const hasEffect = columns.some(
        (row) => row.column_name === "legalEffectStatus",
      );
      const candidates: Array<{
        caseId: string;
        searchPhrases: string[];
        mappingStatus: string;
        warning: string;
        sourceTextCandidates: Array<{
          id: string;
          documentId: string;
          locator: string;
          contentSha256: string;
          legalStatus: string;
          legalEffectStatus: string;
          sourceText: string;
          sourceSha256: string;
          hashVerified: boolean;
          effectMetadataAvailable: boolean;
        }>;
        actor: null;
        action: null;
        trigger: null;
        lifecycleStage: null;
        developerApplicability: null;
        expectedDecision: null;
        independentReviewerIdentity: null;
        goldRevision: null;
        goldHash: null;
      }> = [];
      for (const [caseId, phrases] of Object.entries(searches)) {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            documentId: string;
            locator: string;
            content: string;
            contentSha256: string;
            legalStatus: string;
            legalEffectStatus: string;
          }>
        >(
          Prisma.sql`SELECT "id","documentId","locator","content","contentSha256","legalStatus",${hasEffect ? Prisma.sql`"legalEffectStatus"::text` : Prisma.sql`'UNKNOWN'`} AS "legalEffectStatus" FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=${id} AND (${Prisma.join(
            phrases.map(
              (phrase) => Prisma.sql`"content" ILIKE ${"%" + phrase + "%"}`,
            ),
            " OR ",
          )}) ORDER BY "documentId","locator","id" LIMIT 5`,
        );
        for (const row of rows)
          if (hash(row.content) !== row.contentSha256.replace(/^sha256:/, ""))
            throw Error("Immutable source text hash mismatch");
        candidates.push({
          caseId,
          searchPhrases: phrases,
          mappingStatus: "PENDING_INDEPENDENT_REVIEW",
          warning:
            "Lexical retrieval candidates only; neither applicability nor a legal disposition has been established",
          sourceTextCandidates: rows.map(({ content, ...row }) => ({
            ...row,
            sourceText: content,
            sourceSha256: hash(content),
            hashVerified: true,
            effectMetadataAvailable: hasEffect,
          })),
          actor: null,
          action: null,
          trigger: null,
          lifecycleStage: null,
          developerApplicability: null,
          expectedDecision: null,
          independentReviewerIdentity: null,
          goldRevision: null,
          goldHash: null,
        });
      }
      return {
        packageKind: "UNREVIEWED_PINNED_LEGAL_RETRIEVAL_CANDIDATES",
        source,
        classificationPerformed: false,
        approvedGold: false,
        candidates,
        requiredIndependentControls: [
          "POSITIVE_DEVELOPMENT",
          "MIXED",
          "LEGAL_REVIEW_REQUIRED",
          "HITL_UNRESOLVED",
        ],
        warning:
          "Original sources are unchanged. An independent legal reviewer must establish the exact effective provision, actor/action/stage, disposition, positive/mixed/HITL controls and immutable gold hash before evaluator admission.",
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
  const output = path.resolve(
    import.meta.dirname,
    "../../../docs/implementation-artifacts/lcsp347-pm-rereview/legal-source-candidates.unreviewed.json",
  );
  const bytes = JSON.stringify(evidence, null, 2) + "\n";
  if (existsSync(output)) {
    const previous = JSON.parse(readFileSync(output, "utf8")) as {
      approvedGold?: boolean;
      candidates?: Array<{
        mappingStatus?: string;
        independentReviewerIdentity?: unknown;
        expectedDecision?: unknown;
        goldHash?: unknown;
      }>;
    };
    if (
      previous.approvedGold ||
      previous.candidates?.some(
        (item) =>
          item.independentReviewerIdentity ||
          item.expectedDecision !== null ||
          item.goldHash ||
          item.mappingStatus !== "PENDING_INDEPENDENT_REVIEW",
      )
    )
      throw Error("Existing legal review evidence must not be overwritten");
  }
  writeFileSync(output, bytes, "utf8");
  console.log(
    JSON.stringify({
      sourceVersionId: id,
      candidateCounts: evidence.candidates.map((item) => ({
        caseId: item.caseId,
        count: item.sourceTextCandidates.length,
      })),
      packageSha256: hash(bytes),
      approvedGold: 0,
    }),
  );
} catch (error: unknown) {
  console.error(
    JSON.stringify({
      status: "BLOCKED_RUNTIME_CONFIGURATION",
      errorClass: error instanceof Error ? error.name : "UNKNOWN",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
