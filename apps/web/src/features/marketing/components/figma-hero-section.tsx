"use client";

import Image from "next/image";
import Link from "next/link";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { useMarketingLocale } from "./marketing-locale";
import { DatabaseIcon, FileTextIcon, ShieldAlertIcon } from "lucide-react";

export function FigmaHeroSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="figma-hero"
      className="relative w-full overflow-hidden bg-gradient-to-r from-[#081C2B] to-[#174950] pt-16 pb-20 text-white"
    >
      {/* Evidence Constellation Graphic (Figma #1795:13205) with subtle floating glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-6 hidden select-none md:block md:w-[500px] lg:w-[610px] animate-pulse-glow"
      >
        <Image
          src="/brand/evidence-constellation.svg"
          alt=""
          width={610}
          height={370}
          priority
          className="h-auto w-full opacity-90 drop-shadow-2xl animate-float-slow"
        />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="max-w-[760px]">
          {/* Eyebrow */}
          <p className="text-xs font-semibold tracking-wider text-[#86E8D4]">
            {t("pages.marketing.home.figmaHeroEyebrow")}
          </p>

          {/* Headline */}
          <h1 className="mt-4 max-w-[680px] text-wrap-balance text-4xl font-semibold leading-[1.1] tracking-tight text-[#F7FBFC] sm:text-5xl md:text-6xl md:leading-[1.08]">
            {t("pages.marketing.home.figmaHeroTitle")}
          </h1>

          {/* Subtitle */}
          <p className="mt-5 max-w-[680px] text-wrap-pretty text-base leading-relaxed text-[#C6D9DE] sm:text-lg">
            {t("pages.marketing.home.figmaHeroDescription")}
          </p>

          {/* Action Buttons */}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/sign-up"
              className="inline-flex h-10 items-center justify-center rounded-[7px] bg-[#31BDA7] px-5 text-sm font-semibold text-[#082B30] transition-all hover:bg-[#3cdbc1] hover:shadow-lg active:scale-95"
            >
              {t("pages.marketing.home.figmaHeroPrimaryCta")}
            </Link>
            <a
              href="#workflow"
              className="inline-flex h-10 items-center justify-center rounded-[7px] border border-[#B9C8D4]/40 bg-white px-5 text-sm font-semibold text-[#101C29] shadow-xs transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95"
            >
              {t("pages.marketing.home.figmaHeroSecondaryCta")}
            </a>
          </div>
        </div>

        {/* Product Preview Card with refined shadows and subtle hover elevation */}
        <div className="mt-14 overflow-hidden rounded-[20px] border border-white/10 bg-[#0E1E28] text-white shadow-2xl transition-all duration-300 hover:shadow-[0_24px_50px_-12px_rgba(10,31,46,0.4)]">
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-slate-600 inline-block" />
              <span className="size-3 rounded-full bg-slate-600 inline-block" />
              <span className="size-3 rounded-full bg-slate-600 inline-block" />
              <span className="ml-3 text-xs font-medium tracking-wider text-[#86E8D4]">
                {t("pages.marketing.home.figmaHeroWorkspaceBadge")}
              </span>
            </div>
            <span className="text-xs text-slate-400">
              {t("pages.marketing.home.figmaHeroWorkspaceSubtitle")}
            </span>
          </div>

          {/* Body: Two Cards Side by Side with nested radius formula (outer 20px - gap 24px -> rounded-xl 12px) */}
          <div className="grid gap-6 p-6 lg:grid-cols-[340px_1fr]">
            {/* Scope Box */}
            <div className="rounded-xl border border-white/10 bg-[#122532] p-5">
              <h2 className="text-base font-semibold text-white">
                {t("pages.marketing.home.figmaHeroScopeTitle")}
              </h2>

              <div className="mt-5 space-y-4">
                <div className="flex items-start gap-3">
                  <DatabaseIcon className="mt-0.5 size-4 text-[#31BDA7]" />
                  <div>
                    <p className="text-[11px] text-slate-400">
                      {t("pages.marketing.home.figmaHeroRepoLabel")}
                    </p>
                    <p className="font-mono text-xs font-semibold text-[#86E8D4]">
                      {t("pages.marketing.home.figmaHeroRepoValue")}
                    </p>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                <div className="flex items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-4 text-[#31BDA7]" />
                  <div>
                    <p className="text-[11px] text-slate-400">
                      {t("pages.marketing.home.figmaHeroLegalSourceLabel")}
                    </p>
                    <p className="text-xs font-semibold text-slate-100">
                      {t("pages.marketing.home.figmaHeroLegalSourceValue")}
                    </p>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                <div className="space-y-1.5 text-xs text-slate-300">
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    <span>{t("pages.marketing.home.figmaHeroRulesEvaluated")}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-amber-400" />
                    <span>{t("pages.marketing.home.figmaHeroOpenRequests")}</span>
                  </p>
                </div>

                {/* Progress outcome segments matching Figma 1757:13011-13014 */}
                <div className="flex h-2 w-full gap-1 overflow-hidden pt-1">
                  <div className="h-full w-[50%] rounded-xs bg-[#0D9488]" title="Compliant" />
                  <div className="h-full w-[25%] rounded-xs bg-[#DC2626]" title="Non-compliant" />
                  <div className="h-full w-[15%] rounded-xs bg-[#D97706]" title="In review" />
                  <div className="h-full w-[10%] rounded-xs bg-[#94A3B8]" title="Unresolved" />
                </div>
              </div>
            </div>

            {/* Finding Box (Dark Card) */}
            <div className="rounded-xl border border-white/10 bg-[#163842] p-6 text-white shadow-inner">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {t("pages.marketing.home.figmaHeroFindingTitle")}
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[#FEF2F8] px-2.5 py-1 text-xs font-semibold text-[#B91C1C]">
                  <ShieldAlertIcon className="size-3.5 text-[#B91C1C]" />
                  {t("pages.marketing.home.figmaHeroOutcomeNonCompliant")}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-[#84D49F]">
                  {t("pages.marketing.home.figmaHeroRequirementLabel")}
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {t("pages.marketing.home.figmaHeroRequirementValue")}
                </p>
              </div>

              <div className="my-4 h-px w-full bg-white/10" />

              <div>
                <p className="text-[11px] font-semibold tracking-wider text-[#84D49F]">
                  {t("pages.marketing.home.figmaHeroEvidenceLabel")}
                </p>
                <div className="mt-2 space-y-1 font-mono text-xs text-slate-200">
                  <p>{t("pages.marketing.home.figmaHeroEvidence1")}</p>
                  <p>{t("pages.marketing.home.figmaHeroEvidence2")}</p>
                </div>
              </div>

              <div className="mt-4 text-xs font-medium text-[#84D49F]">
                {t("pages.marketing.home.figmaHeroConclusion")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
