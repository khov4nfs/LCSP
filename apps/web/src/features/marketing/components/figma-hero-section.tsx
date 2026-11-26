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
  CopyIcon,
  ChevronRight,
  GitBranch,
} from "lucide-react";
import { TechnicalBlueprintBackground } from "./features-showcase";
import { cn } from "@/lib/utils";

/**
 * Network Topology Graph:
 * An abstract SVG visualization of a design system network with a central forest node
 * and orbiting nodes on dashed paths.
 */
function NetworkTopologyGraph() {
  return (
    <div className="relative flex items-center justify-center h-[260px] w-full max-w-[320px] mx-auto">
      <svg
        className="w-full h-full overflow-visible"
        viewBox="0 0 260 260"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Dashed circular orbit 1 (r = 100px) */}
        <circle
          cx="130"
          cy="130"
          r="95"
          fill="none"
          stroke="#3A3A38"
          strokeWidth="1"
          strokeOpacity="0.25"
          strokeDasharray="4 4"
        />
        {/* Dashed circular orbit 2 (r = 60px) */}
        <circle
          cx="130"
          cy="130"
          r="55"
          fill="none"
          stroke="#3A3A38"
          strokeWidth="1"
          strokeOpacity="0.2"
          strokeDasharray="3 3"
        />

        {/* Static connection lines */}
        <line x1="130" y1="130" x2="130" y2="35" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.2" />
        <line x1="130" y1="130" x2="215" y2="180" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.2" />
        <line x1="130" y1="130" x2="45" y2="180" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.2" />

        {/* Central 16px solid forest green node */}
        <circle cx="130" cy="130" r="10" fill="#1A3C2B" />
        <circle cx="130" cy="130" r="16" fill="none" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.3" />

        {/* Orbiting Node 1: Top (Mint #9EFFBF) */}
        <g className="animate-[spin_24s_linear_infinite] origin-[130px_130px]">
          <circle cx="130" cy="35" r="7" fill="#9EFFBF" stroke="#1A3C2B" strokeWidth="1" />
          <text x="130" y="20" textAnchor="middle" fill="#1A3C2B" fontSize="9" fontFamily="monospace" fontWeight="bold">AST</text>
        </g>

        {/* Orbiting Node 2: Bottom-Right (Coral #FF8C69) */}
        <g className="animate-[spin_18s_linear_infinite_reverse] origin-[130px_130px]">
          <circle cx="215" cy="180" r="6" fill="#FF8C69" stroke="#1A3C2B" strokeWidth="1" />
          <text x="230" y="195" textAnchor="middle" fill="#3A3A38" fontSize="8" fontFamily="monospace">LAW</text>
        </g>

        {/* Orbiting Node 3: Bottom-Left (Gold #F4D35E) */}
        <g className="animate-[spin_30s_linear_infinite] origin-[130px_130px]">
          <circle cx="45" cy="180" r="6" fill="#F4D35E" stroke="#1A3C2B" strokeWidth="1" />
          <text x="35" y="195" textAnchor="middle" fill="#3A3A38" fontSize="8" fontFamily="monospace">GATE</text>
        </g>
      </svg>
    </div>
  );
}

