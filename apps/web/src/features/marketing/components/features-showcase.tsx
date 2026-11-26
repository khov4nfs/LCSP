"use client";

import { useState } from "react";
import Link from "next/link";
import { type ReactNode } from "react";
import {
  ChevronRight,
  ShieldCheck,
  Code2,
  FileSearch,
  CheckCircle2,
  AlertTriangle,
  GitBranch,
  Cpu,
  Layers,
  ArrowRight,
  Sparkles,
  Lock,
  RefreshCw,
  CornerDownRight,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";

function resolveMarketingMessage(locale: Locale, key: string) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
}

/**
 * Mosaic Technical Background inspired by structural blueprints & interlocking panels:
 * Palette: Paper (#F7F7F5), Forest (#1A3C2B), Hairlines (#3A3A38 at 0.15 - 0.25 opacity)
 */
export function TechnicalBlueprintBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* SVG Mosaic of interlocking rectangular panels */}
      <svg
        className="absolute inset-0 h-full w-full opacity-90"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
      >
        <defs>
          <pattern
            id="blueprint-mosaic"
            width="320"
            height="320"
            patternUnits="userSpaceOnUse"
          >
            {/* Panel 1: Top-Left Large Block */}
            <rect x="0" y="0" width="160" height="160" fill="#F7F7F5" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            {/* Panel 2: Top-Right Horizontal Strips */}
            <rect x="160" y="0" width="160" height="80" fill="#FAF9F6" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            <rect x="160" y="80" width="160" height="80" fill="#F7F7F5" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            {/* Panel 3: Bottom-Left Vertical Blocks */}
            <rect x="0" y="160" width="80" height="160" fill="#FAF9F6" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            <rect x="80" y="160" width="80" height="160" fill="#F7F7F5" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            {/* Panel 4: Bottom-Right Interlocking Block */}
            <rect x="160" y="160" width="160" height="160" fill="#F4F4F0" stroke="#3A3A38" strokeWidth="0.75" strokeOpacity="0.22" />
            
            {/* Blueprint Grid Crosshairs at intersections */}
            <path d="M 155 0 L 165 0 M 160 -5 L 160 5" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.3" />
            <path d="M 155 160 L 165 160 M 160 155 L 160 165" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.3" />
            <path d="M -5 160 L 5 160 M 0 155 L 0 165" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.3" />
            <path d="M 315 160 L 325 160 M 320 155 L 320 165" stroke="#1A3C2B" strokeWidth="1" strokeOpacity="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#blueprint-mosaic)" />
      </svg>
    </div>
  );
}

