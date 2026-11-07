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
  const requestedTexts: string[] = [];
  const artifacts = new Map<
    string,
    { id: string; sourceSha256: string; content: Buffer; contentSha256: string }
  >();
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const prisma = {
    authoredLocalizationRequest: {
      findMany: ({
        where,
      }: {
        where: {
          locale: AuthoredLocalizationLocale;
          originSha256: { in: string[] };
        };
      }) =>
        Promise.resolve(
          [...translations]
            .filter(([text]) => where.originSha256.in.includes(hash(text)))
            .map(([text, vi]) => {
              requestedTexts.push(text);
              const content =
                where.locale === AuthoredLocalizationLocale.EN ? text : vi;
              return {
                originSha256: hash(text),
                state: AuthoredLocalizationState.READY,
                revision: { content, contentSha256: hash(content) },
              };
            }),
        ),
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
    clear: () => translations.clear(),
  };
}
