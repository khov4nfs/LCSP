import { createHash, randomUUID } from "node:crypto";
import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
  HttpStatus,
} from "@nestjs/common";
import {
  Prisma,
  AuthoredLocalizationLocale,
  AuthoredLocalizationState,
} from "@prisma/client";
import {
  AUTHORED_LOCALIZATION_CODES,
  AUTHORED_LOCALIZATION_ENTITIES,
  authoredTranslationResponseSchema,
  type AuthoredLocalizationEntity,
  localizedReportArtifactSchema,
  LOCALIZED_REPORT_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../http/filters/error.factory.js";

const digest = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const authoredKeys = new Set([
  "title",
  "concept",
  "proposition",
  "legalIntent",
  "applicabilityGuidance",
  "applicabilityConditions",
  "qualifiers",
  "exceptions",
  "nonAssessableReason",
  "description",
  "investigationFocus",
  "investigationGoals",
  "rationale",
  "summary",
  "analysisSummary",
  "workSummary",
  "recommendations",
  "question",
  "unresolvedFact",
  "decisionImpact",
  "resolutionAttempts",
  "label",
  "normativeStatement",
]);
const protectedKeys = new Set([
  "sources",
  "sourceRefs",
  "sourceSupport",
  "support",
  "quote",
  "quotation",
  "quotes",
  "evidence",
  "references",
  "answers",
  "answer",
  "facts",
  "acceptedFacts",
  "repositoryPath",
  "storageRef",
]);

/** Extract authored narratives only; canonical source/evidence/user material is excluded. */
export function authoredFields(
  value: unknown,
  path = "",
  inherited = false,
): Array<{ path: string; text: string }> {
  if (typeof value === "string")
    return inherited && value.trim() ? [{ path, text: value }] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      authoredFields(item, `${path}/${index}`, inherited),
    );
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    protectedKeys.has(key)
      ? []
      : authoredFields(
          item,
          `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`,
          authoredKeys.has(key),
        ),
  );
}

/** Transactional queue insertion; no provider is called in the business transaction. */
export async function enqueueAuthoredDocument(
  tx: Prisma.TransactionClient,
  input: {
    scopeId: string;
    entityType: AuthoredLocalizationEntity;
    entityId: string;
    canonicalRevision: string;
    document: unknown;
    originalLanguage?: AuthoredLocalizationLocale;
  },
) {
  const canonicalDigest = digest(canonicalJson(input.document));
  for (const field of authoredFields(input.document))
    for (const locale of [
      AuthoredLocalizationLocale.EN,
      AuthoredLocalizationLocale.VI,
    ]) {
      const originSha256 = digest(field.text);
      const idempotencyKey = digest(
        canonicalJson([
          input.scopeId,
          input.entityType,
          input.entityId,
          input.canonicalRevision,
          canonicalDigest,
          field.path,
          locale,
          1,
        ]),
      );
      await tx.authoredLocalizationRequest.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          id: randomUUID(),
          idempotencyKey,
          scopeId: input.scopeId,
          entityType: input.entityType,
          entityId: input.entityId,
          canonicalRevision: input.canonicalRevision,
          canonicalDigest,
          fieldPath: field.path,
          locale,
          originalLanguage: input.originalLanguage ?? null,
          originalContent: field.text,
          originSha256,
        },
      });
    }
}

