"use client";

import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { ArrowRightIcon } from "lucide-react";

export function FigmaHowItWorksSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const steps = [
    {
      num: t("pages.marketing.home.howStep1Num"),
      title: t("pages.marketing.home.howStep1Title"),
      desc: t("pages.marketing.home.howStep1Desc"),
      tag: "Source Sync",
    },
    {
      num: t("pages.marketing.home.howStep2Num"),
      title: t("pages.marketing.home.howStep2Title"),
      desc: t("pages.marketing.home.howStep2Desc"),
      tag: "AST Parsing",
    },
    {
      num: t("pages.marketing.home.howStep3Num"),
      title: t("pages.marketing.home.howStep3Title"),
      desc: t("pages.marketing.home.howStep3Desc"),
      tag: "Evidence Verdict",
    },
    {
      num: t("pages.marketing.home.howStep4Num"),
      title: t("pages.marketing.home.howStep4Title"),
      desc: t("pages.marketing.home.howStep4Desc"),
      tag: "CI/CD Gate",
    },
  ];

  return (
    <section
      id="workflow"
      data-section="figma-how-it-works"
      className="relative w-full overflow-hidden bg-[#ECF5F3] py-20 text-[#101C29]"
    >
      {/* Vercel subtle grid lines background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-grid-slate opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_50%,transparent_90%)]"
      />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 scroll-reveal">
          <div>
            <p className="text-xs font-semibold tracking-wider text-[#11545B]">
              {t("pages.marketing.home.howWorkflowEyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
              {t("pages.marketing.home.howWorkflowTitle")}
            </h2>
            <p className="mt-2 text-base text-[#48586A]">
              {t("pages.marketing.home.howWorkflowDescription")}
            </p>
          </div>

          <div className="hidden lg:flex items-center gap-2 rounded-full border border-[#11545B]/20 bg-white/80 px-3 py-1 text-xs font-mono text-[#11545B]">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Deterministic Pipeline • Zero Hallucinations
          </div>
        </div>

        {/* 4 Steps with Connected Pipeline Line */}
        <div className="relative mt-12">
          {/* Connecting SVG Circuit Line for Desktop */}
          <div aria-hidden="true" className="pointer-events-none absolute top-12 left-0 right-0 hidden lg:block px-12">
            <svg className="w-full h-2 overflow-visible" fill="transparent">
              <line
                x1="0"
                y1="0"
                x2="100%"
                y2="0"
                stroke="#B9D5D1"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <line
                x1="0"
                y1="0"
                x2="100%"
                y2="0"
                stroke="#31BDA7"
                strokeWidth="2"
                className="animate-circuit-pulse"
              />
            </svg>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 relative z-10">
            {steps.map(({ num, title, desc, tag }, index) => (
              <div
                key={num}
                className={`scroll-reveal scroll-delay-${index + 1} group relative flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white/90 backdrop-blur-xs p-6 shadow-xs transition-all duration-300 hover:-translate-y-1.5 hover:border-[#31BDA7] hover:shadow-lg`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold font-mono text-[#31BDA7] transition-transform duration-300 inline-block group-hover:scale-110">
                      {num}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono font-medium text-slate-500">
                      {tag}
                    </span>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-[#101C29]">
                    {title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
                    {desc}
                  </p>
                </div>

                <div className="mt-6 flex items-center gap-1.5 text-xs font-semibold text-[#11545B] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <span>Step {index + 1} specification</span>
                  <ArrowRightIcon className="size-3.5" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-[7px] border border-slate-300 bg-white px-5 text-sm font-semibold text-[#101C29] shadow-xs transition-all duration-200 hover:bg-slate-50 hover:border-slate-400 hover:shadow-sm active:scale-95"
          >
            {t("pages.marketing.home.howStartCta")}
          </Link>
          <span className="text-xs text-slate-500 font-mono">
            Integrates in under 5 minutes via GitHub App or CLI
          </span>
        </div>
      </div>
    </section>
  );
}
