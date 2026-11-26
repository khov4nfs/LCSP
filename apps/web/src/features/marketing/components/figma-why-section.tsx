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
        {/* Large Benefit Card (Left) */}
        <div className="group flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-8 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7]/50 hover:shadow-md">
          <div>
            <div className="flex size-12 items-center justify-center rounded-xl bg-[#ECF5F3] text-[#31BDA7] transition-transform duration-300 group-hover:scale-110">
              <ScaleIcon className="size-6" />
            </div>
            <h3 className="mt-6 text-2xl font-semibold text-[#101C29]">
              {t("pages.marketing.home.whyBenefit1Title")}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.whyBenefit1Description")}
            </p>
          </div>

          <div className="mt-8 rounded-xl bg-slate-50 p-6">
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium text-[#48586A]">
              <div className="rounded-lg bg-white p-2.5 shadow-xs transition-colors hover:text-[#101C29]">
                {t("pages.marketing.home.whyBenefit1Step1")}
              </div>
              <div className="rounded-lg bg-white p-2.5 shadow-xs transition-colors hover:text-[#101C29]">
                {t("pages.marketing.home.whyBenefit1Step2")}
              </div>
              <div className="rounded-lg bg-white p-2.5 shadow-xs text-[#31BDA7] font-semibold">
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
          <div className="group flex items-start gap-4 rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#31BDA7]/40 hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#ECF5F3] text-[#31BDA7] transition-transform duration-200 group-hover:scale-105">
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
          <div className="group flex items-start gap-4 rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#31BDA7]/40 hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#ECF5F3] text-[#31BDA7] transition-transform duration-200 group-hover:scale-105">
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
          <div className="group flex items-start gap-4 rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#31BDA7]/40 hover:shadow-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#ECF5F3] text-[#31BDA7] transition-transform duration-200 group-hover:scale-105">
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
