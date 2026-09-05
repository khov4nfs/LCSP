import { notFound } from "next/navigation";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { LOCALES } from "@lcsp/contracts/shared/locale";

import { FeaturesMarketingPage } from "@/features/marketing/components/marketing-pages";
import { marketingMetadata } from "../marketing-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return marketingMetadata(locale as Locale, "features");
}

export default async function LocaleFeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return <FeaturesMarketingPage locale={locale as Locale} />;
}