export function FeaturesHeroSection({
  section = "features-hero",
  title,
  description,
}: {
  section?: string;
  title: string;
  description: string;
}) {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <section
      data-section={section}
      className="relative overflow-hidden border-b border-[#3A3A38]/20 bg-[#F7F7F5] py-20 lg:py-28"
    >
      <TechnicalBlueprintBackground />

      <div className="relative z-10 mx-auto max-w-[1240px] px-6 text-center">
        {/* Status Badge: inline-flex container with 1px border (#1A3C2B/20), 8x8 solid square dot */}
        <div className="inline-flex items-center gap-2.5 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3.5 py-1 text-[11px] font-mono tracking-widest text-[#1A3C2B] uppercase mb-6 shadow-none">
          <span className="h-2 w-2 bg-[#1A3C2B]" />
          <span>{t("pages.marketing.features.eyebrow")}</span>
          <span className="text-[#3A3A38]/40">•</span>
          <span className="text-[#1A3C2B]/80">
            {locale === "vi" ? "KIẾN TRÚC HỆ THỐNG" : "TECHNICAL BLUEPRINT"}
          </span>
        </div>

        {/* Space Grotesk header styling: bold, tight-tracking, prestige forest green */}
        <h1 className="mx-auto max-w-[960px] font-sans text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#1A3C2B] leading-[1.08]">
          {title}
        </h1>

        {/* Subtext with left vertical accent marker */}
        <div className="mx-auto mt-6 flex max-w-[760px] items-center justify-center gap-4 text-left">
          <div className="hidden h-12 w-[2px] bg-[#1A3C2B]/40 sm:block" />
          <p className="text-base sm:text-lg text-[#3A3A38] leading-relaxed font-normal">
            {description}
          </p>
        </div>

        {/* Technical Keycap Actions: 0px / 2px radius, flat 1px hairlines, Forest & Paper */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-[2px] bg-[#1A3C2B] px-7 py-3 text-xs font-mono font-semibold tracking-wider uppercase text-[#F7F7F5] border border-[#1A3C2B] transition-all duration-150 hover:bg-[#23503a] active:translate-y-0.5"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-[2px] border border-[#3A3A38]/30 bg-[#FAF9F6] px-7 py-3 text-xs font-mono font-semibold tracking-wider uppercase text-[#1A3C2B] transition-all duration-150 hover:border-[#1A3C2B] hover:bg-white active:translate-y-0.5"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export function EnhancedRepositoryEvidencePreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const [activeTab, setActiveTab] = useState(0);

  const tabs = [
    { label: "pages.marketing.home.source", icon: Code2, accent: "border-l-[#1A3C2B]" },
    { label: "pages.marketing.home.model", icon: Cpu, accent: "border-l-[#FF8C69]" },
    { label: "pages.marketing.home.control", icon: Lock, accent: "border-l-[#9EFFBF]" },
    { label: "pages.marketing.home.finding", icon: AlertTriangle, accent: "border-l-[#F4D35E]" },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // Source
        return (
          <>
            <div className="flex items-center justify-between text-xs font-mono text-[#3A3A38] mb-2">
              <span className="font-bold text-[#1A3C2B]">apps/payment/risk-policy.ts</span>
              <span className="text-[#1A3C2B] font-mono text-[10px] bg-[#FAF9F6] border border-[#1A3C2B]/30 px-2 py-0.5 rounded-[2px] font-semibold">
                AST Node: CallExpression #185
              </span>
            </div>
            <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-4 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-[#3A3A38]/50 flex">
                <span className="w-8 select-none text-[#3A3A38]/40">183</span>
                <span>{"// Invariant: payment decisions above threshold require human review"}</span>
              </div>
              <div className="text-[#3A3A38] flex">
                <span className="w-8 select-none text-[#3A3A38]/40">184</span>
                <span>{"if (riskScore > threshold) {"}</span>
              </div>
              <div className="flex bg-[#FF8C69]/15 -mx-4 px-4 py-1 border-l-2 border-[#FF8C69] text-[#1A3C2B] font-semibold">
                <span className="w-8 select-none text-[#FF8C69] font-bold">185</span>
                <span>decision = provider.score(tx);</span>
                <span className="ml-auto text-[9px] text-[#1A3C2B] font-mono uppercase tracking-widest self-center bg-white px-1.5 py-0.5 rounded-[2px] border border-[#FF8C69]/40 font-bold">
                  {locale === "vi" ? "THIẾU KIỂM SOÁT" : "MISSING GUARD"}
                </span>
              </div>
              <div className="text-[#3A3A38] flex">
                <span className="w-8 select-none text-[#3A3A38]/40">186</span>
                <span>{"}"}</span>
              </div>
            </div>
          </>
        );
      case 1: // Model
        return (
          <>
            <div className="flex items-center justify-between text-xs font-mono text-[#3A3A38] mb-2">
              <span className="font-bold text-[#1A3C2B]">models/risk-evaluation-graph.json</span>
              <span className="text-[#1A3C2B] font-mono text-[10px] bg-[#FAF9F6] border border-[#1A3C2B]/30 px-2 py-0.5 rounded-[2px] font-semibold">
                {t("pages.marketing.features.evidenceTitle")}
              </span>
            </div>
            <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-4 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-[#3A3A38]">{"{"}</div>
              <div className="text-[#1A3C2B] pl-4 font-bold">"targetModel": "credit-scoring-v3",</div>
              <div className="text-[#1A3C2B] pl-4">"highRiskThreshold": 0.82,</div>
              <div className="text-[#FF8C69] pl-4 font-bold">"autonomousExecutionAllowed": false,</div>
              <div className="text-[#3A3A38]/70 pl-4">"auditProvenanceSha": "e4f81c9d2f60a..."</div>
              <div className="text-[#3A3A38]">{"}"}</div>
            </div>
          </>
        );
      case 2: // Control
        return (
          <>
            <div className="flex items-center justify-between text-xs font-mono text-[#3A3A38] mb-2">
              <span className="font-bold text-[#1A3C2B]">compliance/rules/eu-ai-act-art14.ts</span>
              <span className="text-[#1A3C2B] font-mono text-[10px] bg-[#FAF9F6] border border-[#1A3C2B]/30 px-2 py-0.5 rounded-[2px] font-semibold">
                {t("pages.marketing.home.control")}
              </span>
            </div>
            <div className="rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-4 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-[#1A3C2B] font-bold">{"export const humanOversightControl = {"}</div>
              <div className="text-[#3A3A38] pl-4">statute: "EU AI Act Article 14",</div>
              <div className="text-[#3A3A38] pl-4">requirement: "Human oversight for high-risk AI",</div>
              <div className="text-[#FF8C69] pl-4 font-bold">status: "NON_COMPLIANT_UNVERIFIED"</div>
              <div className="text-[#1A3C2B] font-bold">{"};"}</div>
            </div>
          </>
        );
      case 3: // Finding
        return (
          <>
            <div className="flex items-center justify-between text-xs font-mono text-[#3A3A38] mb-2">
              <span className="font-bold text-[#FF8C69]">{t("pages.marketing.features.findingLabel")} #185</span>
              <span className="text-[#1A3C2B] font-mono text-[10px] bg-[#FAF9F6] border border-[#3A3A38]/20 px-2 py-0.5 rounded-[2px] font-semibold">
                {t("pages.marketing.features.findingMeta")}
              </span>
            </div>
            <div className="rounded-[2px] border border-[#FF8C69]/40 bg-[#FAF9F6] p-4 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-[#1A3C2B] font-bold">
                {t("pages.marketing.features.findingPreviewTitle")}
              </div>
              <p className="text-[#3A3A38] text-xs mt-1.5 leading-relaxed font-sans">
                {t("pages.marketing.features.findingEvidence")}
              </p>
            </div>
          </>
        );
    }
  };

  return (
    <div className="overflow-hidden rounded-[2px] border border-[#3A3A38]/30 bg-[#F7F7F5] shadow-none">
      {/* Blueprint Window header */}
      <div className="flex items-center justify-between border-b border-[#3A3A38]/20 bg-[#FAF9F6] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-[1px] bg-[#1A3C2B]" />
          <span className="font-mono text-[11px] font-bold text-[#1A3C2B]">
            {t("pages.marketing.features.pinnedRepo")}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#1A3C2B]/30 bg-white px-2 py-0.5 font-mono text-[10px] text-[#1A3C2B] font-bold uppercase tracking-wider">
          <GitBranch className="h-3 w-3 text-[#1A3C2B]" /> main@7f3a9c1
        </span>
      </div>

      {/* Code Editor Panel */}
      <div className="p-5">
        {renderTabContent()}

        {/* Tab Pills with 0px radius & 1px hairlines */}
        <div className="mt-5 grid grid-cols-4 gap-1.5">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isSelected = activeTab === idx;
            return (
              <button
                type="button"
                key={tab.label}
                onClick={() => setActiveTab(idx)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-[2px] px-2.5 py-2 text-[11px] font-mono font-semibold uppercase tracking-wider transition-all duration-150 cursor-pointer",
                  isSelected
                    ? "bg-[#1A3C2B] text-[#F7F7F5] border border-[#1A3C2B]"
                    : "bg-[#FAF9F6] text-[#3A3A38] border border-[#3A3A38]/20 hover:border-[#1A3C2B] hover:text-[#1A3C2B]"
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="truncate">{t(tab.label)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EnhancedHumanContextPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const [selectedOption, setSelectedOption] = useState("manual");

  const options = [
    {
      id: "auto",
      key: "pages.marketing.features.choiceAutomatic",
      detail:
        locale === "vi"
          ? "Đã lưu vào nhật ký: Áp dụng biện pháp kiểm soát tự động đối với luồng xử lý này."
          : "Recorded: Automated control applied to this execution path.",
    },
    {
      id: "manual",
      key: "pages.marketing.features.choiceManual",
      detail:
        locale === "vi"
          ? "Đã lưu vào nhật ký: Yêu cầu con người rà soát thủ công khi rủi ro vượt ngưỡng."
          : "Recorded: Manual oversight required when risk score exceeds threshold.",
    },
    {
      id: "none",
      key: "pages.marketing.features.choiceNone",
      detail:
        locale === "vi"
          ? "Cảnh báo: Không có bước rà soát bổ sung sẽ kích hoạt cờ đỏ trong kết quả phân tích khoảng thiếu."
          : "Warning: Absence of review triggers a flagged item in gap analysis.",
    },
  ];

  const currentOption = options.find((o) => o.id === selectedOption) || options[1];

  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[#3A3A38]/30 bg-[#F7F7F5] p-6 shadow-none">
      {/* 4 L-shaped corner markers (10px x 10px) in #1A3C2B */}
      <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
      <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
      <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold">
          <AlertTriangle className="h-3 w-3 text-[#FF8C69]" />
          {t("pages.marketing.features.contextNeeded")}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
          {locale === "vi" ? "LÀM RÕ BỐI CẢNH" : "CLARIFICATION TURN"}
        </span>
      </div>

      <p className="mt-4 text-lg font-bold leading-snug text-[#1A3C2B]">
        {t("pages.marketing.features.questionPrompt")}
      </p>

      <div className="mt-5 space-y-2.5">
        {options.map((opt) => {
          const isSelected = selectedOption === opt.id;
          return (
            <button
              type="button"
              key={opt.id}
              onClick={() => setSelectedOption(opt.id)}
              className={cn(
                "group flex w-full items-center justify-between rounded-[2px] border p-3.5 text-left text-xs font-mono transition-all duration-150 cursor-pointer",
                isSelected
                  ? "border-[#1A3C2B] bg-white text-[#1A3C2B] font-bold shadow-none"
                  : "border-[#3A3A38]/20 bg-[#FAF9F6] text-[#3A3A38] hover:border-[#1A3C2B]/40 hover:bg-white"
              )}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-[1px] border text-[10px] transition-colors",
                    isSelected
                      ? "border-[#1A3C2B] bg-[#1A3C2B] text-[#F7F7F5] font-bold"
                      : "border-[#3A3A38]/40 bg-transparent"
                  )}
                >
                  {isSelected && "✓"}
                </div>
                <span>{t(opt.key)}</span>
              </div>
              <span className={cn(
                "text-[10px] font-mono tracking-wider uppercase",
                isSelected ? "text-[#1A3C2B] opacity-100" : "opacity-0 group-hover:opacity-60 text-[#3A3A38]"
              )}>
                {isSelected ? (locale === "vi" ? "[ĐÃ CHỌN]" : "[ACTIVE]") : (locale === "vi" ? "CHỌN" : "SELECT")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dynamic feedback panel reflecting the selected choice */}
      <div className="mt-4 rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-3 text-xs text-[#3A3A38]">
        <span className="font-mono font-bold text-[#1A3C2B] mr-2 uppercase tracking-wide">
          {locale === "vi" ? "NHẬT KÝ KIỂM TOÁN:" : "AUDIT RECORD:"}
        </span>
        <span className="font-sans text-xs">{currentOption.detail}</span>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-[#3A3A38]/20 pt-3 text-[11px] font-mono text-[#3A3A38]/70">
        <span className="truncate max-w-[360px]">{t("pages.marketing.features.humanContextDescription")}</span>
        <span className="text-[#1A3C2B] font-bold">1 / 1 Required</span>
      </div>
    </div>
  );
}

export function EnhancedFindingPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const [viewMode, setViewMode] = useState<"summary" | "ast">("summary");
  const [reviewed, setReviewed] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-[2px] border border-[#3A3A38]/30 bg-[#F7F7F5] p-6 shadow-none">
      <div className="flex items-center justify-between">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest font-bold",
          reviewed
            ? "border-[#1A3C2B] bg-[#9EFFBF]/30 text-[#1A3C2B]"
            : "border-[#FF8C69] bg-[#FF8C69]/20 text-[#1A3C2B]"
        )}>
          {reviewed ? <CheckCircle2 className="h-3 w-3 text-[#1A3C2B]" /> : <AlertTriangle className="h-3 w-3 text-[#FF8C69]" />}
          <span>
            {reviewed
              ? (locale === "vi" ? "ĐÃ DUYỆT RÀ SOÁT" : "REVIEW CONFIRMED")
              : t("pages.marketing.features.findingLabel")}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
          EU AI Act · Article 14
        </span>
      </div>

      <h3 className="mt-4 text-xl font-bold tracking-tight text-[#1A3C2B]">
        {t("pages.marketing.features.findingPreviewTitle")}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono">
        <span className={cn(
          "rounded-[2px] border px-2 py-0.5 font-bold uppercase tracking-wider",
          reviewed
            ? "bg-[#9EFFBF]/40 border-[#1A3C2B]/30 text-[#1A3C2B]"
            : "bg-[#FF8C69]/30 border-[#FF8C69]/50 text-[#1A3C2B]"
        )}>
          {reviewed
            ? (locale === "vi" ? "ĐANG KHẮC PHỤC" : "REMEDIATION PENDING")
            : (locale === "vi" ? "MỨC ĐỘ CAO" : "HIGH IMPACT")}
        </span>
        <span className="text-[#3A3A38]/40">•</span>
        <span className="text-[#3A3A38]">{t("pages.marketing.features.findingMeta")}</span>
      </div>

      {/* Toggle View Mode between Summary & AST Trace */}
      <div className="mt-5 rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-4">
        {viewMode === "summary" ? (
          <div>
            <div className="flex items-center justify-between text-xs font-mono font-bold text-[#1A3C2B]">
              <span className="flex items-center gap-1.5">
                <FileSearch className="h-3.5 w-3.5 text-[#1A3C2B]" />
                {t("pages.marketing.features.evidenceLabel")}
              </span>
              <span className="text-[10px] text-[#3A3A38]/60">HASH: 8A4F…11C2</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#3A3A38] font-sans">
              {t("pages.marketing.features.findingEvidence")}
            </p>
          </div>
        ) : (
          <div className="font-mono text-xs">
            <div className="text-[#1A3C2B] font-bold mb-1 uppercase tracking-wider text-[10px]">
              {locale === "vi" ? "CÂY THỰC THI MÃ NGUỒN AST:" : "AST CALL TREE TRAVERSAL:"}
            </div>
            <div className="text-[#3A3A38]/80">↳ FunctionDeclaration: processTransaction()</div>
            <div className="text-[#3A3A38]/80 pl-4">↳ IfStatement (test: riskScore &gt; threshold)</div>
            <div className="text-[#FF8C69] pl-8 font-bold">
              ↳ DirectExecution: provider.score(tx) [
              {locale === "vi" ? "CHƯA CÓ RÀ SOÁT" : "MISSING OVERSIGHT"}
              ]
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => setViewMode(viewMode === "summary" ? "ast" : "summary")}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-[2px] border px-4 text-xs font-mono font-semibold uppercase tracking-wider transition-all cursor-pointer active:scale-95",
            viewMode === "ast"
              ? "border-[#1A3C2B] bg-[#1A3C2B] text-[#F7F7F5]"
              : "border-[#3A3A38]/30 bg-[#FAF9F6] text-[#1A3C2B] hover:bg-white"
          )}
        >
          <Code2 className="h-3.5 w-3.5" />
          <span>
            {viewMode === "ast"
              ? (locale === "vi" ? "XEM TÓM TẮT" : "VIEW SUMMARY")
              : t("pages.marketing.features.openSource")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setReviewed(!reviewed)}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-[2px] px-4 text-xs font-mono font-semibold uppercase tracking-wider transition-all cursor-pointer active:scale-95 border",
            reviewed
              ? "bg-[#FAF9F6] text-[#3A3A38] border-[#3A3A38]/30"
              : "bg-[#1A3C2B] text-[#F7F7F5] border-[#1A3C2B] hover:bg-[#23503a]"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            {reviewed
              ? (locale === "vi" ? "ĐÃ DUYỆT ✓" : "APPROVED ✓")
              : t("pages.marketing.features.reviewFinding")}
          </span>
        </button>
      </div>
    </div>
  );
}

export function EnhancedRemediationPreview() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <div className="overflow-hidden rounded-[2px] border border-[#3A3A38]/30 bg-[#F7F7F5] p-6 shadow-none">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#1A3C2B]/30 bg-[#9EFFBF]/30 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold">
          <ShieldCheck className="h-3 w-3 text-[#1A3C2B]" />
          {locale === "vi" ? "KẾT QUẢ TÁI KIỂM TOÁN" : "VERIFICATION RESULT"}
        </span>
        <span className="font-mono text-xs text-[#3A3A38]/70">PR #104 · commit 4f2a1b9</span>
      </div>

      <div className="mt-4 rounded-[2px] border border-[#3A3A38]/20 bg-[#FAF9F6] p-4 font-mono text-[12px] leading-relaxed">
        <div className="text-muted-foreground select-none pb-1.5 text-[11px] flex items-center justify-between border-b border-[#3A3A38]/10 mb-2">
          <span>{locale === "vi" ? "// Phạm vi sửa đổi được quét lại:" : "// Re-scanned scope after developer fix:"}</span>
          <span className="text-emerald-700 font-bold">{locale === "vi" ? "✓ ĐÃ ĐẠT CHUẨN" : "✓ COMPLIANT"}</span>
        </div>
        <div className="bg-[#9EFFBF]/25 -mx-4 px-4 py-1.5 text-[#1A3C2B] border-l-2 border-[#1A3C2B] font-medium">
          <span>✓ {locale === "vi" ? "Quy tắc: Giám sát con người đối với quyết định rủi ro cao" : "Rule: Human oversight for high-risk decisions"}</span>
        </div>
        <div className="mt-2 text-xs text-[#3A3A38]/80 font-sans">
          {locale === "vi" 
            ? "Mạch bằng chứng gốc được bảo lưu: Commit mới khắc phục vi phạm mà không làm mất lịch sử đánh giá ban đầu."
            : "Original audit trail preserved: New commit resolves finding while retaining full initial assessment lineage."}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[#3A3A38]/20 pt-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
            {t("pages.marketing.features.verificationSource")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-[#1A3C2B] flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationPinned")}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
            {t("pages.marketing.features.verificationFinding")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-[#1A3C2B] flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationResolved")}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[#3A3A38]/70 font-semibold">
            {t("pages.marketing.features.verificationGate")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-[#1A3C2B] flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            {t("pages.marketing.features.verificationPassed")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FeaturesCapabilitiesMosaicGrid({
  capabilities,
}: {
  capabilities: readonly (readonly [string, string, string, string])[];
}) {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <section
      data-section="workspace-capabilities"
      className="relative overflow-hidden border-t border-[#3A3A38]/20 bg-[#F7F7F5] py-24"
    >
      <TechnicalBlueprintBackground />

      <div className="relative z-10 mx-auto max-w-[1240px] px-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#1A3C2B]/30 bg-[#FAF9F6] px-3.5 py-1 text-[11px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold mb-4 shadow-none">
            <span className="h-2 w-2 bg-[#1A3C2B]" />
            <span>{t("pages.marketing.features.capabilitiesEyebrow")}</span>
          </div>
          <h2 className="mx-auto max-w-[800px] text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#1A3C2B]">
            {t("pages.marketing.features.capabilitiesTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-[700px] text-base sm:text-lg text-[#3A3A38]">
            {t("pages.marketing.features.capabilitiesDescription")}
          </p>
        </div>

        {/* Bento Grid: 1px gap separating the cells with colored left-border accent */}
        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {capabilities.map(([number, titleKey, descKey, metaKey], idx) => {
            const accents = ["border-l-[#1A3C2B]", "border-l-[#FF8C69]", "border-l-[#F4D35E]"];
            const accent = accents[idx % accents.length];
            return (
              <div
                key={number}
                className={cn(
                  "group relative flex flex-col justify-between rounded-[2px] border border-[#3A3A38]/20 border-l-4 bg-[#FAF9F6] p-8 transition-all duration-200 hover:border-[#1A3C2B]/50 hover:bg-white shadow-none",
                  accent
                )}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#1A3C2B]">
                      PHASE {number}
                    </span>
                    <div className="h-2 w-2 rounded-[1px] bg-[#1A3C2B]/50 group-hover:bg-[#1A3C2B] transition-colors" />
                  </div>

                  <h3 className="mt-6 text-xl font-bold tracking-tight text-[#1A3C2B] group-hover:text-[#23503a] transition-colors">
                    {t(titleKey)}
                  </h3>

                  <p className="mt-3 text-xs leading-relaxed text-[#3A3A38] font-sans">
                    {t(descKey)}
                  </p>
                </div>

                <div className="mt-8 border-t border-[#3A3A38]/20 pt-4">
                  <p className="font-mono text-[11px] text-[#3A3A38]/80 font-bold flex items-center justify-between uppercase tracking-wider">
                    <span>{t(metaKey)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#3A3A38]/50 group-hover:text-[#1A3C2B] transition-colors" />
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FeaturesFinalCtaSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <section
      data-section="final-cta"
      className="relative overflow-hidden border-t border-[#3A3A38]/20 bg-[#F7F7F5] py-24 text-center"
    >
      <TechnicalBlueprintBackground />

      {/* Technical Form CTA style box with 4 corner markers */}
      <div className="relative z-10 mx-auto max-w-[800px] border border-[#3A3A38]/30 bg-[#FAF9F6] p-10 sm:p-14 shadow-none rounded-[2px]">
        {/* Four L-shaped corner markers (10px x 10px) in #1A3C2B */}
        <span className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#1A3C2B]" />
        <span className="absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[#1A3C2B]" />
        <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[#1A3C2B]" />
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-[#1A3C2B]" />

        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1A3C2B] leading-tight">
          {t("pages.marketing.features.ctaTitle")}
        </h2>

        <p className="mx-auto mt-6 max-w-[640px] text-base text-[#3A3A38] leading-relaxed">
          {t("pages.marketing.features.ctaDescription")}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-[2px] bg-[#1A3C2B] px-8 py-3.5 text-xs font-mono font-semibold uppercase tracking-wider text-[#F7F7F5] border border-[#1A3C2B] transition-all duration-150 hover:bg-[#23503a] active:translate-y-0.5"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-[2px] border border-[#3A3A38]/30 bg-white px-8 py-3.5 text-xs font-mono font-semibold uppercase tracking-wider text-[#1A3C2B] transition-all duration-150 hover:border-[#1A3C2B] hover:bg-[#FAF9F6]"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