/** Durable bounded translation poller. Provider invocation is opt-in deployment configuration. */
@Injectable()
export class AuthoredLocalizationService
  implements OnModuleInit, OnModuleDestroy
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.LCSP_AUTHORED_TRANSLATION_WORKER_ENABLED !== "1") return;
    this.timer = setInterval(() => {
      void this.drain().catch(() => undefined);
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const token = randomUUID();
      await this.prisma.authoredLocalizationRequest.updateMany({
        where: {
          state: AuthoredLocalizationState.PENDING,
          attempts: { gte: 5 },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        data: {
          state: AuthoredLocalizationState.FAILED,
          errorCode: AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string }>
      >(Prisma.sql`
        UPDATE "AuthoredLocalizationRequest" SET "leaseToken"=${token}, "leaseUntil"=NOW()+INTERVAL '60 seconds', "attempts"="attempts"+1
        WHERE "id" IN (SELECT "id" FROM "AuthoredLocalizationRequest"
          WHERE "state"='PENDING' AND "nextAttemptAt"<=NOW() AND ("leaseUntil" IS NULL OR "leaseUntil"<NOW())
          ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING "id"`);
      await Promise.all(rows.map((row) => this.translate(row.id, token)));
    } finally {
      this.running = false;
    }
  }

  private async translate(id: string, token: string) {
    const job = await this.prisma.authoredLocalizationRequest.findUniqueOrThrow(
      { where: { id } },
    );
    if (job.leaseToken !== token) return;
    try {
      const locale = job.locale === AuthoredLocalizationLocale.EN ? "en" : "vi";
      let result: { content: string; engine: string; engineVersion: string };
      if (job.originalLanguage === job.locale)
        result = {
          content: job.originalContent,
          engine: "CANONICAL_ORIGINAL",
          engineVersion: "1",
        };
      else {
        const url = process.env.LCSP_AUTHORED_TRANSLATION_URL;
        const key = process.env.LCSP_AUTHORED_TRANSLATION_KEY;
        if (!url || !key)
          throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_UNAVAILABLE);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            locale,
            originalLanguage: job.originalLanguage,
            content: job.originalContent,
            originSha256: job.originSha256,
          }),
        });
        if (!response.ok)
          throw new Error(AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED);
        const parsed = authoredTranslationResponseSchema.parse(
          await response.json(),
        );
        if (
          parsed.locale !== locale ||
          parsed.originSha256 !== job.originSha256
        )
          throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
        result = {
          content: parsed.content,
          engine: parsed.engine,
          engineVersion: parsed.engineVersion,
        };
      }
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.authoredLocalizationRequest.updateMany({
          where: {
            id,
            leaseToken: token,
            state: AuthoredLocalizationState.PENDING,
          },
          data: {
            state: AuthoredLocalizationState.READY,
            leaseToken: null,
            leaseUntil: null,
            errorCode: null,
          },
        });
        if (!claimed.count) return;
        await tx.authoredLocalizedRevision.create({
          data: {
            id: randomUUID(),
            requestId: id,
            ...result,
            contentSha256: digest(result.content),
          },
        });
      });
    } catch {
      await this.prisma.authoredLocalizationRequest.updateMany({
        where: { id, leaseToken: token },
        data: {
          state:
            job.attempts >= 5
              ? AuthoredLocalizationState.FAILED
              : AuthoredLocalizationState.PENDING,
          errorCode: AUTHORED_LOCALIZATION_CODES.TRANSLATION_FAILED,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600, 2 ** job.attempts) * 1000,
          ),
        },
      });
    }
  }

  /** Caller must authorize the scope before invoking this read-only projection. */
  async project(
    texts: string[],
    locale: string,
    scopeId: string,
    binding?: {
      entityId: string;
      entityType?: AuthoredLocalizationEntity;
      canonicalDigest?: string;
      canonicalRevision?: string;
    },
  ): Promise<Map<string, string>> {
    if (locale !== "en" && locale !== "vi")
      throw new Error("Unsupported localization locale");
    const requested = [...new Set(texts.filter((text) => text.trim()))];
    const target =
      locale === "en"
        ? AuthoredLocalizationLocale.EN
        : AuthoredLocalizationLocale.VI;
    const rows = await this.prisma.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        locale: target,
        translationRevision: 1,
        ...(binding ?? {}),
        originSha256: { in: requested.map(digest) },
      },
      include: { revision: true },
    });
    const result = new Map<string, string>();
    for (const text of requested) {
      const matches = rows.filter((row) => row.originSha256 === digest(text));
      const ready = matches.filter(
        (row) => row.state === AuthoredLocalizationState.READY && row.revision,
      );
      const variants = new Set(ready.map((row) => row.revision!.contentSha256));
      if (
        !ready.length ||
        variants.size !== 1 ||
        ready.some(
          (row) =>
            digest(row.revision!.content) !== row.revision!.contentSha256,
        )
      ) {
        throw problemException(
          AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
          randomUUID(),
          {
            status: HttpStatus.CONFLICT,
            meta: {
              locale,
              state: matches.some(
                (row) => row.state === AuthoredLocalizationState.FAILED,
              )
                ? AuthoredLocalizationState.FAILED
                : AuthoredLocalizationState.PENDING,
            },
          },
        );
      }
      result.set(text, ready[0].revision!.content);
    }
    for (const text of texts) if (!text.trim()) result.set(text, text);
    return result;
  }

  /** Version-bound narrative overlay. Identifiers, legal quotations, facts and canonical hashes stay original. */
  async projectDocument<T>(
    document: T,
    locale: string,
    scopeId: string,
    binding: {
      entityType: AuthoredLocalizationEntity;
      entityId: string;
      canonicalRevision: string;
    },
  ): Promise<T> {
    const fields = authoredFields(document);
    const values = await this.project(
      fields.map((field) => field.text),
      locale,
      scopeId,
      binding,
    );
    const output = structuredClone(document);
    for (const field of fields) {
      const keys = field.path
        .slice(1)
        .split("/")
        .map((key) => key.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      let target: unknown = output;
      for (const key of keys.slice(0, -1))
        target = (target as Record<string, unknown>)[key];
      (target as Record<string, unknown>)[keys.at(-1)!] = values.get(
        field.text,
      )!;
    }
    return output;
  }

  /** Frozen locale overlays reference the canonical artifact; source bytes never change. */
  async localizedReportDocument(
    scopeId: string,
    sourceArtifactId: string,
    sourceSha256: string,
    report: unknown,
    locale: string,
  ) {
    const artifact = await this.localizedReport(
      scopeId,
      sourceArtifactId,
      sourceSha256,
      report,
      locale,
    );
    const overlay = localizedReportArtifactSchema.parse(
      JSON.parse(Buffer.from(artifact.content).toString("utf8")),
    );
    const allowed = new Set(authoredFields(report).map((field) => field.path));
    const document = structuredClone(report);
    for (const [path, content] of Object.entries(overlay.localizedFields)) {
      if (!allowed.has(path))
        throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
      const keys = path
        .slice(1)
        .split("/")
        .map((key) => key.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      let target: unknown = document;
      for (const key of keys.slice(0, -1))
        target = (target as Record<string, unknown>)[key];
      (target as Record<string, unknown>)[keys.at(-1)!] = content;
    }
    return document;
  }

  async localizedReport(
    scopeId: string,
    sourceArtifactId: string,
    sourceSha256: string,
    report: unknown,
    locale: string,
  ) {
    const target =
      locale === "en"
        ? AuthoredLocalizationLocale.EN
        : AuthoredLocalizationLocale.VI;
    const key = {
      scopeId,
      sourceArtifactId,
      locale: target,
      translationRevision: 1,
    };
    const existing = await this.prisma.localizedReportArtifact.findUnique({
      where: { scopeId_sourceArtifactId_locale_translationRevision: key },
    });
    if (existing) {
      if (
        existing.sourceSha256 !== sourceSha256 ||
        digest(Buffer.from(existing.content).toString("utf8")) !==
          existing.contentSha256
      )
        throw new Error(AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID);
      return existing;
    }
    const fields = authoredFields(report);
    const values = await this.project(
      fields.map((field) => field.text),
      locale,
      scopeId,
      {
        entityId: sourceArtifactId,
        canonicalDigest: digest(canonicalJson(report)),
      },
    );
    const id = randomUUID();
    const overlay = localizedReportArtifactSchema.parse({
      schemaVersion: LOCALIZED_REPORT_SCHEMA_VERSION,
      localizedArtifactId: id,
      sourceArtifactId,
      sourceSha256,
      locale,
      translationRevision: 1,
      localizedFields: Object.fromEntries(
        fields.map((field) => [field.path, values.get(field.text)!]),
      ),
    });
    const content = Buffer.from(JSON.stringify(overlay), "utf8");
    return this.prisma.localizedReportArtifact.upsert({
      where: { scopeId_sourceArtifactId_locale_translationRevision: key },
      update: {},
      create: {
        id,
        ...key,
        sourceSha256,
        content,
        contentSha256: digest(content.toString("utf8")),
      },
    });
  }

  /** Explicit operator backfill. Cursor advances only after all rows commit. Replays are idempotent. */
  async backfillBatch(
    scopeId: string,
    entityType: AuthoredLocalizationEntity,
    after: string | null,
    limit = 10,
  ) {
    if (!scopeId || !Number.isInteger(limit) || limit < 1 || limit > 25)
      throw new Error("Invalid backfill bounds");
    const page = {
      take: limit,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    };
    const records: Array<{
      cursor: string;
      entityId: string;
      canonicalRevision: string;
      document: unknown;
    }> = [];
    if (entityType === AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT) {
      for (const row of await this.prisma.legalRequirement.findMany({
        ...page,
        where: { ruleSetVersionId: scopeId },
        orderBy: { id: "asc" },
      }))
        records.push({
          cursor: row.id,
          entityId: row.legalRequirementId,
          canonicalRevision: row.contentDigest,
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE) {
      for (const row of await this.prisma.assessmentRule.findMany({
        ...page,
        where: { ruleSetVersionId: scopeId },
        orderBy: { id: "asc" },
      }))
        records.push({
          cursor: row.id,
          entityId: row.assessmentRuleId,
          canonicalRevision: row.contentDigest,
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.DECISION) {
      for (const row of await this.prisma.assessmentRuleDecision.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { decisionId: { gt: after } } : {}),
        },
        orderBy: { decisionId: "asc" },
      }))
        records.push({
          cursor: row.decisionId,
          entityId: row.decisionId,
          canonicalRevision: String(row.decisionRevision),
          document: row.decision,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.HUMAN_REQUEST) {
      for (const row of await this.prisma.assessmentHumanRequest.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { requestId: { gt: after } } : {}),
        },
        orderBy: { requestId: "asc" },
      }))
        records.push({
          cursor: row.requestId,
          entityId: row.requestId,
          canonicalRevision: String(row.requestRevision),
          document: row,
        });
    } else if (entityType === AUTHORED_LOCALIZATION_ENTITIES.EVENT) {
      for (const row of await this.prisma.assessmentEvent.findMany({
        take: limit,
        where: {
          assessmentId: scopeId,
          ...(after ? { eventId: { gt: after } } : {}),
        },
        orderBy: { eventId: "asc" },
      }))
        records.push({
          cursor: row.eventId,
          entityId: row.eventId,
          canonicalRevision: String(row.sequence),
          document: row.payload,
        });
    } else {
      throw new Error(
        "Report backfill requires verified canonical artifact bytes",
      );
    }
    for (const row of records)
      await this.prisma.$transaction((tx) =>
        enqueueAuthoredDocument(tx, { scopeId, entityType, ...row }),
      );
    return {
      processed: records.length,
      nextCursor: records.at(-1)?.cursor ?? after,
      complete: records.length < limit,
    };
  }
}
