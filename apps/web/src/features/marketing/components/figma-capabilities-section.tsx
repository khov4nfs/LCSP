"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { MessageCircleIcon, TargetIcon, ShieldAlertIcon } from "lucide-react";

export function FigmaCapabilitiesSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="figma-capabilities"
      className="relative w-full overflow-hidden bg-white py-20 text-[#101C29] border-b border-slate-200/60"
    >
      {/* Vercel subtle grid lines background */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-grid-slate opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_90%)]" 
      />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="max-w-2xl scroll-reveal">
          <p className="text-xs font-semibold tracking-wider text-[#11545B] uppercase font-mono">
            {locale === "vi" ? "Năng lực kiểm toán" : "Audit Capabilities"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
            {t("pages.marketing.home.capabilitiesTitle")}
          </h2>
          <p className="mt-3 text-base text-[#48586A]">
            {t("pages.marketing.home.capabilitiesDescription")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* Main Large Card (Evidence-led assessment) */}
          <div className="scroll-reveal scroll-delay-1 group relative rounded-xl border border-slate-200/90 bg-white/95 p-8 text-[#101C29] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
            <span className="inline-block rounded-md border border-[#31BDA7]/30 bg-[#ECF5F3] px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-[#11545B]">
              {t("pages.marketing.home.capabilitiesMainEyebrow")}
            </span>
            <h3 className="mt-4 text-2xl font-bold tracking-tight text-[#101C29]">
              {t("pages.marketing.home.capabilitiesMainTitle")}
            </h3>
            <p className="mt-1 font-mono text-xs text-[#48586A]">
              {t("pages.marketing.home.capabilitiesMainTag")}
            </p>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-6 shadow-2xs">
              <p className="font-mono text-[11px] uppercase tracking-wider text-[#48586A] font-semibold">
                {t("pages.marketing.home.capabilitiesMainReqLabel")}
              </p>
              <p className="mt-1 text-sm font-semibold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesMainReqValue")}
              </p>

              <div className="my-4 h-px w-full bg-slate-200" />

              <p className="font-mono text-[11px] uppercase tracking-wider text-[#48586A] font-semibold">
                {t("pages.marketing.home.capabilitiesMainEvidenceLabel")}
              </p>
              <div className="mt-2 space-y-1 font-mono text-xs text-[#334155] bg-white p-3.5 rounded-md border border-slate-200">
                <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence1")}</p>
                <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence2")}</p>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs">
                <ShieldAlertIcon className="size-4 text-amber-600 shrink-0" />
                <span className="font-bold text-amber-900 font-mono text-[11px] uppercase tracking-wider">
                  {t("pages.marketing.home.capabilitiesMainStatus")}:
                </span>
                <span className="text-amber-800">
                  {t("pages.marketing.home.capabilitiesMainStatusDetail")}
                </span>
              </div>
            </div>
          </div>

          {/* 2 Right Column Cards styled with smooth modern cards */}
          <div className="flex flex-col justify-between gap-6">
            {/* Card 2: Information request */}
            <div className="scroll-reveal scroll-delay-2 group rounded-xl border border-slate-200/90 bg-white/95 p-7 text-[#101C29] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
              <div className="flex size-11 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B]">
                <MessageCircleIcon className="size-5 text-[#11545B]" />
              </div>
              <h4 className="mt-5 text-lg font-bold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesCard2Title")}
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.capabilitiesCard2Description")}
              </p>
            </div>

            {/* Card 3: Selective re-evaluation */}
            <div className="scroll-reveal scroll-delay-3 group rounded-xl border border-slate-200/90 bg-white/95 p-7 text-[#101C29] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7] hover:shadow-md">
              <div className="flex size-11 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-[#ECF5F3] text-[#11545B]">
                <TargetIcon className="size-5 text-[#11545B]" />
              </div>
              <h4 className="mt-5 text-lg font-bold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesCard3Title")}
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.capabilitiesCard3Description")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
