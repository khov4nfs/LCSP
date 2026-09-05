import { LOCALES, type Locale } from "@lcsp/contracts/shared/locale";

export const MARKETING_LOCALE_COOKIE = "lcsp_locale";

export function isMarketingLocale(value: string | undefined): value is Locale {
  return value !== undefined && LOCALES.includes(value as Locale);
}

export function getMarketingLocale(value: string | undefined): Locale {
  return isMarketingLocale(value) ? value : "vi";
}

export function stripMarketingLocale(pathname: string): string {
  return pathname.replace(/^\/(en|vi)(?=\/|$)/, "") || "/";
}

export function localizedMarketingPath(
  locale: Locale,
  pathname: string,
): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;
}
