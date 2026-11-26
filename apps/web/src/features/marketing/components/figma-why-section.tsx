"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { ScaleIcon, LinkIcon, MessageSquareIcon, RotateCcwIcon } from "lucide-react";

export function FigmaWhySection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      id="why-lcsp"
      data-section="why-lcsp"
      className="mx-auto w-full max-w-[1440px] px-8 pt-12 pb-20 md:px-[96px]"
    >
      <div className="max-w-2xl scroll-reveal">
        <h2 className="text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
          {t("pages.marketing.home.whyTitle")}
        </h2>
        <p className="mt-3 text-base text-[#48586A]">
          {t("pages.marketing.home.whyDescription")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Large Benefit Card (Left): Features-style box with crisp hairlines, corner markers, and inner code panel */}
        <div className="scroll-reveal scroll-delay-1 relative group flex flex-col justify-between rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] p-8 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white">
          {/* Subtle L-shaped corner markers */}
          <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
          <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

          <div>
            <div className="flex size-11 items-center justify-center rounded-[2px] border border-[#1A3C2B]/30 bg-white text-[#1A3C2B]">
              <ScaleIcon className="size-5" />
            </div>
            <h3 className="mt-6 text-2xl font-bold tracking-tight text-[#1A3C2B]">
              {t("pages.marketing.home.whyBenefit1Title")}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.whyBenefit1Description")}
            </p>
          </div>

          <div className="mt-8 rounded-[2px] border border-[#3A3A38]/20 bg-white p-5 font-mono">
            <div className="grid grid-cols-3 gap-2.5 text-center text-xs text-[#48586A]">
              <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-2.5 font-medium">
                {t("pages.marketing.home.whyBenefit1Step1")}
              </div>
              <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-2.5 font-medium">
                {t("pages.marketing.home.whyBenefit1Step2")}
              </div>
              <div className="rounded-[2px] border border-[#1A3C2B] bg-[#9EFFBF]/30 p-2.5 text-[#1A3C2B] font-bold">
                {t("pages.marketing.home.whyBenefit1Step3")}
              </div>
            </div>
            <p className="mt-4 text-center text-xs font-bold uppercase tracking-wider text-[#1A3C2B]">
              {t("pages.marketing.home.whyBenefit1Footer")}
            </p>
          </div>
        </div>

        {/* 3 Stacked Benefit Cards (Right) */}
        <div className="space-y-4">
          {/* Card 2 */}
          <div className="scroll-reveal scroll-delay-2 group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#1A3C2B] bg-[#FAF9F6] p-6 transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white shadow-none">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <LinkIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit2Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit2Description")}
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="scroll-reveal scroll-delay-3 group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#FF8C69] bg-[#FAF9F6] p-6 transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white shadow-none">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <MessageSquareIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit3Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit3Description")}
              </p>
            </div>
          </div>

          {/* Card 4 */}
          <div className="scroll-reveal scroll-delay-4 group flex items-start gap-4 rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#F4D35E] bg-[#FAF9F6] p-6 transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white shadow-none">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <RotateCcwIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#1A3C2B]">
                {t("pages.marketing.home.whyBenefit4Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit4Description")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
