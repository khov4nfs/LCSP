"use client";

import type { Locale } from "@lcsp/contracts/shared/locale";
import { resolveMessage } from "@lcsp/i18n";
import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DatabaseIcon,
  FileTextIcon,
  ShieldAlertIcon,
  ShieldCheckIcon
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMarketingLocale } from "./marketing-locale";

export function FigmaHeroSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [activeScenarioId, setActiveScenarioId] = useState<"retention" | "injection" | "euaiact">("retention");
  const [copied, setCopied] = useState(false);
  const [inspectEvidenceIndex, setInspectEvidenceIndex] = useState<number | null>(null);
  const heroRef = useRef<HTMLElement>(null);

  const handleCopyRepo = () => {
    navigator.clipboard?.writeText("acme/notice-service");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // tasteskill 2.5: Cursor Spotlight Dealt Moment setup
  useEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let tx = 0.72, ty = 0.28, cx = tx, cy = ty, raf = 0;
    const set = (x: number, y: number) => {
      root.style.setProperty("--mo-x", `${(x * 100).toFixed(2)}%`);
      root.style.setProperty("--mo-y", `${(y * 100).toFixed(2)}%`);
    };
    set(tx, ty);

    const tick = () => {
      raf = 0;
      cx += (tx - cx) * 0.14;
      cy += (ty - cy) * 0.14;
      set(cx, cy);
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001) {
        raf = requestAnimationFrame(tick);
      } else {
        cx = tx;
        cy = ty;
        set(tx, ty);
      }
    };

    const move = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width;
      ty = (e.clientY - r.top) / r.height;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const leave = () => {
      tx = 0.72;
      ty = 0.28;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);

    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Dynamically resolve scenario values using translated keys from @lcsp/i18n
  const scenarios = [
    {
      id: "retention" as const,
      label: t("pages.marketing.home.figmaHeroScenarioRetention"),
      findingTitle: t("pages.marketing.home.figmaHeroFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeNonCompliant"),
      badgeColor: "#B91C1C",
      badgeBg: "#FEF2F2",
      icon: ShieldAlertIcon,
      reqTitle: t("pages.marketing.home.figmaHeroRequirementLabel"),
      reqValue: t("pages.marketing.home.figmaHeroRequirementValue"),
      evidence1: t("pages.marketing.home.figmaHeroEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroConclusion"),
      conclusionColor: "#84D49F",
      evalRules: t("pages.marketing.home.figmaHeroRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroOpenRequests"),
      progress: [52, 26, 12, 10],
    },
    {
      id: "injection" as const,
      label: t("pages.marketing.home.figmaHeroScenarioInjection"),
      findingTitle: t("pages.marketing.home.figmaHeroInjectionFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeCompliant"),
      badgeColor: "#065F46",
      badgeBg: "#ECFDF5",
      icon: ShieldCheckIcon,
      reqTitle: t("pages.marketing.home.figmaHeroInjectionReqTitle"),
      reqValue: t("pages.marketing.home.figmaHeroInjectionReqValue"),
      evidence1: t("pages.marketing.home.figmaHeroInjectionEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroInjectionEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroInjectionConclusion"),
      conclusionColor: "#84D49F",
      evalRules: t("pages.marketing.home.figmaHeroInjectionRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroInjectionOpenRequests"),
      progress: [85, 0, 10, 5],
    },
    {
      id: "euaiact" as const,
      label: t("pages.marketing.home.figmaHeroScenarioEuAiAct"),
      findingTitle: t("pages.marketing.home.figmaHeroEuAiActFindingTitle"),
      badge: t("pages.marketing.home.figmaHeroOutcomeInReview"),
      badgeColor: "#92400E",
      badgeBg: "#FEF3C7",
      icon: ClockIcon,
      reqTitle: t("pages.marketing.home.figmaHeroEuAiActReqTitle"),
      reqValue: t("pages.marketing.home.figmaHeroEuAiActReqValue"),
      evidence1: t("pages.marketing.home.figmaHeroEuAiActEvidence1"),
      evidence2: t("pages.marketing.home.figmaHeroEuAiActEvidence2"),
      conclusion: t("pages.marketing.home.figmaHeroEuAiActConclusion"),
      conclusionColor: "#FBBF24",
      evalRules: t("pages.marketing.home.figmaHeroEuAiActRulesEvaluated"),
      openRequests: t("pages.marketing.home.figmaHeroEuAiActOpenRequests"),
      progress: [60, 5, 25, 10],
    },
  ];

  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0];
  const ActiveIcon = activeScenario.icon;

  return (
    <section
      ref={heroRef}
      data-section="figma-hero"
      data-enter
      className="mo-cs relative w-full overflow-hidden bg-gradient-to-r from-[#081C2B] to-[#174950] pt-8 pb-16 text-white"
    >
      {/* tasteskill cursor-spotlight element */}
      <div className="mo-cs__light" aria-hidden="true" />

      {/* Superdesign: Living Aurora Light Blades (Drifting & Breathing) */}
      <div 
        aria-hidden="true" 
        className="aurora-blade-1 pointer-events-none absolute -top-10 -left-10 h-[380px] w-[500px] rounded-full bg-gradient-to-tr from-[#31BDA7]/20 via-[#14535B]/10 to-transparent blur-[80px]" 
      />
      <div 
        aria-hidden="true" 
        className="aurora-blade-2 pointer-events-none absolute top-10 right-10 h-[360px] w-[460px] rounded-full bg-gradient-to-br from-[#0D9488]/15 via-[#1D6A75]/10 to-transparent blur-[80px]" 
      />

      {/* Linear Style: Technical Grid lines */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-grid-white opacity-25 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_80%)]" 
      />

      <div className="mo-cs__content relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        {/* Top Header Block: 2 Columns */}
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_560px] xl:grid-cols-[1fr_610px]">
          {/* Left Text Column */}
          <div className="max-w-[720px] pt-4">
            {/* Eyebrow */}
            <p className="hero-enter-title text-[13px] font-semibold tracking-wider text-[#86E8D4]">
              {t("pages.marketing.home.figmaHeroEyebrow")}
            </p>

            {/* Headline matching Figma 1757:12982 */}
            <h1 className="hero-enter-title mt-4 text-wrap-balance text-4xl font-semibold leading-[1.1] tracking-tight text-[#F7FBFC] sm:text-5xl md:text-[58px] md:leading-[64px]">
              {t("pages.marketing.home.figmaHeroTitle")}
            </h1>

            {/* Subtitle matching Figma 1757:12983 */}
            <p className="hero-enter-sub mt-5 max-w-[675px] text-wrap-pretty text-base leading-relaxed text-[#C6D9DE] sm:text-[19px]">
              {t("pages.marketing.home.figmaHeroDescription")}
            </p>

            {/* Action Buttons with Superdesign Keycap-raised Tactile Feedback */}
            <div className="hero-enter-actions mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/sign-up"
                className="btn-keycap-primary inline-flex h-11 items-center justify-center rounded-[8px] bg-[#31BDA7] px-6 text-sm font-semibold text-[#082B30]"
              >
                {t("pages.marketing.home.figmaHeroPrimaryCta")}
              </Link>
              <a
                href="#workflow"
                className="btn-keycap-secondary inline-flex h-11 items-center justify-center rounded-[8px] border border-[#B9C8D4] bg-white px-6 text-sm font-semibold text-[#101C29]"
              >
                {t("pages.marketing.home.figmaHeroSecondaryCta")}
              </a>
            </div>
          </div>

          {/* Right Image Column: Evidence Constellation */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="w-full max-w-[480px] lg:max-w-[610px] animate-pulse-glow">
              <Image
                src="/brand/evidence-constellation.svg"
                alt="LCSP Evidence Constellation signature graphic"
                width={610}
                height={370}
                priority
                className="h-auto w-full select-none object-contain drop-shadow-2xl animate-float-slow"
              />
            </div>
          </div>
        </div>

        {/* Product Preview Card */}
        <div className="hero-enter-preview mt-12 overflow-hidden rounded-[20px] border border-[#D6DFE7] bg-white text-[#101C29] shadow-[0px_20px_48px_0px_rgba(10,31,46,0.16)] transition-shadow duration-200 ease-out">
          {/* Header Bar matching Figma 1757:12989-12991 */}
          <div className="flex flex-wrap items-center justify-between border-b border-[#D6DFE7] px-6 py-4 gap-3">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-slate-400/80 inline-block" />
              <span className="size-3 rounded-full bg-slate-400/80 inline-block" />
              <span className="size-3 rounded-full bg-slate-400/80 inline-block" />
              <span className="ml-3 text-xs font-semibold tracking-wider text-[#48586A]">
                {t("pages.marketing.home.figmaHeroWorkspaceBadge")}
              </span>
            </div>

            {/* Interactive Scenario Switcher with 100% Bilingual Labels */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              {scenarios.map((scenario) => {
                const isActive = scenario.id === activeScenarioId;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setActiveScenarioId(scenario.id)}
                    className={`rounded-md px-3 py-1 font-medium transition-[background-color,color,box-shadow] duration-180 ease-out ${
                      isActive
                        ? "bg-white text-[#101C29] shadow-xs font-semibold"
                        : "text-[#48586A] hover:text-[#101C29]"
                    }`}
                  >
                    {scenario.label}
                  </button>
                );
              })}
            </div>

            <span className="hidden sm:inline-block text-xs text-[#48586A]">
              {t("pages.marketing.home.figmaHeroWorkspaceSubtitle")}
            </span>
          </div>

          {/* Body: Two Cards Side by Side */}
          <div className="grid gap-6 p-6 lg:grid-cols-[344px_1fr]">
            {/* Scope Box */}
            <div className="rounded-[12px] border border-[#D6DFE7] bg-white p-5 shadow-xs">
              <h2 className="text-base font-semibold text-[#101C29]">
                {t("pages.marketing.home.figmaHeroScopeTitle")}
              </h2>

              <div className="mt-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <DatabaseIcon className="mt-0.5 size-4 text-[#11545B]" />
                    <div>
                      <p className="text-[11px] text-[#48586A]">
                        {t("pages.marketing.home.figmaHeroRepoLabel")}
                      </p>
                      <p className="font-mono text-xs font-semibold text-[#101C29]">
                        {t("pages.marketing.home.figmaHeroRepoValue")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyRepo}
                    title="Copy repository"
                    className="mt-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {copied ? <CheckIcon className="size-3.5 text-emerald-600" /> : <CopyIcon className="size-3.5" />}
                  </button>
                </div>

                <div className="h-px w-full bg-[#D6DFE7]" />

                <div className="flex items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-4 text-[#11545B]" />
                  <div>
                    <p className="text-[11px] text-[#48586A]">
                      {t("pages.marketing.home.figmaHeroLegalSourceLabel")}
                    </p>
                    <p className="text-xs font-semibold text-[#101C29]">
                      {t("pages.marketing.home.figmaHeroLegalSourceValue")}
                    </p>
                  </div>
                </div>

                <div className="h-px w-full bg-[#D6DFE7]" />

                <div className="space-y-1.5 text-xs text-[#101C29]">
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span>{activeScenario.evalRules}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    <span className="text-[#48586A]">{activeScenario.openRequests}</span>
                  </p>
                </div>

                {/* Progress outcome segments matching Figma 1757:13011-13014 */}
                <div className="space-y-1 pt-1">
                  <div className="flex h-[7px] w-full gap-1 overflow-hidden transition-all duration-500">
                    <div 
                      style={{ width: `${activeScenario.progress[0]}%` }} 
                      className="h-full rounded-[3px] bg-[#0D9488] transition-all duration-500" 
                      title="Compliant" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[1]}%` }} 
                      className="h-full rounded-[3px] bg-[#DC2626] transition-all duration-500" 
                      title="Non-compliant" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[2]}%` }} 
                      className="h-full rounded-[3px] bg-[#D97706] transition-all duration-500" 
                      title="In review" 
                    />
                    <div 
                      style={{ width: `${activeScenario.progress[3]}%` }} 
                      className="h-full rounded-[3px] bg-[#94A3B8] transition-all duration-500" 
                      title="Unresolved" 
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Finding Box matching Figma 1757:13015 */}
            <div className="rounded-[12px] bg-[#123E46] p-6 text-white shadow-inner transition-all duration-300">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">
                  {activeScenario.findingTitle}
                </h3>
                <span 
                  style={{ backgroundColor: activeScenario.badgeBg, color: activeScenario.badgeColor }}
                  className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-xs font-semibold"
                >
                  <ActiveIcon className="size-3.5" />
                  {activeScenario.badge}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-[13px] font-medium text-[#84D49F]">
                  {activeScenario.reqTitle}
                </p>
                <p className="mt-1 text-base font-medium text-white">
                  {activeScenario.reqValue}
                </p>
              </div>

              <div className="my-4 h-px w-full bg-[#435367]" />

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold tracking-wider text-[#84D49F]">
                    {t("pages.marketing.home.figmaHeroEvidenceLabel")}
                  </p>
                  <span className="text-[11px] font-mono text-[#84D49F]/80">
                    {inspectEvidenceIndex !== null ? (locale === "vi" ? "Đang chọn xem vị trí AST" : "AST line pinned") : (locale === "vi" ? "Bấm vào để soi dòng mã" : "Click to inspect")}
                  </span>
                </div>
                <div className="mt-2.5 space-y-2 font-mono text-xs text-slate-100">
                  <div 
                    onClick={() => setInspectEvidenceIndex(inspectEvidenceIndex === 0 ? null : 0)}
                    className={`cursor-pointer rounded-md px-3.5 py-2.5 border transition-all duration-200 ${
                      inspectEvidenceIndex === 0 
                        ? "bg-[#31BDA7]/20 border-[#31BDA7] text-[#86E8D4] shadow-xs" 
                        : "bg-black/25 border-white/10 hover:bg-black/40 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{activeScenario.evidence1}</span>
                      <span className="text-[10px] opacity-75">{inspectEvidenceIndex === 0 ? "✓ PINNED" : "L34-42"}</span>
                    </div>
                  </div>
                  <div 
                    onClick={() => setInspectEvidenceIndex(inspectEvidenceIndex === 1 ? null : 1)}
                    className={`cursor-pointer rounded-md px-3.5 py-2.5 border transition-all duration-200 ${
                      inspectEvidenceIndex === 1 
                        ? "bg-[#31BDA7]/20 border-[#31BDA7] text-[#86E8D4] shadow-xs" 
                        : "bg-black/25 border-white/10 hover:bg-black/40 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{activeScenario.evidence2}</span>
                      <span className="text-[10px] opacity-75">{inspectEvidenceIndex === 1 ? "✓ PINNED" : "L88-95"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div 
                style={{ color: activeScenario.conclusionColor }}
                className="mt-5 text-sm font-medium"
              >
                {activeScenario.conclusion}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Technical Status Bar & Exploration Indicator */}
      <div className="relative z-10 mx-auto mt-12 flex max-w-[1440px] items-center justify-between border-t border-white/10 pt-4 px-8 text-xs font-mono text-[#86E8D4]/80 md:px-[96px]">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[#31BDA7] animate-pulse" />
          <span className="tracking-wider uppercase text-[11px] text-[#A2E2D4]">
            {locale === "vi" ? "Kiểm toán hệ thống AST trực tiếp" : "Live AST Proof Engine"}
          </span>
        </div>
        <a 
          href="#why-lcsp" 
          className="group inline-flex items-center gap-1.5 rounded-[4px] border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-[#C6D9DE] hover:border-[#31BDA7]/50 hover:bg-white/10 hover:text-white transition-all duration-200"
        >
          <span>{locale === "vi" ? "Cuộn xuống để khám phá" : "Scroll to explore"}</span>
          <span className="inline-block transition-transform duration-200 group-hover:translate-y-0.5 text-[#31BDA7]">↓</span>
        </a>
      </div>
    </section>
  );
}
