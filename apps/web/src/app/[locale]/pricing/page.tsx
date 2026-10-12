import { notFound } from "next/navigation";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { LOCALES } from "@lcsp/contracts/shared/locale";

import { PricingMarketingPage } from "@/features/marketing/components/marketing-pages";
import { marketingMetadata } from "../marketing-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return marketingMetadata(locale as Locale, "pricing");
}

export default async function LocalePricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return <PricingMarketingPage locale={locale as Locale} />;
}
