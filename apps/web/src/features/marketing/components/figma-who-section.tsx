"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { Code2Icon, ScaleIcon, CheckCircle2Icon } from "lucide-react";
import { GitHubLogo, GitLabLogo, BitbucketLogo, AzureDevOpsLogo } from "./provider-logos";

export function FigmaWhoSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const teams = [
    {
      title: t("pages.marketing.home.whoTeam1Title"),
      desc: t("pages.marketing.home.whoTeam1Desc"),
      Icon: Code2Icon,
    },
    {
      title: t("pages.marketing.home.whoTeam2Title"),
      desc: t("pages.marketing.home.whoTeam2Desc"),
      Icon: ScaleIcon,
    },
    {
      title: t("pages.marketing.home.whoTeam3Title"),
      desc: t("pages.marketing.home.whoTeam3Desc"),
      Icon: CheckCircle2Icon,
    },
  ];

  return (
    <section
      data-section="figma-who"
      className="w-full bg-[#0A2633] py-20 text-white"
    >
      <div className="mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {t("pages.marketing.home.whoTitle")}
        </h2>
        <p className="mt-3 max-w-2xl text-base text-[#C6DFE1]">
          {t("pages.marketing.home.whoDescription")}
        </p>

        {/* 3 Audience Cards */}
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {teams.map(({ title, desc, Icon }) => (
            <div
              key={title}
              className="group flex flex-col justify-between rounded-xl border border-slate-700/80 bg-white p-7 text-[#101C29] shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <div>
                <div className="flex size-11 items-center justify-center rounded-lg bg-[#ECF5F3] text-[#31BDA7] transition-transform duration-300 group-hover:scale-110">
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-[#101C29]">
                  {title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[#48586A]">
                  {desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Provider Logos Bar (Positioned inside Who Section as in Figma #1766:13037) */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-white/10 pt-8">
          <p className="text-xs text-[#C6DFE1]">
            {t("pages.marketing.home.whoGitConnectLabel")}
          </p>

          <div className="flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-2.5 text-white/90">
              <GitHubLogo size={22} />
              <span className="text-xs font-medium">GitHub</span>
            </div>
            <div className="flex items-center gap-2.5 text-white/90">
              <GitLabLogo size={22} />
              <span className="text-xs font-medium">GitLab</span>
            </div>
            <div className="flex items-center gap-2.5 text-white/90">
              <BitbucketLogo size={22} />
              <span className="text-xs font-medium">Bitbucket</span>
            </div>
            <div className="flex items-center gap-2.5 text-white/90">
              <AzureDevOpsLogo size={22} />
              <span className="text-xs font-medium">Azure DevOps</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
