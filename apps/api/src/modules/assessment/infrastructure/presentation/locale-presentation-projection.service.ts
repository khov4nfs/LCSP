import { Injectable } from "@nestjs/common";
import {
  resolveResponseLanguage,
  isSupportedResponseLanguage,
} from "@lcsp/contracts/shared/locale";

const presentationProjectionCache = new Map<string, string>();

export function getPresentationProjection(
  text: string,
  locale: string,
): string | undefined {
  return presentationProjectionCache.get(`${locale}:${text}`);
}

export function registerPresentationProjection(
  text: string,
  locale: string,
  projectedText: string,
): void {
  presentationProjectionCache.set(`${locale}:${text}`, projectedText);
}

export function clearPresentationProjections(): void {
  presentationProjectionCache.clear();
}

/**
 * Service providing locale-aware presentation projection for customer-visible narrative data.
 * Keeps domain and database records strictly canonical while delivering translated representations
 * on demand at the read/presentation boundary.
 */
@Injectable()
export class LocalePresentationProjectionService {
  getPresentationProjection(text: string, locale: string): string | undefined {
    return getPresentationProjection(text, locale);
  }

  registerPresentationProjection(
    text: string,
    locale: string,
    projectedText: string,
  ): void {
    registerPresentationProjection(text, locale, projectedText);
  }

  clearPresentationProjections(): void {
    clearPresentationProjections();
  }

  async projectText(
    text: string,
    targetLocale?: string | null,
  ): Promise<string> {
    const results = await this.projectBatch([text], targetLocale);
    return results.get(text) ?? text;
  }

  async projectBatch(
    texts: string[],
    targetLocale?: string | null,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!texts.length) return result;

    if (!targetLocale || !isSupportedResponseLanguage(targetLocale)) {
      for (const text of texts) {
        result.set(text, text);
      }
      return result;
    }

    const locale = resolveResponseLanguage(targetLocale);
    const missing: string[] = [];
    const isAscii = (str: string) => !/[^\t\n\r\x20-\x7E]/.test(str);

    for (const text of texts) {
      if (!text || text.trim() === "") {
        result.set(text, text);
        continue;
      }
      if (locale === "en" && isAscii(text)) {
        result.set(text, text);
        continue;
      }
      const cached = presentationProjectionCache.get(`${locale}:${text}`);
      if (cached !== undefined) {
        result.set(text, cached);
      } else {
        missing.push(text);
      }
    }

    if (missing.length === 0) {
      return result;
    }

    // Attempt upstream translation via Agent Server runtime if configured
    const agentServerUrl = process.env.LCSP_AGENT_SERVER_URL;
    const workerApiKey = process.env.WORKER_API_KEY;

    if (agentServerUrl && workerApiKey) {
      try {
        const response = await fetch(
          new URL("/internal/project-locale", agentServerUrl),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Worker-Api-Key": workerApiKey,
            },
            body: JSON.stringify({
              texts: missing,
              targetLocale: locale,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (response.ok) {
          const body = (await response.json()) as {
            projected?: Record<string, string>;
          };
          if (body?.projected && typeof body.projected === "object") {
            for (const [orig, projected] of Object.entries(body.projected)) {
              if (typeof projected === "string") {
                presentationProjectionCache.set(`${locale}:${orig}`, projected);
                result.set(orig, projected);
              }
            }
          }
        }
      } catch {
        // Fall back gracefully on network or timeout failure
      }
    }

    // Populate any remaining missing texts from cache (if populated concurrently) or canonical fallback
    for (const text of missing) {
      if (!result.has(text)) {
        const cached = presentationProjectionCache.get(`${locale}:${text}`);
        const finalValue = cached !== undefined ? cached : text;
        result.set(text, finalValue);
      }
    }

    return result;
  }
}
