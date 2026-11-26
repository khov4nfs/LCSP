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
        {/* Main Large Card (Evidence-led assessment) styled like Features Preview Box */}
        <div className="relative group rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] p-8 text-[#3A3A38] shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white">
          {/* L-shaped corner markers */}
          <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
          <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

          <span className="inline-block rounded-[2px] border border-[#1A3C2B]/30 bg-white px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#1A3C2B]">
            {t("pages.marketing.home.capabilitiesMainEyebrow")}
          </span>
          <h3 className="mt-4 text-2xl font-bold tracking-tight text-[#1A3C2B]">
            {t("pages.marketing.home.capabilitiesMainTitle")}
          </h3>
          <p className="mt-1 font-mono text-xs text-[#48586A]">
            {t("pages.marketing.home.capabilitiesMainTag")}
          </p>

          <div className="mt-6 rounded-[2px] border border-[#3A3A38]/20 bg-white p-6 shadow-none">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#48586A] font-semibold">
              {t("pages.marketing.home.capabilitiesMainReqLabel")}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1A3C2B]">
              {t("pages.marketing.home.capabilitiesMainReqValue")}
            </p>

            <div className="my-4 h-px w-full bg-[#3A3A38]/10" />

            <p className="font-mono text-[10px] uppercase tracking-wider text-[#48586A] font-semibold">
              {t("pages.marketing.home.capabilitiesMainEvidenceLabel")}
            </p>
            <div className="mt-2 space-y-1 font-mono text-xs text-[#3A3A38] bg-[#FAF9F6] p-3 rounded-[2px] border border-[#3A3A38]/10">
              <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence1")}</p>
              <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence2")}</p>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-[2px] border border-[#FF8C69]/40 bg-[#FF8C69]/15 p-3 text-xs">
              <ShieldAlertIcon className="size-4 text-[#FF8C69] shrink-0" />
              <span className="font-bold text-[#1A3C2B] font-mono text-[11px] uppercase tracking-wider">
                {t("pages.marketing.home.capabilitiesMainStatus")}:
              </span>
              <span className="text-[#3A3A38]">
                {t("pages.marketing.home.capabilitiesMainStatusDetail")}
              </span>
            </div>
          </div>
        </div>

        {/* 2 Right Column Cards styled with colored left-borders */}
        <div className="flex flex-col justify-between gap-6">
          {/* Card 2: Information request */}
          <div className="group rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#F4D35E] bg-[#FAF9F6] p-7 text-[#101C29] transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white shadow-none">
            <div className="flex size-10 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <MessageCircleIcon className="size-5" />
            </div>
            <h4 className="mt-5 text-lg font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.capabilitiesCard2Title")}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
              {t("pages.marketing.home.capabilitiesCard2Description")}
            </p>
          </div>

          {/* Card 3: Selective re-evaluation */}
          <div className="group rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#9EFFBF] bg-[#FAF9F6] p-7 text-[#101C29] transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white shadow-none">
            <div className="flex size-10 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
              <TargetIcon className="size-5" />
            </div>
            <h4 className="mt-5 text-lg font-bold text-[#1A3C2B]">
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
