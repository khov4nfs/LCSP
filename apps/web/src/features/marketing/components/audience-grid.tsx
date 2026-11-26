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
    },
    {
      title: t("pages.marketing.home.audienceRole2Title"),
      desc: t("pages.marketing.home.audienceRole2Description"),
      points: [
        t("pages.marketing.home.audienceRole2Point1"),
        t("pages.marketing.home.audienceRole2Point2"),
      ],
      Icon: ScaleIcon,
    },
    {
      title: t("pages.marketing.home.audienceRole3Title"),
      desc: t("pages.marketing.home.audienceRole3Description"),
      points: [
        t("pages.marketing.home.audienceRole3Point1"),
        t("pages.marketing.home.audienceRole3Point2"),
      ],
      Icon: AwardIcon,
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
        {roles.map(({ title, desc, points, Icon }) => (
          <div
            key={title}
            className="flex flex-col justify-between rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/40"
          >
            <div>
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Icon className="size-5" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>

              <ul className="mt-6 space-y-3">
                {points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-xs text-foreground/90">
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
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
