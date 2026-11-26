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
      data-section="why-lcsp"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px]"
    >
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
          {t("pages.marketing.home.whyTitle")}
        </h2>
        <p className="mt-3 text-base text-[#48586A]">
          {t("pages.marketing.home.whyDescription")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {/* Large Benefit Card (Left) with Mosaic Blueprint Hairline & Zero Slop */}
        <div className="group flex flex-col justify-between rounded-[16px] border border-slate-200 bg-white p-8 transition-[border-color,box-shadow] duration-200 hover:border-[#31BDA7] hover:shadow-xs">
          <div>
            <div className="flex size-11 items-center justify-center rounded-[10px] border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B] transition-transform duration-200 group-hover:scale-105">
              <ScaleIcon className="size-5" />
            </div>
            <h3 className="mt-6 text-2xl font-semibold text-[#101C29]">
              {t("pages.marketing.home.whyBenefit1Title")}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.whyBenefit1Description")}
            </p>
          </div>

          <div className="mt-8 rounded-[12px] border border-slate-200 bg-slate-50/70 p-6">
            <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-medium text-[#48586A]">
              <div className="rounded-[8px] border border-slate-200/80 bg-white p-2.5 transition-colors hover:text-[#101C29]">
                {t("pages.marketing.home.whyBenefit1Step1")}
              </div>
              <div className="rounded-[8px] border border-slate-200/80 bg-white p-2.5 transition-colors hover:text-[#101C29]">
                {t("pages.marketing.home.whyBenefit1Step2")}
              </div>
              <div className="rounded-[8px] border border-[#31BDA7]/40 bg-[#ECF5F3] p-2.5 text-[#11545B] font-semibold">
                {t("pages.marketing.home.whyBenefit1Step3")}
              </div>
            </div>
            <p className="mt-4 text-center text-xs font-semibold text-[#101C29]">
              {t("pages.marketing.home.whyBenefit1Footer")}
            </p>
          </div>
        </div>

        {/* 3 Stacked Benefit Cards (Right) */}
        <div className="space-y-4">
          {/* Card 2 */}
          <div className="group flex items-start gap-4 rounded-[14px] border border-slate-200 bg-white p-6 transition-[border-color,box-shadow] duration-200 hover:border-[#31BDA7] hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B] transition-transform duration-200 group-hover:scale-105">
              <LinkIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-[#101C29]">
                {t("pages.marketing.home.whyBenefit2Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit2Description")}
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="group flex items-start gap-4 rounded-[14px] border border-slate-200 bg-white p-6 transition-[border-color,box-shadow] duration-200 hover:border-[#31BDA7] hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B] transition-transform duration-200 group-hover:scale-105">
              <MessageSquareIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-[#101C29]">
                {t("pages.marketing.home.whyBenefit3Title")}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit3Description")}
              </p>
            </div>
          </div>

          {/* Card 4 */}
          <div className="group flex items-start gap-4 rounded-[14px] border border-slate-200 bg-white p-6 transition-[border-color,box-shadow] duration-200 hover:border-[#31BDA7] hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B] transition-transform duration-200 group-hover:scale-105">
              <RotateCcwIcon className="size-5" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-[#101C29]">
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
