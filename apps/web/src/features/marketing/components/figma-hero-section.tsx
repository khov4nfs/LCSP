"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { useMarketingLocale } from "./marketing-locale";
import { 
  DatabaseIcon, 
  FileTextIcon, 
  ShieldAlertIcon, 
  ShieldCheckIcon, 
  ClockIcon, 
  CheckIcon, 
  CopyIcon 
} from "lucide-react";

interface ScenarioData {
  id: "retention" | "injection" | "euaiact";
  labelKey: string;
  badge: string;
  badgeColor: string;
  badgeBg: string;
  icon: typeof ShieldAlertIcon;
  reqTitle: string;
  reqValue: string;
  evidence: [string, string];
  conclusion: string;
  conclusionColor: string;
  evalRules: string;
  openRequests: string;
  progress: [number, number, number, number]; // compliant, non-compliant, in-review, unresolved
}

const SCENARIOS: ScenarioData[] = [
  {
    id: "retention",
    labelKey: "Account Retention",
    badge: "NON-COMPLIANT",
    badgeColor: "#B91C1C",
    badgeBg: "#FEF2F8",
    icon: ShieldAlertIcon,
    reqTitle: "Article 17 § 1 — Data Subject Erasure",
    reqValue: "Account deletion handler must purge all user PII within 30 days of unregistration request.",
    evidence: [
      "services/user/retention_worker.go:84 - retention timer defaults to indefinite archival",
      "db/migrations/042_user_archive.sql - missing tombstone purge trigger",
    ],
    conclusion: "Failed in commit a8f9c12 • 2 policy violations detected across 2 files",
    conclusionColor: "#F87171",
    evalRules: "48 of 48 rules evaluated",
    openRequests: "2 information requests open",
    progress: [50, 25, 15, 10],
  },
  {
    id: "injection",
    labelKey: "Prompt Injection Guard",
    badge: "COMPLIANT",
    badgeColor: "#065F46",
    badgeBg: "#ECFDF5",
    icon: ShieldCheckIcon,
    reqTitle: "NIST AI 100-1 § 4.3 — Input Sanitation & Guardrails",
    reqValue: "LLM ingestion gateway must sanitize delimiters and isolate untrusted prompt tokens.",
    evidence: [
      "src/gateway/prompt_sanitizer.py:12 - regex guard matches XML escape brackets",
      "tests/e2e/jailbreak_suite.py:104 - 100% of 250 adversarial vectors neutralized",
    ],
    conclusion: "Passed in commit c3b248a • Cryptographic attestation generated",
    conclusionColor: "#84D49F",
    evalRules: "64 of 64 rules evaluated",
    openRequests: "0 information requests open",
    progress: [85, 0, 10, 5],
  },
  {
    id: "euaiact",
    labelKey: "EU AI Act High-Risk",
    badge: "IN REVIEW",
    badgeColor: "#92400E",
    badgeBg: "#FEF3C7",
    icon: ClockIcon,
    reqTitle: "Annex IV — Technical Documentation & Auditability",
    reqValue: "High-risk inference pipeline must persist unalterable audit trails for autonomous decisions.",
    evidence: [
      "pkg/inference/telemetry.rs:45 - append-only Merkle tree logger verified",
      "docs/compliance/annex_iv.md - waiting on external safety officer signature",
    ],
    conclusion: "Under review in PR #142 • Pending legal counsel confirmation",
    conclusionColor: "#FBBF24",
    evalRules: "52 of 56 rules evaluated",
    openRequests: "1 information request pending signoff",
    progress: [60, 5, 25, 10],
  },
];

