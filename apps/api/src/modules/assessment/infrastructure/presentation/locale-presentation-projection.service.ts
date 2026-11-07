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

  /**
   * Business purpose: Read or freeze a locale artifact bound to the immutable report source.
   *
   * Business rules:
   * - Canonical report bytes and source identity cannot be rewritten by localization.
   * Execution flow:
   * 1. Delegate to the durable localization service with exact scope, artifact and source digest.
   * Failure cases:
   * - Missing or inconsistent translations propagate an explicit incomplete/integrity failure.
   * Side effects:
   * - May persist a new immutable localized artifact after all translations are ready.
   */
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

  /**
   * Business purpose: Return one persisted locale-specific authored string.
   *
   * Business rules:
   * - Canonical reads remain available when no locale is requested; localized reads never guess another language.
   * Execution flow:
   * 1. Resolve the text through the shared batch projection and retrieve its exact result.
   * Failure cases:
   * - Unavailable or invalid locale projections propagate explicit errors.
   * Side effects:
   * - Read durable translation records without making provider calls.
   */
  async projectText(
    text: string,
    targetLocale: string | null | undefined,
    scopeId: string,
  ): Promise<string> {
    const projected = await this.projectBatch([text], targetLocale, scopeId);
    return projected.get(text)!;
  }

  /**
   * Business purpose: Project authored strings from durable locale revisions.
   *
   * Business rules:
   * - Requested locale and authorized scope are required; entity/revision bindings constrain reuse when supplied.
   * Execution flow:
   * 1. Validate locale/scope and delegate the requested texts and binding to persistent projection.
   * Failure cases:
   * - Invalid locale/scope or unavailable translations return an actionable conflict.
   * Side effects:
   * - Database reads only; no process-local cache or GET-time translation.
   */
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
