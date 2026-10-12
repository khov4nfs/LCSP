import { resolveMessage } from "@lcsp/i18n";
import type { Metadata } from "next";
import type { Locale } from "@lcsp/contracts/shared/locale";

type MarketingPage = "product" | "features" | "pricing";

export function marketingMetadata(
  locale: Locale,
  page: MarketingPage,
): Metadata {
  const title = resolveMessage(
    locale,
    `pages.marketing.metadata.${page}Title` as Parameters<
      typeof resolveMessage
    >[1],
  );
  const description = resolveMessage(
    locale,
    `pages.marketing.metadata.${page}Description` as Parameters<
      typeof resolveMessage
    >[1],
  );
  const path = page === "product" ? "" : `/${page}`;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}${path}`,
      languages: { en: `/en${path}`, vi: `/vi${path}` },
    },
  };
}
