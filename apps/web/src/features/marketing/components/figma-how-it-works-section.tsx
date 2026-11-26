"use client";

import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";

export function FigmaHowItWorksSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const steps = [
    {
      num: t("pages.marketing.home.howStep1Num"),
      title: t("pages.marketing.home.howStep1Title"),
      desc: t("pages.marketing.home.howStep1Desc"),
    },
    {
      num: t("pages.marketing.home.howStep2Num"),
      title: t("pages.marketing.home.howStep2Title"),
      desc: t("pages.marketing.home.howStep2Desc"),
    },
    {
      num: t("pages.marketing.home.howStep3Num"),
      title: t("pages.marketing.home.howStep3Title"),
      desc: t("pages.marketing.home.howStep3Desc"),
    },
    {
      num: t("pages.marketing.home.howStep4Num"),
      title: t("pages.marketing.home.howStep4Title"),
      desc: t("pages.marketing.home.howStep4Desc"),
    },
  ];

  return (
    <section
      id="workflow"
      data-section="figma-how-it-works"
      className="w-full bg-[#ECF5F3] py-20 text-[#101C29]"
    >
      <div className="mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <p className="text-xs font-semibold tracking-wider text-[#11545B]">
          {t("pages.marketing.home.howWorkflowEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
          {t("pages.marketing.home.howWorkflowTitle")}
        </h2>
        <p className="mt-2 text-base text-[#48586A]">
          {t("pages.marketing.home.howWorkflowDescription")}
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ num, title, desc }) => (
            <div
              key={num}
              className="group flex flex-col justify-between rounded-xl border border-slate-200/60 bg-white p-6 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-[#31BDA7]/50 hover:shadow-md"
            >
              <div>
                <span className="text-2xl font-bold text-[#31BDA7] transition-transform duration-300 inline-block group-hover:scale-110">
                  {num}
                </span>
                <h3 className="mt-4 text-base font-semibold text-[#101C29]">
                  {title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-[7px] border border-slate-300 bg-white px-5 text-sm font-semibold text-[#101C29] shadow-xs transition-all duration-200 hover:bg-slate-50 hover:border-slate-400 active:scale-95"
          >
            {t("pages.marketing.home.howStartCta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
