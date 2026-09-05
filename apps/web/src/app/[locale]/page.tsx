import { notFound } from "next/navigation";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { LOCALES } from "@lcsp/contracts/shared/locale";

import { ProductMarketingPage } from "@/features/marketing/components/marketing-pages";
import { marketingMetadata } from "./marketing-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return marketingMetadata(locale as Locale, "product");
}

export default async function LocaleProductPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return <ProductMarketingPage locale={locale as Locale} />;
}
