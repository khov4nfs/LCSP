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
        {/* Card 1: Large Span with Features box style */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#1A3C2B] bg-[#FAF9F6] p-7 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white sm:col-span-2">
          {/* L-shaped corner markers */}
          <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#1A3C2B]/30 bg-white px-2.5 py-0.5 text-xs font-mono font-bold text-[#1A3C2B] uppercase">
                <Code2Icon className="size-3.5" />
                {t("pages.marketing.home.bentoCard1Badge")}
              </span>
              <span className="text-xs text-[#3A3A38]/70 font-mono font-bold">AST · SHA-256</span>
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.bentoCard1Title")}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.bentoCard1Description")}
            </p>
          </div>

          {/* Interactive Visual Element */}
          <div className="mt-6 rounded-[2px] border border-[#3A3A38]/20 bg-white p-4 font-mono text-xs shadow-none">
            <div className="flex items-center justify-between border-b border-[#3A3A38]/15 pb-2 text-[#3A3A38]">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#1A3C2B] inline-block" />
                <span className="font-semibold text-[#1A3C2B]">callgraph.evidence.json</span>
              </span>
              <span className="text-[11px] text-[#1A3C2B] font-bold">PINNED 9f31ca2</span>
            </div>
            <div className="mt-3 space-y-1.5 text-xs text-[#3A3A38]">
              <div>
                <span className="text-[#1A3C2B] font-bold">→ import</span> &#123; OpenAI &#125; <span className="text-[#1A3C2B] font-bold">from</span> &apos;openai&apos;;
              </div>
              <div>
                <span className="text-[#1A3C2B] font-bold">→ const</span> prompt = sanitizeAndValidate(userInput);
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#1A3C2B] font-bold">→ client</span>.chat.completions.create(&#123; ... &#125;)
                <span className="rounded-[2px] border border-[#1A3C2B]/30 bg-[#9EFFBF]/30 px-1.5 py-0.5 text-[10px] text-[#1A3C2B] font-bold">AI Call Boundary</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Bounded Human Context */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#FF8C69] bg-[#FAF9F6] p-7 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#FF8C69]/40 bg-white px-2.5 py-0.5 text-xs font-mono font-bold text-[#1A3C2B] uppercase">
                <ShieldCheckIcon className="size-3.5 text-[#FF8C69]" />
                {t("pages.marketing.home.bentoCard2Badge")}
              </span>
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.bentoCard2Title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.bentoCard2Description")}
            </p>
          </div>

          <div className="mt-6 rounded-[2px] border border-[#3A3A38]/20 bg-white p-3.5 text-xs">
            <div className="font-bold text-[#1A3C2B] flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider">
              <CheckCircle2Icon className="size-3.5 text-[#FF8C69]" />
              <span>Targeted Inquiry</span>
            </div>
            <p className="mt-1 text-[#3A3A38] text-[11px] leading-relaxed">
              {t("pages.marketing.home.bentoCard2Detail")}
            </p>
          </div>
        </div>

        {/* Card 3: Deterministic Rule Engine */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#F4D35E] bg-[#FAF9F6] p-7 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white">
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#3A3A38]/20 bg-white px-2.5 py-0.5 text-xs font-mono font-bold text-[#1A3C2B] uppercase">
                <CpuIcon className="size-3.5" />
                {t("pages.marketing.home.bentoCard3Badge")}
              </span>
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.bentoCard3Title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.bentoCard3Description")}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            {["EU AI Act", "ISO 42001", "NIST AI RMF", "Internal Policy"].map((badge) => (
              <span
                key={badge}
                className="rounded-[2px] border border-[#3A3A38]/20 bg-white px-2.5 py-1 text-[11px] font-mono text-[#1A3C2B] font-bold"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>

        {/* Card 4: Verifiable Remediation (Span 2) */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-[2px] border border-[#3A3A38]/30 border-l-4 border-l-[#9EFFBF] bg-[#FAF9F6] p-7 shadow-none transition-all duration-200 hover:border-[#1A3C2B] hover:bg-white sm:col-span-2">
          {/* L-shaped corner markers */}
          <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#1A3C2B]/30 bg-white px-2.5 py-0.5 text-xs font-mono font-bold text-[#1A3C2B] uppercase">
                <GitPullRequestIcon className="size-3.5" />
                {t("pages.marketing.home.bentoCard4Badge")}
              </span>
              <span className="text-xs text-[#1A3C2B] font-mono font-bold">PR #142 · VERIFIED</span>
            </div>
            <h3 className="mt-4 text-xl font-bold text-[#1A3C2B]">
              {t("pages.marketing.home.bentoCard4Title")}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#3A3A38]">
              {t("pages.marketing.home.bentoCard4Description")}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-[2px] border border-[#3A3A38]/20 bg-white px-4 py-3 text-xs font-mono">
            <span className="text-[#3A3A38]">remediation-branch: fix/eu-ai-act-guard</span>
            <span className="rounded-[2px] border border-[#1A3C2B] bg-[#9EFFBF]/30 px-2 py-0.5 text-[10px] text-[#1A3C2B] font-bold">
              PASSED 4/4 GATES
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
