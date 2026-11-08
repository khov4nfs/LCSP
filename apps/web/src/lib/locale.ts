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

/**
 * Business purpose: Switch presentation language and synchronize the authoritative BFF cookie.
 * Business rules:
 * - Only supported locales are accepted; persist the cookie before notifying query consumers.
 * Execution flow:
 * 1. Validate locale, persist cookie, update document language and notify reactive subscribers.
 * Failure cases:
 * - Unsupported locales are ignored; server execution does not access browser globals.
 * Side effects:
 * - Updates the locale store, browser cookie and document language; dispatches the locale-change event.
 */
export function setAppLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  // Persist before notifying subscribers: the BFF gives this cookie priority
  // over request headers, including requests started by React Query retries.
  if (typeof document !== "undefined") {
    document.cookie = `${APP_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  if (appLocale === locale) {
    if (
      typeof document !== "undefined" &&
      document.documentElement.lang !== locale
    ) {
      document.documentElement.lang = locale;
    }
    return;
  }
  appLocale = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.cookie = `${APP_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("lcsp:locale-change"));
  }
}

/**
 * Business purpose: Initialize presentation language consistently with BFF request authority.
 * Business rules:
 * - A supported supplied locale establishes both the store and cookie; otherwise retain the existing cookie locale.
 * Execution flow:
 * 1. Apply the validated initial locale or load the supported browser cookie.
 * Failure cases:
 * - Missing or unsupported locale data leaves the existing store unchanged.
 * Side effects:
 * - Initializes the locale store, document language and supplied-locale cookie without emitting a switch event.
 */
export function initAppLocale(initialLocale?: Locale) {
  if (initialLocale && LOCALES.includes(initialLocale)) {
    appLocale = initialLocale;
    if (typeof document !== "undefined") {
      document.documentElement.lang = initialLocale;
      document.cookie = `${APP_LOCALE_COOKIE}=${initialLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
    return;
  }
  const cookieLocale = readCookieLocale();
  if (cookieLocale) {
    appLocale = cookieLocale;
    if (typeof document !== "undefined") {
      document.documentElement.lang = cookieLocale;
    }
  }
}

export function hydrateAppLocaleFromCookie() {
  const cookieLocale = readCookieLocale();
  if (cookieLocale && cookieLocale !== appLocale) {
    setAppLocale(cookieLocale);
  }
}
