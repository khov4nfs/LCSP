"use client";

import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  Code2Icon,
  ShieldCheckIcon,
  CpuIcon,
  GitPullRequestIcon,
  CheckCircle2Icon,
} from "lucide-react";

export function BentoCapabilities() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);

  return (
    <section
      data-section="bento-capabilities"
      className="mx-auto w-full max-w-[1440px] px-8 py-20 md:px-[120px]"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          {t("pages.marketing.home.bentoEyebrow")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {t("pages.marketing.home.bentoTitle")}
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          {t("pages.marketing.home.bentoDescription")}
        </p>
      </div>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Card 1: Large Span */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/50 sm:col-span-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
                <Code2Icon className="size-3.5" />
                {t("pages.marketing.home.bentoCard1Badge")}
              </span>
              <span className="text-xs text-muted-foreground font-mono">AST · SHA-256</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {t("pages.marketing.home.bentoCard1Title")}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t("pages.marketing.home.bentoCard1Description")}
            </p>
          </div>

          {/* Interactive Visual Element */}
          <div className="mt-6 rounded-xl border border-border/70 bg-muted/40 p-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-2 text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 inline-block" />
                <span>callgraph.evidence.json</span>
              </span>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">PINNED 9f31ca2</span>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="text-muted-foreground">
                <span className="text-brand">→ import</span> &#123; OpenAI &#125; <span className="text-brand">from</span> &apos;openai&apos;;
              </div>
              <div className="text-muted-foreground">
                <span className="text-brand">→ const</span> prompt = sanitizeAndValidate(userInput);
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <span className="text-brand">→ client</span>.chat.completions.create(&#123; ... &#125;)
                <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">AI Call Boundary</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Bounded Human Context */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/50">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <ShieldCheckIcon className="size-3.5" />
                {t("pages.marketing.home.bentoCard2Badge")}
              </span>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {t("pages.marketing.home.bentoCard2Title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("pages.marketing.home.bentoCard2Description")}
            </p>
          </div>

          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <CheckCircle2Icon className="size-3.5 text-amber-600 dark:text-amber-400" />
              <span>Targeted Inquiry</span>
            </div>
            <p className="mt-1 text-muted-foreground text-[11px]">
              &quot;Is human approval mandatory before executing model-suggested fund transfers?&quot;
            </p>
          </div>
        </div>

        {/* Card 3: Rule Engines */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/50">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                <CpuIcon className="size-3.5" />
                {t("pages.marketing.home.bentoCard3Badge")}
              </span>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {t("pages.marketing.home.bentoCard3Title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("pages.marketing.home.bentoCard3Description")}
            </p>
          </div>

          <div className="mt-6 space-y-1.5 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>EU AI Act Tier</span>
              <span className="font-semibold text-foreground">High Risk (Annex III)</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>ISO 42001 Controls</span>
              <span className="font-semibold text-foreground">Mapped &amp; Verified</span>
            </div>
          </div>
        </div>

        {/* Card 4: Closed-Loop Remediation (Span 2) */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-xs transition-all duration-200 hover:border-brand/50 sm:col-span-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <GitPullRequestIcon className="size-3.5" />
                {t("pages.marketing.home.bentoCard4Badge")}
              </span>
              <span className="text-xs text-muted-foreground font-mono">PR #142 · Ready</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {t("pages.marketing.home.bentoCard4Title")}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t("pages.marketing.home.bentoCard4Description")}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/40 p-4 text-xs font-mono">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+ 42 additions</span>
            <span className="text-rose-500 font-semibold">- 8 deletions</span>
            <span className="text-muted-foreground">| Verified: AST check, Lint, Security gate passed</span>
          </div>
        </div>
      </div>
    </section>
  );
}