export function FigmaHeroSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [activeScenarioId, setActiveScenarioId] = useState<"retention" | "injection" | "euaiact">("retention");
  const [copied, setCopied] = useState(false);

  const activeScenario = SCENARIOS.find((s) => s.id === activeScenarioId) ?? SCENARIOS[0];
  const ActiveIcon = activeScenario.icon;

  const handleCopyRepo = () => {
    navigator.clipboard?.writeText("github.com/myorg/checkout-service");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      data-section="figma-hero"
      className="relative w-full overflow-hidden bg-gradient-to-r from-[#081C2B] via-[#0E2E3C] to-[#174950] pt-16 pb-20 text-white"
    >
      {/* Linear Style: Technical Grid lines and ambient radial glow */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-grid-white opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" 
      />
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-radial-hero-glow opacity-80" 
      />

      {/* Evidence Constellation Graphic (Figma #1795:13205) with subtle floating glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-6 hidden select-none md:block md:w-[500px] lg:w-[610px] animate-pulse-glow"
      >
        <Image
          src="/brand/evidence-constellation.svg"
          alt=""
          width={610}
          height={370}
          priority
          className="h-auto w-full opacity-90 drop-shadow-2xl animate-float-slow"
        />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="max-w-[760px]">
          {/* Eyebrow with keyboard badge preview */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#86E8D4]/30 bg-[#86E8D4]/10 px-3 py-1 text-xs font-semibold tracking-wider text-[#86E8D4]">
              <span className="size-1.5 rounded-full bg-[#86E8D4] animate-ping" />
              {t("pages.marketing.home.figmaHeroEyebrow")}
            </span>
          </div>

          {/* Headline */}
          <h1 className="mt-4 max-w-[680px] text-wrap-balance text-4xl font-semibold leading-[1.1] tracking-tight text-[#F7FBFC] sm:text-5xl md:text-6xl md:leading-[1.08]">
            {t("pages.marketing.home.figmaHeroTitle")}
          </h1>

          {/* Subtitle */}
          <p className="mt-5 max-w-[680px] text-wrap-pretty text-base leading-relaxed text-[#C6D9DE] sm:text-lg">
            {t("pages.marketing.home.figmaHeroDescription")}
          </p>

          {/* Action Buttons */}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/sign-up"
              className="inline-flex h-10 items-center justify-center rounded-[7px] bg-[#31BDA7] px-5 text-sm font-semibold text-[#082B30] transition-all hover:bg-[#3cdbc1] hover:shadow-[0_0_20px_rgba(49,189,167,0.4)] active:scale-95"
            >
              {t("pages.marketing.home.figmaHeroPrimaryCta")}
            </Link>
            <a
              href="#workflow"
              className="inline-flex h-10 items-center justify-center rounded-[7px] border border-[#B9C8D4]/40 bg-white/95 backdrop-blur-xs px-5 text-sm font-semibold text-[#101C29] shadow-xs transition-all hover:bg-white hover:border-white active:scale-95"
            >
              {t("pages.marketing.home.figmaHeroSecondaryCta")}
            </a>
          </div>
        </div>

        {/* Product Preview Card with refined shadows and subtle hover elevation */}
        <div className="mt-14 overflow-hidden rounded-[20px] border border-white/10 bg-[#0E1E28]/95 backdrop-blur-md text-white shadow-2xl transition-all duration-300 hover:shadow-[0_24px_50px_-12px_rgba(10,31,46,0.5)]">
          {/* Header Bar with Linear-inspired Scenario Switcher */}
          <div className="flex flex-wrap items-center justify-between border-b border-white/10 px-6 py-3.5 gap-3">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-slate-600/80 inline-block" />
              <span className="size-3 rounded-full bg-slate-600/80 inline-block" />
              <span className="size-3 rounded-full bg-slate-600/80 inline-block" />
              <span className="ml-3 text-xs font-mono font-medium tracking-wider text-[#86E8D4]">
                {t("pages.marketing.home.figmaHeroWorkspaceBadge")}
              </span>
            </div>

            {/* Interactive Scenario Tabs */}
            <div className="flex items-center rounded-lg border border-white/10 bg-[#09151C] p-0.5 text-xs">
              {SCENARIOS.map((scenario) => {
                const isActive = scenario.id === activeScenarioId;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setActiveScenarioId(scenario.id)}
                    className={`rounded-md px-3 py-1 font-medium transition-all ${
                      isActive
                        ? "bg-[#1E3845] text-white shadow-xs"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {scenario.labelKey}
                  </button>
                );
              })}
            </div>

            <span className="hidden sm:inline-block text-xs font-mono text-slate-400">
              {t("pages.marketing.home.figmaHeroWorkspaceSubtitle")}
            </span>
          </div>

          {/* Body: Two Cards Side by Side with nested radius formula (outer 20px - gap 24px -> rounded-xl 12px) */}
          <div className="grid gap-6 p-6 lg:grid-cols-[340px_1fr]">
            {/* Scope Box */}
            <div className="rounded-xl border border-white/10 bg-[#122532] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  {t("pages.marketing.home.figmaHeroScopeTitle")}
                </h2>
                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                  AST v2.4
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <DatabaseIcon className="mt-0.5 size-4 text-[#31BDA7]" />
                    <div>
                      <p className="text-[11px] text-slate-400">
                        {t("pages.marketing.home.figmaHeroRepoLabel")}
                      </p>
                      <p className="font-mono text-xs font-semibold text-[#86E8D4]">
                        {t("pages.marketing.home.figmaHeroRepoValue")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyRepo}
                    title="Copy repository"
                    className="mt-1 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    {copied ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
                  </button>
                </div>

                <div className="h-px w-full bg-white/5" />

                <div className="flex items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-4 text-[#31BDA7]" />
                  <div>
                    <p className="text-[11px] text-slate-400">
                      {t("pages.marketing.home.figmaHeroLegalSourceLabel")}
                    </p>
                    <p className="text-xs font-semibold text-slate-100">
                      {t("pages.marketing.home.figmaHeroLegalSourceValue")}
                    </p>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                <div className="space-y-1.5 text-xs text-slate-300">
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    <span>{activeScenario.evalRules}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-amber-400" />
                    <span>{activeScenario.openRequests}</span>
                  </p>
                </div>

                {/* Progress outcome segments matching Figma 1757:13011-13014 */}
                <div className="space-y-1 pt-1">
                  <div className="flex h-2 w-full gap-1 overflow-hidden transition-all duration-500">
                    <div 
                      style={{ width: `${activeScenario.progress[0]}%` }} 
                      className="h-full rounded-xs bg-[#0D9488] transition-all duration-500" 
                      title="Compliant" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[1]}%` }} 
                      className="h-full rounded-xs bg-[#DC2626] transition-all duration-500" 
                      title="Non-compliant" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[2]}%` }} 
                      className="h-full rounded-xs bg-[#D97706] transition-all duration-500" 
                      title="In review" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[3]}%` }} 
                      className="h-full rounded-xs bg-[#94A3B8] transition-all duration-500" 
                      title="Unresolved" 
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{activeScenario.progress[0]}% Compliant</span>
                    <span>{activeScenario.progress[1]}% Non-compliant</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Finding Box (Dark Card) */}
            <div className="rounded-xl border border-white/10 bg-[#163842] p-6 text-white shadow-inner transition-all duration-300">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {t("pages.marketing.home.figmaHeroFindingTitle")}
                </h3>
                <span 
                  style={{ backgroundColor: activeScenario.badgeBg, color: activeScenario.badgeColor }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                >
                  <ActiveIcon className="size-3.5" />
                  {activeScenario.badge}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-[#84D49F]">
                  {activeScenario.reqTitle}
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {activeScenario.reqValue}
                </p>
              </div>

              <div className="my-4 h-px w-full bg-white/10" />

              <div>
                <p className="text-[11px] font-semibold tracking-wider text-[#84D49F]">
                  {t("pages.marketing.home.figmaHeroEvidenceLabel")}
                </p>
                <div className="mt-2 space-y-1.5 font-mono text-xs text-slate-200">
                  <p className="rounded-md bg-black/20 px-2.5 py-1.5 border border-white/5">
                    {activeScenario.evidence[0]}
                  </p>
                  <p className="rounded-md bg-black/20 px-2.5 py-1.5 border border-white/5">
                    {activeScenario.evidence[1]}
                  </p>
                </div>
              </div>

              <div 
                style={{ color: activeScenario.conclusionColor }}
                className="mt-4 text-xs font-medium"
              >
                {activeScenario.conclusion}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
