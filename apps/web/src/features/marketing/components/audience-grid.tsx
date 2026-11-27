"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { TerminalIcon, ScaleIcon, AwardIcon, CheckIcon } from "lucide-react";

export function AudienceGrid() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const roles = [
    {
      title: t("pages.marketing.home.audienceRole1Title"),
      desc: t("pages.marketing.home.audienceRole1Description"),
      points: [
        t("pages.marketing.home.audienceRole1Point1"),
        t("pages.marketing.home.audienceRole1Point2"),
      ],
      Icon: TerminalIcon,
      accent: "border-l-[#1A3C2B]",
    },
    {
      title: t("pages.marketing.home.audienceRole2Title"),
      desc: t("pages.marketing.home.audienceRole2Description"),
      points: [
        t("pages.marketing.home.audienceRole2Point1"),
        t("pages.marketing.home.audienceRole2Point2"),
      ],
      Icon: ScaleIcon,
      accent: "border-l-[#FF8C69]",
    },
    {
      title: t("pages.marketing.home.audienceRole3Title"),
      desc: t("pages.marketing.home.audienceRole3Description"),
      points: [
        t("pages.marketing.home.audienceRole3Point1"),
        t("pages.marketing.home.audienceRole3Point2"),
      ],
      Icon: AwardIcon,
      accent: "border-l-[#F4D35E]",
    },
  ];

  return (
    <section
      data-section="who-it-is-for"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[120px]"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {t("pages.marketing.home.audienceEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("pages.marketing.home.audienceTitle")}
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          {t("pages.marketing.home.audienceDescription")}
        </p>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-3">
        {roles.map(({ title, desc, points, Icon, accent }) => (
          <div
            key={title}
            className={`flex flex-col justify-between rounded-[2px] border border-[#3A3A38]/30 border-l-4 ${accent} bg-[#FAF9F6] p-7 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white`}
          >
            <div>
              <div className="flex size-11 items-center justify-center rounded-[2px] border border-[#3A3A38]/20 bg-white text-[#1A3C2B]">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-5 text-xl font-bold text-[#1A3C2B]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#3A3A38]">{desc}</p>

              <ul className="mt-6 space-y-3">
                {points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-xs text-[#3A3A38]">
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[#1A3C2B]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
