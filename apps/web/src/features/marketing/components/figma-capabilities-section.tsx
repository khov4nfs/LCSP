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
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[96px] border-b border-[#3A3A38]/10"
    >
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold mb-3">
          <span className="h-1.5 w-1.5 bg-[#1A3C2B]" />
          <span>BLUEPRINT CAPABILITIES</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-[#1A3C2B] sm:text-4xl">
          {t("pages.marketing.home.capabilitiesTitle")}
        </h2>
        <p className="mt-3 text-base text-[#3A3A38]">
          {t("pages.marketing.home.capabilitiesDescription")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Main Large Card (Evidence-led assessment) with Paper background & Coral/Forest Accent */}
        <div className="group rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#1A3C2B] bg-[#FAF9F6] p-8 text-[#3A3A38] transition-all hover:bg-white">
          <span className="inline-block rounded-[2px] border border-[#1A3C2B]/30 bg-white px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#1A3C2B]">
            {t("pages.marketing.home.capabilitiesMainEyebrow")}
          </span>
          <h3 className="mt-4 text-2xl font-bold text-[#1A3C2B]">
            {t("pages.marketing.home.capabilitiesMainTitle")}
          </h3>
          <p className="mt-1 font-mono text-xs text-[#3A3A38]/80">
            {t("pages.marketing.home.capabilitiesMainTag")}
          </p>

          <div className="mt-6 rounded-[2px] border border-[#3A3A38]/20 bg-white p-6">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
              {t("pages.marketing.home.capabilitiesMainReqLabel")}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1A3C2B]">
              {t("pages.marketing.home.capabilitiesMainReqValue")}
            </p>

            <div className="my-4 h-px w-full bg-[#3A3A38]/10" />

            <p className="font-mono text-[10px] uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
              {t("pages.marketing.home.capabilitiesMainEvidenceLabel")}
            </p>
            <div className="mt-2 space-y-1 font-mono text-xs text-[#3A3A38] bg-[#FAF9F6] p-3 rounded-[2px] border border-[#3A3A38]/10">
              <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence1")}</p>
              <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence2")}</p>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-[2px] border border-[#FF8C69]/40 bg-[#FF8C69]/15 p-3 text-xs">
              <ShieldAlertIcon className="h-4 w-4 text-[#FF8C69] shrink-0" />
              <span className="font-bold text-[#1A3C2B] font-mono text-[11px] uppercase tracking-wider">
                {t("pages.marketing.home.capabilitiesMainStatus")}:
              </span>
              <span className="text-[#3A3A38]">
                {t("pages.marketing.home.capabilitiesMainStatusDetail")}
              </span>
            </div>
          </div>
        </div>

        {/* 2 Right Column Cards */}
        <div className="flex flex-col justify-between gap-6">
          {/* Card 2: Information request (Gold accent) */}
          <div className="group rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#F4D35E] bg-[#FAF9F6] p-7 transition-all hover:bg-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <MessageCircleIcon className="h-4 w-4" />
            </div>
            <h4 className="mt-4 text-lg font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.capabilitiesCard2Title")}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.capabilitiesCard2Description")}
            </p>
          </div>

          {/* Card 3: Selective re-evaluation (Mint accent) */}
          <div className="group rounded-[2px] border border-[#3A3A38]/20 border-l-4 border-l-[#9EFFBF] bg-[#FAF9F6] p-7 transition-all hover:bg-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <TargetIcon className="h-4 w-4" />
            </div>
            <h4 className="mt-4 text-lg font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.capabilitiesCard3Title")}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.capabilitiesCard3Description")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