export function FigmaHeroSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [activeScenarioId, setActiveScenarioId] = useState<"retention" | "injection" | "euaiact">("retention");
  const [copied, setCopied] = useState(false);

  const handleCopyRepo = () => {
    navigator.clipboard?.writeText("acme/notice-service");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scenarios = [
    {
      id: "retention" as const,
      label: t("pages.marketing.home.figmaHeroScenarioRetention"),
      findingTitle: t("pages.marketing.home.figmaHeroFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeNonCompliant"),
      badgeBorder: "border-[#FF8C69]",
      badgeBg: "bg-[#FF8C69]/15",
      badgeText: "text-[#1A3C2B]",
      icon: ShieldAlertIcon,
      reqTitle: t("pages.marketing.home.figmaHeroRequirementLabel"),
      reqValue: t("pages.marketing.home.figmaHeroRequirementValue"),
      evidence1: t("pages.marketing.home.figmaHeroEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroConclusion"),
      evalRules: t("pages.marketing.home.figmaHeroRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroOpenRequests"),
      accent: "border-l-[#FF8C69]",
    },
    {
      id: "injection" as const,
      label: t("pages.marketing.home.figmaHeroScenarioInjection"),
      findingTitle: t("pages.marketing.home.figmaHeroInjectionFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeCompliant"),
      badgeBorder: "border-[#9EFFBF]",
      badgeBg: "bg-[#9EFFBF]/25",
      badgeText: "text-[#1A3C2B]",
      icon: ShieldCheckIcon,
      reqTitle: t("pages.marketing.home.figmaHeroInjectionReqTitle"),
      reqValue: t("pages.marketing.home.figmaHeroInjectionReqValue"),
      evidence1: t("pages.marketing.home.figmaHeroInjectionEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroInjectionEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroInjectionConclusion"),
      evalRules: t("pages.marketing.home.figmaHeroInjectionRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroInjectionOpenRequests"),
      accent: "border-l-[#9EFFBF]",
    },
    {
      id: "euaiact" as const,
      label: t("pages.marketing.home.figmaHeroScenarioEuAiAct"),
      findingTitle: t("pages.marketing.home.figmaHeroEuAiActFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeInReview"),
      badgeBorder: "border-[#F4D35E]",
      badgeBg: "bg-[#F4D35E]/25",
      badgeText: "text-[#1A3C2B]",
      icon: ClockIcon,
      reqTitle: t("pages.marketing.home.figmaHeroEuAiActReqTitle"),
      reqValue: t("pages.marketing.home.figmaHeroEuAiActReqValue"),
      evidence1: t("pages.marketing.home.figmaHeroEuAiActEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroEuAiActEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroEuAiActConclusion"),
      evalRules: t("pages.marketing.home.figmaHeroEuAiActRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroEuAiActOpenRequests"),
      accent: "border-l-[#F4D35E]",
    },
  ];

  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0];
  const ActiveIcon = activeScenario.icon;

  return (
    <section
      data-section="figma-hero"
      data-enter
      className="relative w-full overflow-hidden border-b border-[#3A3A38]/20 bg-[#F7F7F5] pt-12 pb-20 text-[#3A3A38]"
    >
      <TechnicalBlueprintBackground />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        {/* Top Header Block: 2 Columns */}
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_560px] xl:grid-cols-[1fr_600px]">
          {/* Left Text Column */}
          <div className="max-w-[720px] pt-2">
            {/* Minimalist Status Badge */}
            <div className="inline-flex items-center gap-2.5 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3.5 py-1 text-[11px] font-mono tracking-widest text-[#1A3C2B] uppercase mb-4 shadow-none">
              <span className="h-2 w-2 bg-[#1A3C2B]" />
              <span>{t("pages.marketing.home.figmaHeroEyebrow")}</span>
              <span className="text-[#3A3A38]/30">•</span>
              <span className="text-[#1A3C2B]/80 font-bold">LCSP AUDIT ENGINE</span>
            </div>

            {/* Space Grotesk headline: bold, tight-tracking, prestige forest green */}
            <h1 className="mt-2 text-wrap-balance font-sans text-4xl sm:text-5xl md:text-[58px] font-bold leading-[1.08] tracking-tight text-[#1A3C2B]">
              {t("pages.marketing.home.figmaHeroTitle")}
            </h1>

            {/* Subtext with left vertical 1px hairline */}
            <div className="mt-6 flex gap-4 text-left">
              <div className="hidden h-14 w-[2px] bg-[#1A3C2B]/40 sm:block shrink-0" />
              <p className="text-base sm:text-lg text-[#3A3A38] leading-relaxed font-normal">
                {t("pages.marketing.home.figmaHeroDescription")}
              </p>
            </div>

            {/* CTA row: 0px/2px radius, flat 1px hairlines */}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center gap-2 rounded-[2px] bg-[#1A3C2B] px-8 py-3.5 text-xs font-mono font-bold tracking-wider uppercase text-[#F7F7F5] border border-[#1A3C2B] transition-all hover:bg-[#23503a] active:translate-y-0.5"
              >
                <span>{t("pages.marketing.home.figmaHeroPrimaryCta")}</span>
                <ChevronRight className="h-4 w-4" />
              </Link>

              <Link
                href={`/${locale}/features`}
                className="inline-flex items-center justify-center gap-2 rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] px-8 py-3.5 text-xs font-mono font-bold tracking-wider uppercase text-[#1A3C2B] transition-all hover:border-[#1A3C2B] hover:bg-white active:translate-y-0.5"
              >
                <span>{t("pages.marketing.home.figmaHeroSecondaryCta")}</span>
              </Link>
            </div>

            {/* Technical Trust Strip */}
            <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-[#3A3A38]/20 pt-6 font-mono text-[11px] text-[#3A3A38]">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[#1A3C2B]" />
                EU AI Act Annex IV
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[#FF8C69]" />
                NIST AI RMF 1.0
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 bg-[#9EFFBF] border border-[#1A3C2B]" />
                ISO/IEC 42001
              </span>
            </div>
          </div>

          {/* Right Column: Technical Blueprint Mockup Card with L-shaped corner markers */}
          <div className="relative rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] p-6 shadow-none">
            {/* 4 L-shaped corner markers (10px x 10px) */}
            <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
            <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
            <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

            {/* Window header */}
            <div className="flex items-center justify-between border-b border-[#3A3A38]/20 pb-3">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold text-[#1A3C2B]">
                <span className="h-2 w-2 rounded-[1px] bg-[#1A3C2B]" />
                <span>acme/notice-service</span>
                <span className="text-[#3A3A38]/50">@main</span>
              </div>
              <button
                type="button"
                onClick={handleCopyRepo}
                className="flex items-center gap-1 rounded-[2px] border border-[#3A3A38]/20 bg-white px-2 py-0.5 text-[10px] font-mono text-[#1A3C2B] font-semibold hover:border-[#1A3C2B]"
              >
                {copied ? <CheckIcon className="h-3 w-3 text-[#1A3C2B]" /> : <CopyIcon className="h-3 w-3" />}
                <span>{copied ? "COPIED" : "COPY"}</span>
              </button>
            </div>

            {/* Interactive Scenario Buttons */}
            <div className="mt-4 flex gap-1.5">
              {scenarios.map((sc) => (
                <button
                  type="button"
                  key={sc.id}
                  onClick={() => setActiveScenarioId(sc.id)}
                  className={cn(
                    "flex-1 rounded-[2px] border px-2 py-1.5 text-center font-mono text-[10px] uppercase font-bold tracking-wider transition-all",
                    activeScenarioId === sc.id
                      ? "border-[#1A3C2B] bg-[#1A3C2B] text-[#F7F7F5]"
                      : "border-[#3A3A38]/20 bg-white text-[#3A3A38] hover:border-[#1A3C2B]"
                  )}
                >
                  {sc.label}
                </button>
              ))}
            </div>

            {/* Scenario Content Card */}
            <div className={cn("mt-4 rounded-[2px] border border-[#3A3A38]/20 border-l-4 bg-white p-4", activeScenario.accent)}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#1A3C2B] flex items-center gap-1.5">
                  <ActiveIcon className="h-4 w-4" />
                  {activeScenario.findingTitle}
                </span>
                <span className={cn("rounded-[2px] border px-2 py-0.5 font-mono text-[10px] uppercase font-bold tracking-wider", activeScenario.badgeBorder, activeScenario.badgeBg, activeScenario.badgeText)}>
                  {activeScenario.badge}
                </span>
              </div>

              {/* Requirement & Evidences */}
              <div className="mt-3 space-y-2 border-t border-[#3A3A38]/10 pt-2 text-xs">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[#3A3A38]/70 block font-semibold">
                    {activeScenario.reqTitle}
                  </span>
                  <p className="font-medium text-[#1A3C2B]">{activeScenario.reqValue}</p>
                </div>
                <div className="font-mono text-[11px] text-[#3A3A38] bg-[#FAF9F6] p-2 rounded-[2px] border border-[#3A3A38]/10">
                  <p>↳ {activeScenario.evidence1}</p>
                  <p>↳ {activeScenario.evidence2}</p>
                </div>
              </div>
            </div>

            {/* Abstract Wireframe Graphic: Network Topology Graph on Paper */}
            <div className="mt-4 rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-2">
              <div className="flex items-center justify-between px-2 pt-1 font-mono text-[9px] text-[#3A3A38]/60 uppercase tracking-widest">
                <span>SYSTEM NETWORK GRAPH</span>
                <span>SHA-256 VERIFIED</span>
              </div>
              <NetworkTopologyGraph />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
