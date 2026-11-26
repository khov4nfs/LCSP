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
      className="relative w-full overflow-hidden bg-[#F4F9F8] py-20 text-[#101C29] scroll-mt-24 border-b border-slate-200/60"
    >
      {/* Vercel subtle grid lines background */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-grid-slate opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_90%)]" 
      />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="max-w-2xl scroll-reveal">
          <p className="text-xs font-semibold tracking-wider text-[#11545B] uppercase font-mono">
            {locale === "vi" ? "Đặc điểm cốt lõi" : "Core Value Proposition"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
            {t("pages.marketing.home.whyTitle")}
          </h2>
          <p className="mt-3 text-base text-[#48586A]">
            {t("pages.marketing.home.whyDescription")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* Large Benefit Card (Left): Clean modern card matching How It Works */}
          <div className="scroll-reveal scroll-delay-1 group relative flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white/95 p-8 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
            <div>
              <div className="flex size-12 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B] transition-transform duration-300 group-hover:scale-105">
                <ScaleIcon className="size-6 text-[#11545B]" />
              </div>
              <h3 className="mt-6 text-2xl font-bold tracking-tight text-[#101C29]">
                {t("pages.marketing.home.whyBenefit1Title")}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.whyBenefit1Description")}
              </p>
            </div>

            <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50/80 p-5 font-mono">
              <div className="grid grid-cols-3 gap-2.5 text-center text-xs text-[#48586A]">
                <div className="rounded-md border border-slate-200 bg-white p-2.5 font-medium shadow-2xs">
                  {t("pages.marketing.home.whyBenefit1Step1")}
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-2.5 font-medium shadow-2xs">
                  {t("pages.marketing.home.whyBenefit1Step2")}
                </div>
                <div className="rounded-md border border-[#31BDA7]/40 bg-[#31BDA7]/15 p-2.5 text-[#11545B] font-bold shadow-2xs">
                  {t("pages.marketing.home.whyBenefit1Step3")}
                </div>
              </div>
              <p className="mt-4 text-center text-xs font-bold uppercase tracking-wider text-[#11545B]">
                {t("pages.marketing.home.whyBenefit1Footer")}
              </p>
            </div>
          </div>

          {/* 3 Stacked Benefit Cards (Right) */}
          <div className="space-y-4">
            {/* Card 2 */}
            <div className="scroll-reveal scroll-delay-2 group flex items-start gap-4 rounded-xl border border-slate-200/90 bg-white/95 p-6 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B]">
                <LinkIcon className="size-5 text-[#11545B]" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#101C29]">
                  {t("pages.marketing.home.whyBenefit2Title")}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                  {t("pages.marketing.home.whyBenefit2Description")}
                </p>
              </div>
            </div>

            {/* Card 3 */}
            <div className="scroll-reveal scroll-delay-3 group flex items-start gap-4 rounded-xl border border-slate-200/90 bg-white/95 p-6 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B]">
                <MessageSquareIcon className="size-5 text-[#11545B]" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#101C29]">
                  {t("pages.marketing.home.whyBenefit3Title")}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                  {t("pages.marketing.home.whyBenefit3Description")}
                </p>
              </div>
            </div>

            {/* Card 4 */}
            <div className="scroll-reveal scroll-delay-4 group flex items-start gap-4 rounded-xl border border-slate-200/90 bg-white/95 p-6 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B]">
                <RotateCcwIcon className="size-5 text-[#11545B]" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#101C29]">
                  {t("pages.marketing.home.whyBenefit4Title")}
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#48586A]">
                  {t("pages.marketing.home.whyBenefit4Description")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
