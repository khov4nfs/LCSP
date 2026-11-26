"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { ScaleIcon, LinkIcon, MessageSquareIcon, RotateCcwIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function FigmaWhySection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="why-lcsp"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px] border-b border-[#3A3A38]/10"
    >
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold mb-3">
          <span className="h-1.5 w-1.5 bg-[#1A3C2B]" />
          <span>EVIDENCE REASONING</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-[#1A3C2B] sm:text-4xl">
          {t("pages.marketing.home.whyTitle")}
        </h2>
        <p className="mt-3 text-base text-[#3A3A38]">
          {t("pages.marketing.home.whyDescription")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Large Benefit Card (Left) with Paper background, 1px hairline, Mint border accent */}
        <div className="group flex flex-col justify-between rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#1A3C2B] bg-[#FAF9F6] p-8 transition-all hover:bg-white">
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-[2px] border border-[#1A3C2B]/30 bg-white text-[#1A3C2B]">
              <ScaleIcon className="h-5 w-5" />
            </div>
            <h3 className="mt-6 text-2xl font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.whyBenefit1Title")}
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-[#3A3A38] font-sans">
              {t("pages.marketing.home.whyBenefit1Description")}
            </p>
          </div>

          <div className="mt-8 rounded-[2px] border border-[#3A3A38]/20 bg-white p-5">
            <div className="grid grid-cols-3 gap-2 text-center font-mono text-[11px] text-[#3A3A38]">
              <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-2 font-medium">
                {t("pages.marketing.home.whyBenefit1Step1")}
              </div>
              <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-2 font-medium">
                {t("pages.marketing.home.whyBenefit1Step2")}
              </div>
              <div className="rounded-[2px] border border-[#1A3C2B] bg-[#9EFFBF]/30 p-2 text-[#1A3C2B] font-bold">
                {t("pages.marketing.home.whyBenefit1Step3")}
              </div>
            </div>
            <p className="mt-3 text-center font-mono text-[11px] font-bold text-[#1A3C2B] uppercase tracking-wider">
              {t("pages.marketing.home.whyBenefit1Footer")}
            </p>
          </div>
        </div>

        {/* 3 Stacked Benefit Cards (Right) */}
        <div className="space-y-4">
          {/* Card 2 */}
          <div className="group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#FF8C69] bg-[#FAF9F6] p-5 transition-all hover:bg-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <LinkIcon className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit2Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#3A3A38]">
                {t("pages.marketing.home.whyBenefit2Description")}
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#9EFFBF] bg-[#FAF9F6] p-5 transition-all hover:bg-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <MessageSquareIcon className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit3Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#3A3A38]">
                {t("pages.marketing.home.whyBenefit3Description")}
              </p>
            </div>
          </div>

          {/* Card 4 */}
          <div className="group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#F4D35E] bg-[#FAF9F6] p-5 transition-all hover:bg-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <RotateCcwIcon className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit4Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#3A3A38]">
                {t("pages.marketing.home.whyBenefit4Description")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
