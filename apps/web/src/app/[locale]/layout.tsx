import { notFound } from "next/navigation";
import type { Locale } from "@lcsp/contracts/shared/locale";

import { LOCALES } from "@lcsp/contracts/shared/locale";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  return children;
}
