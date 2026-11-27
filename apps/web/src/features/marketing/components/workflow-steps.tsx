"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { GitBranchIcon, NetworkIcon, CheckCircle2Icon } from "lucide-react";

export function WorkflowSteps() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  const steps = [
    {
      num: t("pages.marketing.home.workflowStep1Number"),
      title: t("pages.marketing.home.workflowStep1Title"),
      desc: t("pages.marketing.home.workflowStep1Description"),
      Icon: GitBranchIcon,
      badge: "Commit Scope Locked",
    },
    {
      num: t("pages.marketing.home.workflowStep2Number"),
      title: t("pages.marketing.home.workflowStep2Title"),
      desc: t("pages.marketing.home.workflowStep2Description"),
      Icon: NetworkIcon,
      badge: "Targeted Inquiries",
    },
    {
      num: t("pages.marketing.home.workflowStep3Number"),
      title: t("pages.marketing.home.workflowStep3Title"),
      desc: t("pages.marketing.home.workflowStep3Description"),
      Icon: CheckCircle2Icon,
      badge: "Automated PR & Checks",
    },
  ];

  return (
    <section
      data-section="workflow-steps"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[120px]"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {t("pages.marketing.home.workflowEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("pages.marketing.home.workflowTitle")}
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          {t("pages.marketing.home.workflowDescription")}
        </p>
      </div>

      <div className="mt-14 grid gap-8 md:grid-cols-3">
        {steps.map(({ num, title, desc, Icon, badge }) => (
          <div
            key={num}
            className="relative flex flex-col justify-between rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/40"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-sm font-semibold text-brand">
                  {num}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {badge}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>

            <div className="mt-6 flex items-center gap-2 pt-4 border-t border-border/60 text-xs text-muted-foreground">
              <Icon className="size-4 text-brand" />
              <span>Step {num} verifiable milestone</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
