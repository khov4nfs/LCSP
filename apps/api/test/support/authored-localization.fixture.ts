import { createHash } from "node:crypto";
import {
  AuthoredLocalizationLocale,
  AuthoredLocalizationState,
} from "@prisma/client";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import { AuthoredLocalizationService } from "../../src/platform/localization/authored-localization.service.js";
import { LocalePresentationProjectionService } from "../../src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.js";

/** Unit-test persistence double. Production projection code runs unchanged; no HTTP translator or cache helper. */
export function authoredLocalizationFixture(
  initial: Record<string, string> = {},
) {
  const translations = new Map(Object.entries(initial));
  const pathTranslations = new Map<string, { text: string; vi: string }>();
  const requestedTexts: string[] = [];
  const artifacts = new Map<
    string,
    {
      id: string;
      sourceSha256: string;
      content: Buffer;
      contentSha256: string;
      scopeId: string;
      sourceArtifactId: string;
      locale: AuthoredLocalizationLocale;
      translationRevision: number;
    }
  >();
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const prisma = {
    authoredLocalizationRequest: {
      findMany: ({
        where,
      }: {
        where: {
          scopeId?: string;
          entityType?: string;
          entityId?: string;
          canonicalRevision?: string;
          canonicalDigest?: string;
          fieldPath?: { in: string[] } | string;
          locale: AuthoredLocalizationLocale;
          originSha256: { in: string[] };
        };
      }) => {
        const requestedPaths =
          typeof where.fieldPath === "string"
            ? [where.fieldPath]
            : (where.fieldPath?.in ?? [""]);
        const rows: Array<Record<string, unknown>> = [];
        for (const [fieldPath, entry] of pathTranslations) {
          if (!where.originSha256.in.includes(hash(entry.text))) continue;
          if (where.fieldPath && !requestedPaths.includes(fieldPath)) continue;
          requestedTexts.push(entry.text);
          const content =
            where.locale === AuthoredLocalizationLocale.EN
              ? entry.text
              : entry.vi;
          rows.push({
            scopeId: where.scopeId,
            entityType: where.entityType,
            entityId: where.entityId,
            canonicalRevision: where.canonicalRevision,
            canonicalDigest: where.canonicalDigest,
            fieldPath,
            locale: where.locale,
            originSha256: hash(entry.text),
            originalContent: entry.text,
            translationRevision: 1,
            state: AuthoredLocalizationState.READY,
            translationReviewedBy: "isolated-unit-fixture",
            translationReviewedAt: new Date(),
            revision: {
              content,
              contentSha256: hash(content),
              engine: "isolated-unit-fixture",
            },
          });
        }
        for (const [text, vi] of translations) {
          if (!where.originSha256.in.includes(hash(text))) continue;
          requestedTexts.push(text);
          const content =
            where.locale === AuthoredLocalizationLocale.EN ? text : vi;
          for (const fieldPath of requestedPaths) {
            if (pathTranslations.has(fieldPath)) continue;
            rows.push({
              scopeId: where.scopeId,
              entityType: where.entityType,
              entityId: where.entityId,
              canonicalRevision: where.canonicalRevision,
              canonicalDigest: where.canonicalDigest,
              fieldPath,
              locale: where.locale,
              originSha256: hash(text),
              originalContent: text,
              translationRevision: 1,
              state: AuthoredLocalizationState.READY,
              translationReviewedBy: "isolated-unit-fixture",
              translationReviewedAt: new Date(),
              revision: {
                content,
                contentSha256: hash(content),
                engine: "isolated-unit-fixture",
              },
            });
          }
        }
        return Promise.resolve(rows);
      },
    },
    localizedReportArtifact: {
      findUnique: ({
        where,
      }: {
        where: { scopeId_sourceArtifactId_locale_translationRevision: object };
      }) =>
        Promise.resolve(
          artifacts.get(
            JSON.stringify(
              where.scopeId_sourceArtifactId_locale_translationRevision,
            ),
          ) ?? null,
        ),
      upsert: ({
        where,
        create,
      }: {
        where: { scopeId_sourceArtifactId_locale_translationRevision: object };
        create: {
          id: string;
          sourceSha256: string;
          content: Buffer;
          contentSha256: string;
          scopeId: string;
          sourceArtifactId: string;
          locale: AuthoredLocalizationLocale;
          translationRevision: number;
        };
      }) => {
        const key = JSON.stringify(
          where.scopeId_sourceArtifactId_locale_translationRevision,
        );
        if (!artifacts.has(key)) artifacts.set(key, create);
        return Promise.resolve(artifacts.get(key)!);
      },
    },
  } as unknown as PrismaService;
  const service = new AuthoredLocalizationService(prisma);
  return {
    service,
    projection: new LocalePresentationProjectionService(service),
    requestedTexts,
    seed: (text: string, vi: string) => translations.set(text, vi),
    seedPath: (fieldPath: string, text: string, vi: string) =>
      pathTranslations.set(fieldPath, { text, vi }),
    clear: () => {
      translations.clear();
      pathTranslations.clear();
    },
  };
}
