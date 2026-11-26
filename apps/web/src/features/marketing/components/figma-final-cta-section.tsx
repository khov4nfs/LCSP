"use client";

import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { ArrowRight } from "lucide-react";

export function FigmaFinalCtaSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="figma-final-cta"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px]"
    >
      {/* Technical Form CTA Box with L-shaped corner markers */}
      <div className="relative mx-auto max-w-[800px] rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] px-8 py-14 text-center text-[#3A3A38] shadow-none sm:px-14">
        {/* 4 L-shaped corner markers (10px x 10px) */}
        <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
        <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
        <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

        <h2 className="mx-auto max-w-2xl text-2xl font-bold sm:text-3xl md:text-4xl text-[#1A3C2B] tracking-tight">
          {t("pages.marketing.home.finalCtaSectionTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[#3A3A38] leading-relaxed">
          {t("pages.marketing.home.finalCtaSectionDescription")}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[2px] bg-[#1A3C2B] px-8 text-xs font-mono font-bold tracking-wider uppercase text-[#F7F7F5] border border-[#1A3C2B] transition-all hover:bg-[#23503a] active:translate-y-0.5"
          >
            <span>{t("pages.marketing.home.finalCtaCreateAccount")}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-[2px] border border-[#3A3A38]/30 bg-white px-8 text-xs font-mono font-bold tracking-wider uppercase text-[#1A3C2B] transition-all hover:border-[#1A3C2B] hover:bg-[#FAF9F6] active:translate-y-0.5"
          >
            <span>{t("pages.marketing.home.finalCtaSignIn")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
