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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";

function resolveMarketingMessage(locale: Locale, key: string) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
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
      className="relative overflow-hidden border-b border-emerald-900/10 bg-gradient-to-b from-[#f8fafc] via-[#f1f5f9] to-[#ffffff] py-20 lg:py-28"
    >
      {/* Background Soft Emerald Aurora & Dot Grid Pattern */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 h-[550px] w-[850px] rounded-full bg-emerald-400/15 blur-[120px]" />
        <div className="absolute top-[15%] left-[15%] h-[350px] w-[500px] rounded-full bg-teal-300/15 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#059669_0.75px,transparent_0.75px)] [background-size:24px_24px] opacity-[0.12] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-6 text-center">
        {/* Fit-content Pill Badge from canonical i18n */}
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-800 shadow-[0_2px_8px_rgba(16,185,129,0.1)] mb-6">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
          <span>{t("pages.marketing.features.eyebrow")}</span>
          <span className="h-1 w-1 rounded-full bg-emerald-500" />
          <span className="text-emerald-700">
            {locale === "vi" ? "Kiến trúc hệ thống" : "Architecture Blueprint"}
          </span>
        </div>

        <h1 className="mx-auto max-w-[920px] text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.18]">
          {title}
        </h1>

        <p className="mx-auto mt-6 max-w-[760px] text-lg sm:text-xl text-slate-600 leading-relaxed font-normal">
          {description}
        </p>

        {/* Tactile Keycap Actions (Bright & Clear) */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_2px_4px_rgba(5,150,105,0.25),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_0_rgba(0,0,0,0.15)] transition-all duration-150 hover:bg-emerald-500 active:translate-y-0.5 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-150 hover:border-emerald-600/40 hover:bg-slate-50 hover:text-slate-900 active:translate-y-0.5"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>

        {/* Canonical System Stats Strip */}
        <div className="mt-14 grid grid-cols-2 gap-4 border-t border-slate-200/80 pt-8 sm:grid-cols-4 max-w-4xl mx-auto">
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-slate-900">100%</span>
            <span className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-medium">
              {locale === "vi" ? "Truy vết mã nguồn" : "AST Traceable"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-emerald-600">0</span>
            <span className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-medium">
              {locale === "vi" ? "Phát hiện suy diễn sai" : "Hallucinated Findings"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-slate-900">SHA-256</span>
            <span className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-medium">
              {locale === "vi" ? "Nguồn gốc kiểm toán" : "Audit Provenance"}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-teal-600">CI/CD</span>
            <span className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-medium">
              {locale === "vi" ? "Cổng kiểm soát tự động" : "Automated Gateways"}
            </span>
          </div>
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
    { label: "pages.marketing.home.source", icon: Code2 },
    { label: "pages.marketing.home.model", icon: Cpu },
    { label: "pages.marketing.home.control", icon: Lock },
    { label: "pages.marketing.home.finding", icon: AlertTriangle },
  ];

  // Dynamic content based on clicked tab with crisp light code aesthetics
  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // Source
        return (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span className="font-mono font-medium text-emerald-700">apps/payment/risk-policy.ts</span>
              <span className="text-emerald-800 font-mono text-[11px] bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                AST Node: CallExpression #185
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-sm">
              <div className="text-slate-400 flex">
                <span className="w-9 select-none text-slate-400">183</span>
                <span>{"// Invariant: payment decisions above threshold require human review"}</span>
              </div>
              <div className="text-slate-700 flex">
                <span className="w-9 select-none text-slate-400">184</span>
                <span>{"if (riskScore > threshold) {"}</span>
              </div>
              <div className="flex bg-rose-50 -mx-4 px-4 py-1 border-l-3 border-rose-500 text-rose-900 font-medium">
                <span className="w-9 select-none text-rose-500 font-bold">185</span>
                <span>decision = provider.score(tx);</span>
                <span className="ml-auto text-[10px] text-rose-700 font-sans tracking-wide self-center bg-rose-100 px-2 py-0.5 rounded border border-rose-200 font-semibold">
                  {locale === "vi" ? "THIẾU KIỂM SOÁT" : "MISSING GUARD"}
                </span>
              </div>
              <div className="text-slate-700 flex">
                <span className="w-9 select-none text-slate-400">186</span>
                <span>{"}"}</span>
              </div>
            </div>
          </>
        );
      case 1: // Model
        return (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span className="font-mono font-medium text-teal-700">models/risk-evaluation-graph.json</span>
              <span className="text-teal-800 font-mono text-[11px] bg-teal-50 border border-teal-200 px-2 py-0.5 rounded font-medium">
                {t("pages.marketing.features.evidenceTitle")}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-sm">
              <div className="text-slate-600">{"{"}</div>
              <div className="text-teal-800 pl-4 font-medium">"targetModel": "credit-scoring-v3",</div>
              <div className="text-teal-800 pl-4">"highRiskThreshold": 0.82,</div>
              <div className="text-amber-800 pl-4 font-medium">"autonomousExecutionAllowed": false,</div>
              <div className="text-slate-500 pl-4">"auditProvenanceSha": "e4f81c9d2f60a..."</div>
              <div className="text-slate-600">{"}"}</div>
            </div>
          </>
        );
      case 2: // Control
        return (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span className="font-mono font-medium text-cyan-700">compliance/rules/eu-ai-act-art14.ts</span>
              <span className="text-cyan-800 font-mono text-[11px] bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded font-medium">
                {t("pages.marketing.home.control")}
              </span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-sm">
              <div className="text-slate-800 font-semibold">{"export const humanOversightControl = {"}</div>
              <div className="text-slate-700 pl-4">statute: "EU AI Act Article 14",</div>
              <div className="text-slate-700 pl-4">requirement: "Human oversight for high-risk AI",</div>
              <div className="text-rose-700 pl-4 font-medium">status: "NON_COMPLIANT_UNVERIFIED"</div>
              <div className="text-slate-800 font-semibold">{"};"}</div>
            </div>
          </>
        );
      case 3: // Finding
        return (
          <>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span className="font-mono font-semibold text-rose-700">{t("pages.marketing.features.findingLabel")} #185</span>
              <span className="text-rose-800 font-mono text-[11px] bg-rose-50 border border-rose-200 px-2 py-0.5 rounded font-medium">
                {t("pages.marketing.features.findingMeta")}
              </span>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-sm">
              <div className="text-rose-900 font-bold">
                {t("pages.marketing.features.findingPreviewTitle")}
              </div>
              <p className="text-slate-600 text-xs mt-1.5 leading-relaxed font-sans">
                {t("pages.marketing.features.findingEvidence")}
              </p>
            </div>
          </>
        );
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
      {/* Window title bar */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400" />
          <div className="h-3 w-3 rounded-full bg-amber-400" />
          <div className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-2 font-mono text-xs text-slate-600 font-medium">
            {t("pages.marketing.features.pinnedRepo")}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] text-emerald-800 font-medium">
          <GitBranch className="h-3 w-3 text-emerald-600" /> main@7f3a9c1
        </span>
      </div>

      {/* Code Editor Panel */}
      <div className="p-6">
        {renderTabContent()}

        {/* Tab Pills */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isSelected = activeTab === idx;
            return (
              <button
                type="button"
                key={tab.label}
                onClick={() => setActiveTab(idx)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all duration-150 cursor-pointer active:scale-95",
                  isSelected
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm"
                    : "bg-slate-100/70 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-emerald-600" : "text-slate-500")} />
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          {t("pages.marketing.features.contextNeeded")}
        </span>
        <span className="font-mono text-[11px] text-slate-500 font-medium">
          {locale === "vi" ? "Làm rõ bối cảnh" : "Clarification Turn"}
        </span>
      </div>

      <p className="mt-4 text-lg font-semibold leading-snug text-slate-900">
        {t("pages.marketing.features.questionPrompt")}
      </p>

      <div className="mt-5 space-y-3">
        {options.map((opt) => {
          const isSelected = selectedOption === opt.id;
          return (
            <button
              type="button"
              key={opt.id}
              onClick={() => setSelectedOption(opt.id)}
              className={cn(
                "group flex w-full items-center justify-between rounded-xl border p-4 text-left text-sm transition-all duration-150 cursor-pointer",
                isSelected
                  ? "border-emerald-500 bg-emerald-50/70 text-slate-900 shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border text-xs transition-colors",
                    isSelected
                      ? "border-emerald-600 bg-emerald-600 text-white font-bold"
                      : "border-slate-400 bg-transparent"
                  )}
                >
                  {isSelected && "✓"}
                </div>
                <span className="font-medium">{t(opt.key)}</span>
              </div>
              <span className={cn(
                "text-xs font-mono font-semibold transition-opacity",
                isSelected ? "text-emerald-700 opacity-100" : "opacity-0 group-hover:opacity-60 text-slate-400"
              )}>
                {isSelected ? (locale === "vi" ? "ĐÃ CHỌN" : "ACTIVE") : (locale === "vi" ? "CHỌN" : "SELECT")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dynamic feedback panel reflecting the selected choice */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 transition-all">
        <span className="font-mono font-bold text-emerald-700 mr-2">
          {locale === "vi" ? "Ghi nhận đánh giá:" : "Assessment Record:"}
        </span>
        <span className="text-slate-600">{currentOption.detail}</span>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
        <span>{t("pages.marketing.features.humanContextDescription").slice(0, 48)}…</span>
        <span className="font-mono text-emerald-700 font-semibold">SHA-256</span>
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
          reviewed
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-rose-300 bg-rose-50 text-rose-800"
        )}>
          {reviewed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
          <span>
            {reviewed
              ? (locale === "vi" ? "Đã xác nhận rà soát" : "Review Confirmed")
              : t("pages.marketing.features.findingLabel")}
          </span>
        </span>
        <span className="font-mono text-xs text-slate-500 font-medium">
          EU AI Act · Article 14
        </span>
      </div>

      <h3 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
        {t("pages.marketing.features.findingPreviewTitle")}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono">
        <span className={cn(
          "rounded border px-2 py-0.5 font-semibold",
          reviewed
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-rose-50 border-rose-200 text-rose-800"
        )}>
          {reviewed
            ? (locale === "vi" ? "ĐANG KHẮC PHỤC" : "REMEDIATION PENDING")
            : (locale === "vi" ? "MỨC ĐỘ CAO" : "HIGH IMPACT")}
        </span>
        <span className="text-slate-400">•</span>
        <span className="text-slate-600">{t("pages.marketing.features.findingMeta")}</span>
      </div>

      {/* Toggle View Mode between Summary & AST Trace */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        {viewMode === "summary" ? (
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
              <span className="flex items-center gap-1.5">
                <FileSearch className="h-3.5 w-3.5 text-emerald-600" />
                {t("pages.marketing.features.evidenceLabel")}
              </span>
              <span className="font-mono text-[11px] text-slate-500">Hash: 8a4f…11c2</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 font-normal">
              {t("pages.marketing.features.findingEvidence")}
            </p>
          </div>
        ) : (
          <div className="font-mono text-xs">
            <div className="text-emerald-700 font-semibold mb-1">
              {locale === "vi" ? "Cây thực thi mã nguồn AST:" : "AST Call Tree Traversal:"}
            </div>
            <div className="text-slate-600">↳ FunctionDeclaration: processTransaction()</div>
            <div className="text-slate-600 pl-4">↳ IfStatement (test: riskScore &gt; threshold)</div>
            <div className="text-rose-700 pl-8 font-bold">
              ↳ DirectExecution: provider.score(tx) [
              {locale === "vi" ? "Chưa có rà soát" : "Missing Oversight"}
              ]
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setViewMode(viewMode === "summary" ? "ast" : "summary")}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold transition-all cursor-pointer active:scale-95",
            viewMode === "ast"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          )}
        >
          <Code2 className="h-3.5 w-3.5 text-slate-500" />
          <span>
            {viewMode === "ast"
              ? (locale === "vi" ? "Xem tóm tắt" : "View Summary")
              : t("pages.marketing.features.openSource")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setReviewed(!reviewed)}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-sm transition-all cursor-pointer active:scale-95",
            reviewed
              ? "bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            {reviewed
              ? (locale === "vi" ? "Đã duyệt ✓" : "Approved ✓")
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
  const [remediated, setRemediated] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {t("pages.marketing.features.proposedChange")}
        </span>
        <button
          type="button"
          onClick={() => setRemediated(!remediated)}
          className="text-xs font-mono font-medium text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer flex items-center gap-1"
        >
          <RefreshCw className={cn("h-3 w-3", remediated && "rotate-180 transition-transform")} />
          <span>
            {remediated
              ? (locale === "vi" ? "Khôi phục gốc" : "Reset original")
              : (locale === "vi" ? "Áp dụng bản vá" : "Apply patch")}
          </span>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-[#f8fafc] p-4 font-mono text-[13px] leading-relaxed shadow-sm">
        {!remediated ? (
          <>
            <div className="bg-rose-50 -mx-4 px-4 py-1 text-rose-800 border-l-3 border-rose-500 font-medium">
              <span>- return blockPayment;</span>
            </div>
            <div className="bg-emerald-50 -mx-4 px-4 py-1 text-emerald-800 border-l-3 border-emerald-500 mt-1 font-medium">
              <span>+ const review = await requireHumanReview(tx);</span>
            </div>
            <div className="bg-emerald-50 -mx-4 px-4 py-1 text-emerald-800 border-l-3 border-emerald-500 font-medium">
              <span>+ return review.approved ? blockPayment : continueFlow;</span>
            </div>
          </>
        ) : (
          <div className="bg-emerald-50 -mx-4 px-4 py-2 text-emerald-900 border-l-3 border-emerald-600">
            <div className="text-xs text-emerald-700 mb-1 font-bold">
              {locale === "vi" ? "// ĐÃ BỔ SUNG: Cơ chế rà soát của con người" : "// PATCHED: Human oversight enforced"}
            </div>
            <div>const review = await requireHumanReview(tx);</div>
            <div>return review.approved ? blockPayment : continueFlow;</div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        <div>
          <p className="text-[11px] font-medium text-slate-500">
            {t("pages.marketing.features.verificationSource")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationPinned")}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-500">
            {t("pages.marketing.features.verificationFinding")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationResolved")}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-500">
            {t("pages.marketing.features.verificationGate")}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-teal-700 flex items-center gap-1">
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
      className="relative overflow-hidden border-t border-slate-200/80 bg-slate-50/60 py-24"
    >
      <div className="mx-auto max-w-[1240px] px-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-50 px-3.5 py-1 text-xs font-semibold text-emerald-800 shadow-sm mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
            <span>{t("pages.marketing.features.capabilitiesEyebrow")}</span>
          </div>
          <h2 className="mx-auto max-w-[800px] text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900">
            {t("pages.marketing.features.capabilitiesTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-[700px] text-base sm:text-lg text-slate-600">
            {t("pages.marketing.features.capabilitiesDescription")}
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {capabilities.map(([number, titleKey, descKey, metaKey]) => (
            <div
              key={number}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:border-emerald-400 hover:shadow-[0_12px_30px_rgba(16,185,129,0.12)]"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-700">
                    Phase {number}
                  </span>
                  <div className="h-2 w-2 rounded-full bg-emerald-400 group-hover:bg-emerald-600 transition-colors" />
                </div>

                <h3 className="mt-6 text-xl font-bold tracking-tight text-slate-900 group-hover:text-emerald-800 transition-colors">
                  {t(titleKey)}
                </h3>

                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  {t(descKey)}
                </p>
              </div>

              <div className="mt-8 border-t border-slate-100 pt-4">
                <p className="font-mono text-xs text-slate-500 font-medium flex items-center justify-between">
                  <span>{t(metaKey)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </p>
              </div>
            </div>
          ))}
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
      className="relative overflow-hidden border-t border-slate-200 bg-gradient-to-b from-white via-emerald-50/20 to-slate-50 py-24 text-center"
    >
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[320px] w-[650px] rounded-full bg-emerald-300/15 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[800px] px-6">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
          {t("pages.marketing.features.ctaTitle")}
        </h2>

        <p className="mx-auto mt-6 max-w-[640px] text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
          {t("pages.marketing.features.ctaDescription")}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_2px_4px_rgba(5,150,105,0.25),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-2px_0_rgba(0,0,0,0.15)] transition-all duration-150 hover:bg-emerald-500 active:translate-y-0.5"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-7 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-150 hover:border-emerald-600/40 hover:bg-slate-50"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
