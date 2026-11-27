"use client";

import { useMarketingLocale } from "./marketing-locale";
import { GitHubLogo, GitLabLogo, BitbucketLogo, AzureDevOpsLogo } from "./provider-logos";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";

const providers = [
  { name: "GitHub", Icon: GitHubLogo, status: "Active / Cloud & Enterprise" },
  { name: "GitLab", Icon: GitLabLogo, status: "Active / SaaS & Self-Managed" },
  { name: "Bitbucket", Icon: BitbucketLogo, status: "Active / Cloud & Data Center" },
  { name: "Azure DevOps", Icon: AzureDevOpsLogo, status: "Active / Services & Server" },
] as const;

export function ProviderLogoStrip() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="provider-logos"
      aria-label={t("pages.marketing.home.providerStripTitle")}
      className="mx-auto w-full max-w-[1440px] px-8 py-16 md:px-[120px]"
    >
      <div className="rounded-2xl border border-border bg-card/60 p-8 backdrop-blur-sm sm:p-10">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("pages.marketing.home.providerStripTitle")}
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {t("pages.marketing.home.providerStripDescription")}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {providers.map(({ name, Icon, status }) => (
            <div
              key={name}
              className="group flex flex-col items-center justify-center rounded-xl border border-border/80 bg-background/80 p-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm"
            >
              <div className="flex size-12 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:text-brand">
                <Icon size={26} />
              </div>
              <span className="mt-3 text-sm font-medium text-foreground">{name}</span>
              <span className="mt-1 text-[11px] text-muted-foreground">{status}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
