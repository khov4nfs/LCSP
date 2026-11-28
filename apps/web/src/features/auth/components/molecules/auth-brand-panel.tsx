"use client";

import { resolveMessage } from "@lcsp/i18n";
import { FileTextIcon, GitBranchIcon, Link2Icon } from "lucide-react";

import { useAppLocale } from "@/components/providers/locale-provider";

/**
 * Static product illustration shared by all auth routes; cards describe the workflow and never imply live assessment data.
 * It collapses below xl so tablet and mobile layouts keep the form usable without adding a second scroll region.
 */
export function AuthBrandPanel() {
  const locale = useAppLocale();
  const t = (key: Parameters<typeof resolveMessage>[1]) =>
    resolveMessage(locale, key);

  return (
    <aside
      aria-label={t("pages.authShell.brandPanelLabel")}
      data-figma-node="1751:12617"
      className="relative hidden h-full min-h-0 overflow-hidden rounded-2xl bg-linear-to-br from-[#0D2636] to-[#176061] p-6 text-white xl:flex xl:flex-col xl:justify-between xl:p-8"
    >
      <div
        aria-hidden="true"
        className="absolute -right-16 -top-20 size-56 rounded-full border border-white/25"
      >
        <span className="absolute inset-6 rounded-full border border-white/30" />
        <span className="absolute inset-12 rounded-full border border-dashed border-white/30" />
        <span className="absolute left-10 top-24 size-2 rounded-full bg-teal-300" />
      </div>
      <div>
        <p className="relative text-xs font-semibold tracking-wide text-teal-200">
          {t("pages.authShell.brandEyebrow")}
        </p>
        <h2 className="relative mt-3 max-w-lg whitespace-pre-line text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
          {t("pages.authShell.brandHeadline")}
        </h2>
        <p className="relative mt-2 max-w-lg text-sm leading-5 text-slate-200">
          {t("pages.authShell.brandDescription")}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-teal-200">
          {t("pages.authShell.workflowLabel")}
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-4">
          <article className="rounded-xl bg-[#F4FAF9] p-3.5 text-[#101C29]">
            <div className="flex items-center gap-2.5 font-semibold">
              <span className="rounded-lg bg-[#EAF1F3] p-1.5">
                <FileTextIcon aria-hidden="true" className="size-4" />
              </span>
              {t("pages.authShell.legalSource")}
            </div>
            <p className="mt-2 text-xs leading-4 text-[#48586A]">
              {t("pages.authShell.legalSourceDescription")}
            </p>
          </article>
          <article className="rounded-xl bg-[#EAEDFF] p-3.5 text-[#101C29]">
            <div className="flex items-center gap-2.5 font-semibold">
              <span className="rounded-lg bg-white/70 p-1.5">
                <GitBranchIcon aria-hidden="true" className="size-4" />
              </span>
              {t("pages.authShell.repository")}
            </div>
            <p className="mt-2 text-xs leading-4 text-[#48586A]">
              {t("pages.authShell.repositoryDescription")}
            </p>
          </article>
        </div>
        {/* These decorative branches connect the legal and repository cards to the shared finding card without representing live data. */}
        <div aria-hidden="true" className="relative mx-auto h-8 w-full">
          <span className="absolute left-1/4 top-0 h-5 w-px bg-teal-100/50" />
          <span className="absolute right-1/4 top-0 h-5 w-px bg-teal-100/50" />
          <span className="absolute left-1/4 right-1/4 top-5 h-px bg-teal-100/50" />
          <span className="absolute left-1/2 top-5 h-3 w-px -translate-x-1/2 bg-teal-100/50" />
          <span className="absolute left-1/2 top-5 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal-100 bg-[#176061]" />
        </div>
        <article className="rounded-xl border border-white/25 bg-[#173F4A] p-4">
          <div className="flex items-center gap-2.5 font-semibold">
            <Link2Icon aria-hidden="true" className="size-4" />
            {t("pages.authShell.finding")}
          </div>
          <p className="mt-2 text-xs leading-4 text-slate-200">
            {t("pages.authShell.findingDescription")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/15 pt-3 text-xs text-slate-200">
            <span className="rounded-full bg-[#E2F6F1] px-2.5 py-1 font-medium text-[#087F75]">
              {t("pages.authShell.evidenceLinked")}
            </span>
            <span>{t("pages.authShell.reasoning")}</span>
          </div>
        </article>
      </div>
      <div aria-hidden="true" className="pt-2">
        <div className="relative h-3 border-b border-teal-300/70">
          <span className="absolute bottom-0 left-1/3 size-2 -translate-y-1 rounded-full bg-teal-200" />
          <span className="absolute bottom-0 right-2/5 size-2 -translate-y-1 rounded-full bg-teal-200" />
        </div>
        <p className="mt-3 border-t border-white/20 pt-3 text-xs text-slate-200">
          {t("pages.authShell.brandFooter")}
        </p>
      </div>
    </aside>
  );
}
