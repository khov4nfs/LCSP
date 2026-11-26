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
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px]"
    >
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
          {t("pages.marketing.home.capabilitiesTitle")}
        </h2>
        <p className="mt-3 text-base text-[#48586A]">
          {t("pages.marketing.home.capabilitiesDescription")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Main Large Card (Evidence-led assessment) with subtle hover depth */}
        <div className="group rounded-[20px] bg-[#0A2633] p-8 text-white shadow-md transition-all duration-300 hover:shadow-xl">
          <span className="inline-block rounded-md bg-[#fac041]/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-[#31BDA7]">
            {t("pages.marketing.home.capabilitiesMainEyebrow")}
          </span>
          <h3 className="mt-4 text-2xl font-semibold text-white">
            {t("pages.marketing.home.capabilitiesMainTitle")}
          </h3>
          <p className="mt-1 text-xs text-[#C6DFE1]">
            {t("pages.marketing.home.capabilitiesMainTag")}
          </p>

          <div className="mt-6 rounded-xl border border-slate-700/80 bg-white/5 p-6 text-slate-100 backdrop-blur-xs transition-colors group-hover:border-[#31BDA7]/30">
            <p className="text-xs text-[#86E8D4]">
              {t("pages.marketing.home.capabilitiesMainReqLabel")}
            </p>
            <p className="mt-1 text-sm font-medium">
              {t("pages.marketing.home.capabilitiesMainReqValue")}
            </p>

            <div className="my-4 h-px w-full bg-white/10" />

            <p className="text-xs text-[#86E8D4]">
              {t("pages.marketing.home.capabilitiesMainEvidenceLabel")}
            </p>
            <div className="mt-2 space-y-1 font-mono text-xs text-slate-300">
              <p>{t("pages.marketing.home.capabilitiesMainEvidence1")}</p>
              <p>{t("pages.marketing.home.capabilitiesMainEvidence2")}</p>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-lg bg-rose-500/10 p-3 text-xs">
              <ShieldAlertIcon className="size-4 text-rose-400" />
              <span className="font-semibold text-rose-300">
                {t("pages.marketing.home.capabilitiesMainStatus")}:
              </span>
              <span className="text-slate-300">
                {t("pages.marketing.home.capabilitiesMainStatusDetail")}
              </span>
            </div>
          </div>
        </div>

        {/* 2 Right Column Cards */}
        <div className="flex flex-col justify-between gap-6">
          {/* Card 2: Information request (Yellow/Orange tint) */}
          <div className="group rounded-[20px] border border-[#F0D6AB] bg-[#FFF5E3] p-7 text-[#101C29] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 transition-transform duration-300 group-hover:scale-110">
              <MessageCircleIcon className="size-5" />
            </div>
            <h4 className="mt-5 text-lg font-semibold text-[#101C29]">
              {t("pages.marketing.home.capabilitiesCard2Title")}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.capabilitiesCard2Description")}
            </p>
          </div>

          {/* Card 3: Selective re-evaluation (Teal tint) */}
          <div className="group rounded-[20px] border border-[#B6DDD5] bg-[#fac041]/10 p-7 text-[#101C29] shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#31BDA7]/15 text-[#11545B] transition-transform duration-300 group-hover:scale-110">
              <TargetIcon className="size-5" />
            </div>
            <h4 className="mt-5 text-lg font-semibold text-[#101C29]">
              {t("pages.marketing.home.capabilitiesCard3Title")}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.capabilitiesCard3Description")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
