import { LOCALES, type Locale } from "@lcsp/contracts/shared";

export const APP_LOCALE_COOKIE = "lcsp_locale";

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${APP_LOCALE_COOKIE}=`))
    ?.split("=")[1];
  return LOCALES.includes(value as Locale) ? (value as Locale) : null;
}

export let appLocale: Locale = "vi";

export function getAppLocaleSnapshot(): Locale {
  return appLocale;
}

export function subscribeToAppLocale(onStoreChange: () => void) {
  window.addEventListener("lcsp:locale-change", onStoreChange);
  return () => window.removeEventListener("lcsp:locale-change", onStoreChange);
}

export function setAppLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  appLocale = locale;
  if (typeof document !== "undefined") {
    document.cookie = `${APP_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("lcsp:locale-change"));
  }
}

export function hydrateAppLocaleFromCookie() {
  const cookieLocale = readCookieLocale();
  if (cookieLocale && cookieLocale !== appLocale) {
    setAppLocale(cookieLocale);
  }
}
