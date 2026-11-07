import { Injectable, HttpStatus } from "@nestjs/common";
import { isSupportedResponseLanguage } from "@lcsp/contracts/shared/locale";
import {
  AUTHORED_LOCALIZATION_CODES,
  type AuthoredLocalizationEntity,
} from "@lcsp/contracts/assessment-domain";
import { AuthoredLocalizationService } from "../../../../platform/localization/authored-localization.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { randomUUID } from "node:crypto";

/** Durable projection only. No provider calls, language guessing or local cache. */
@Injectable()
export class LocalePresentationProjectionService {
  constructor(private readonly localization: AuthoredLocalizationService) {}

  localizedReport(
    scopeId: string,
    sourceArtifactId: string,
    sourceSha256: string,
    report: unknown,
    locale: string,
  ) {
    return this.localization.localizedReport(
      scopeId,
      sourceArtifactId,
      sourceSha256,
      report,
      locale,
    );
  }

  async projectText(
    text: string,
    targetLocale: string | null | undefined,
    scopeId: string,
  ): Promise<string> {
    const projected = await this.projectBatch([text], targetLocale, scopeId);
    return projected.get(text)!;
  }

  async projectBatch(
    texts: string[],
    targetLocale: string | null | undefined,
    scopeId: string,
    binding?: {
      entityType: AuthoredLocalizationEntity;
      entityId: string;
      canonicalRevision: string;
    },
  ): Promise<Map<string, string>> {
    if (!targetLocale) return new Map(texts.map((text) => [text, text]));
    if (!scopeId || !isSupportedResponseLanguage(targetLocale))
      throw problemException(
        AUTHORED_LOCALIZATION_CODES.INCOMPLETE,
        randomUUID(),
        { status: HttpStatus.CONFLICT },
      );
    return this.localization.project(texts, targetLocale, scopeId, binding);
  }
}
