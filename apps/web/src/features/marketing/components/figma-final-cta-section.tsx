"use client";

import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";

export function FigmaFinalCtaSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="figma-final-cta"
      className="mx-auto w-full max-w-[1440px] px-8 py-16 md:px-[96px]"
    >
      <div className="rounded-[18px] bg-[#0A2633] px-8 py-12 text-center text-white shadow-xl sm:px-14">
        <h2 className="mx-auto max-w-2xl text-2xl font-semibold sm:text-3xl md:text-4xl">
          {t("pages.marketing.home.finalCtaSectionTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[#86E8D4]">
          {t("pages.marketing.home.finalCtaSectionDescription")}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-[7px] bg-[#46D5B5] px-6 text-sm font-semibold text-[#102A38] shadow-sm transition-all duration-200 hover:bg-[#58e2c3] hover:shadow-md active:scale-95"
          >
            {t("pages.marketing.home.finalCtaCreateAccount")}
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-[7px] border border-slate-300 bg-white px-6 text-sm font-semibold text-[#101C29] shadow-sm transition-all duration-200 hover:bg-slate-50 hover:border-slate-400 active:scale-95"
          >
            {t("pages.marketing.home.finalCtaSignIn")}
          </Link>
        </div>
      </div>
    </section>
  );
}
