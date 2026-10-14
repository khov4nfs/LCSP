export const LOCALES = ["en", "vi"] as const;

export type Locale = (typeof LOCALES)[number];

export const RESPONSE_LANGUAGES = {
  en: "en",
  vi: "vi",
} as const;

export type ResponseLanguage =
  (typeof RESPONSE_LANGUAGES)[keyof typeof RESPONSE_LANGUAGES];

export const DEFAULT_RESPONSE_LANGUAGE: ResponseLanguage = RESPONSE_LANGUAGES.vi;

export function isSupportedResponseLanguage(
  value: unknown,
): value is ResponseLanguage {
  return (
    typeof value === "string" &&
    Object.values(RESPONSE_LANGUAGES).includes(value as ResponseLanguage)
  );
}

export function resolveResponseLanguage(
  value: unknown,
  fallback: ResponseLanguage = DEFAULT_RESPONSE_LANGUAGE,
): ResponseLanguage {
  return isSupportedResponseLanguage(value) ? value : fallback;
}

