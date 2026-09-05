"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@lcsp/contracts/shared/locale";

import { resolveMessage } from "@lcsp/i18n";

import {
  localizedMarketingPath,
  MARKETING_LOCALE_COOKIE,
  stripMarketingLocale,
} from "../config/marketing-routing";
import { useMarketingLocale } from "./marketing-locale";

export function LanguageSwitcher() {
  const locale = useMarketingLocale();
  const pathname = usePathname() ?? "/";
  const withoutLocale = stripMarketingLocale(pathname);

  function hrefFor(nextLocale: Locale) {
    return localizedMarketingPath(nextLocale, withoutLocale);
  }

  function select(nextLocale: Locale) {
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `${MARKETING_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  const t = (key: string) =>
    resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <nav
      aria-label={t("pages.marketing.nav.languageSwitcherLabel")}
      className="flex h-9 items-center rounded-lg border border-border bg-muted p-0.5 text-[11px] font-semibold"
    >
      {(["en", "vi"] as const).map((option) => (
        <Link
          key={option}
          href={hrefFor(option)}
          onClick={() => select(option)}
          aria-current={locale === option ? "true" : undefined}
          className={`rounded-md px-2 py-1.5 ${locale === option ? "bg-background text-brand shadow-sm" : "text-muted-foreground"}`}
        >
          {option.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
