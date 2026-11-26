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
  Terminal,
  Cpu,
  Layers,
  ArrowRight,
  Sparkles,
  Lock,
  RefreshCw,
  Search,
  ExternalLink,
  SlidersHorizontal,
  History,
  FileCheck,
  Check,
  Eye,
  FileCode,
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
      className="relative overflow-hidden border-b border-white/[0.08] bg-[#030712] py-20 lg:py-28"
    >
      {/* Background Aurora & Grid Pattern */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-emerald-500/10 blur-[130px]" />
        <div className="absolute top-[20%] left-[20%] h-[350px] w-[500px] rounded-full bg-teal-500/10 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1240px] px-6 text-center">
        {/* Subtle fit-content pill badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-1 text-xs font-semibold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)] mb-6">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
          <span>{t("pages.marketing.features.eyebrow")}</span>
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          <span className="text-emerald-400/80">Architecture Blueprint</span>
        </div>

        <h1 className="mx-auto max-w-[900px] text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.15]">
          {title}
        </h1>

        <p className="mx-auto mt-6 max-w-[760px] text-lg sm:text-xl text-neutral-400 leading-relaxed">
          {description}
        </p>

        {/* Tactile Keycap Actions */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-2px_0_rgba(0,0,0,0.2)] transition-all duration-150 hover:bg-emerald-400 active:translate-y-0.5 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-neutral-900/80 px-6 py-3.5 text-sm font-semibold text-neutral-200 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.4)] transition-all duration-150 hover:border-white/20 hover:bg-neutral-800 active:translate-y-0.5"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>

        {/* Blueprint Stats Strip */}
        <div className="mt-14 grid grid-cols-2 gap-4 border-t border-white/[0.08] pt-8 sm:grid-cols-4 max-w-4xl mx-auto">
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-white">100%</span>
            <span className="text-xs text-neutral-400 mt-1 uppercase tracking-wider">AST Traceable</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-emerald-400">0</span>
            <span className="text-xs text-neutral-400 mt-1 uppercase tracking-wider">Hallucinated Findings</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-white">SHA-256</span>
            <span className="text-xs text-neutral-400 mt-1 uppercase tracking-wider">Audit Provenance</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-teal-400">CI/CD</span>
            <span className="text-xs text-neutral-400 mt-1 uppercase tracking-wider">Automated Gateways</span>
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

  // Dynamic content based on clicked tab
  const renderTabContent = () => {
    switch (activeTab) {
      case 0: // Source
        return (
          <>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
              <span className="font-mono text-emerald-400">apps/payment/risk-policy.ts</span>
              <span className="text-emerald-400 font-mono text-[11px] bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
                AST Node: CallExpression #185
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#070b14] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-inner transition-all duration-200">
              <div className="text-neutral-500 flex">
                <span className="w-9 select-none text-neutral-600">183</span>
                <span>{"// Invariant: payment decisions above threshold require human review"}</span>
              </div>
              <div className="text-neutral-400 flex">
                <span className="w-9 select-none text-neutral-600">184</span>
                <span>{"if (riskScore > threshold) {"}</span>
              </div>
              <div className="flex bg-rose-500/10 -mx-4 px-4 py-1 border-l-2 border-rose-500 text-rose-200">
                <span className="w-9 select-none text-rose-400/80 font-bold">185</span>
                <span className="font-semibold">decision = provider.score(tx);</span>
                <span className="ml-auto text-[10px] text-rose-400 font-sans tracking-wide self-center bg-rose-950/80 px-1.5 py-0.5 rounded border border-rose-800/60">
                  MISSING GUARD
                </span>
              </div>
              <div className="text-neutral-400 flex">
                <span className="w-9 select-none text-neutral-600">186</span>
                <span>{"}"}</span>
              </div>
            </div>
          </>
        );
      case 1: // Model
        return (
          <>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
              <span className="font-mono text-teal-400">models/risk-evaluation-graph.json</span>
              <span className="text-teal-400 font-mono text-[11px] bg-teal-950/60 border border-teal-800/40 px-2 py-0.5 rounded">
                Confidence: 0.994
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#070b14] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-inner">
              <div className="text-neutral-400">{"{"}</div>
              <div className="text-teal-300 pl-4">"targetModel": "credit-scoring-v3",</div>
              <div className="text-teal-300 pl-4">"highRiskThreshold": 0.82,</div>
              <div className="text-amber-300 pl-4">"autonomousExecutionAllowed": false,</div>
              <div className="text-neutral-400 pl-4">"auditProvenanceSha": "e4f81c9d2..."</div>
              <div className="text-neutral-400">{"}"}</div>
            </div>
          </>
        );
      case 2: // Control
        return (
          <>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
              <span className="font-mono text-cyan-400">compliance/rules/eu-ai-act-art14.ts</span>
              <span className="text-cyan-400 font-mono text-[11px] bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded">
                Statutory Rule: Active
              </span>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#070b14] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-inner">
              <div className="text-cyan-200">{"export const humanOversightControl = {"}</div>
              <div className="text-neutral-300 pl-4">statute: "EU AI Act Article 14",</div>
              <div className="text-neutral-300 pl-4">condition: "High-risk systems must enable human override",</div>
              <div className="text-rose-300 pl-4">status: "FAIL_UNMITIGATED_DIRECT_EXECUTION"</div>
              <div className="text-cyan-200">{"};"}</div>
            </div>
          </>
        );
      case 3: // Finding
        return (
          <>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
              <span className="font-mono text-rose-400">LCSP-FINDING-084.audit</span>
              <span className="text-rose-400 font-mono text-[11px] bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded">
                Severity: CRITICAL
              </span>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-[#160c14] p-4 font-mono text-[13px] leading-relaxed overflow-x-auto shadow-inner">
              <div className="text-rose-300 font-bold">CRITICAL: Autonomous decision bypasses human gateway</div>
              <p className="text-neutral-400 text-xs mt-1">
                Execution path at risk-policy.ts:185 allows third-party scoring response to return directly without human sign-off.
              </p>
            </div>
          </>
        );
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c121e]/90 shadow-2xl backdrop-blur-xl">
      {/* Window title bar */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-500/80" />
          <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
          <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          <span className="ml-2 font-mono text-xs text-neutral-400">
            {t("pages.marketing.features.pinnedRepo")}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
          <GitBranch className="h-3 w-3" /> main@7f3a9c1
        </span>
      </div>

      {/* Code Editor Panel with line highlighting */}
      <div className="p-5">
        {renderTabContent()}

        {/* Tab Pills required by tests */}
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
                  "flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 cursor-pointer active:scale-95",
                  isSelected
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                    : "bg-white/[0.03] text-neutral-400 border border-white/[0.05] hover:bg-white/[0.06] hover:text-white"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
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
      detail: locale === "vi" ? "Ghi nhận: Áp dụng rule set tự động cho mọi giao dịch" : "Recorded: Apply automated rule set across transactions",
    },
    {
      id: "manual",
      key: "pages.marketing.features.choiceManual",
      detail: locale === "vi" ? "Ghi nhận: Yêu cầu nhân viên phê duyệt khi điểm rủi ro vượt ngưỡng" : "Recorded: Require compliance staff sign-off on high scores",
    },
    {
      id: "none",
      key: "pages.marketing.features.choiceNone",
      detail: locale === "vi" ? "Cảnh báo: Không rà soát sẽ kích hoạt cờ đỏ điều khoản rủi ro cao" : "Warning: No additional review triggers high-risk non-compliance",
    },
  ];

  const currentOption = options.find((o) => o.id === selectedOption) || options[1];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c121e]/90 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("pages.marketing.features.contextNeeded")}
        </span>
        <span className="font-mono text-[11px] text-neutral-500">Step 2 of 4</span>
      </div>

      <p className="mt-4 text-lg font-medium leading-snug text-neutral-100">
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
                  ? "border-emerald-500/50 bg-emerald-950/30 text-white shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                  : "border-white/[0.08] bg-white/[0.02] text-neutral-300 hover:border-white/20 hover:bg-white/[0.04]"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border text-xs transition-colors",
                    isSelected
                      ? "border-emerald-400 bg-emerald-500 text-slate-950 font-bold"
                      : "border-neutral-600 bg-transparent"
                  )}
                >
                  {isSelected && "✓"}
                </div>
                <span>{t(opt.key)}</span>
              </div>
              <span className={cn(
                "text-xs font-mono transition-opacity",
                isSelected ? "text-emerald-400 opacity-100" : "opacity-0 group-hover:opacity-60 text-neutral-500"
              )}>
                {isSelected ? "ACTIVE CONTEXT" : "SELECT"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dynamic feedback panel reflecting the selected choice */}
      <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#070b14] p-3 text-xs text-neutral-300 transition-all">
        <span className="font-mono text-emerald-400 mr-2">Audit Ledger Impact:</span>
        <span className="text-neutral-400">{currentOption.detail}</span>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/[0.08] pt-4 text-xs text-neutral-400">
        <span>Recorded directly into Assessment Provenance Ledger</span>
        <span className="font-mono text-emerald-400">SHA-256 Signed</span>
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
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c121e]/90 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
          reviewed
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-rose-500/30 bg-rose-500/10 text-rose-400"
        )}>
          {reviewed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span>{reviewed ? (locale === "vi" ? "Đã xác nhận rà soát" : "Review Confirmed") : t("pages.marketing.features.findingLabel")}</span>
        </span>
        <span className="font-mono text-xs text-neutral-500">EU AI Act · Article 14</span>
      </div>

      <h3 className="mt-4 text-xl font-bold tracking-tight text-white">
        {t("pages.marketing.features.findingPreviewTitle")}
      </h3>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-mono text-neutral-400">
        <span className={cn(
          "rounded border px-2 py-0.5",
          reviewed
            ? "bg-emerald-950/70 border-emerald-900/50 text-emerald-300"
            : "bg-rose-950/70 border-rose-900/50 text-rose-300"
        )}>
          {reviewed ? "MITIGATION PENDING" : "HIGH SEVERITY"}
        </span>
        <span>•</span>
        <span>{t("pages.marketing.features.findingMeta")}</span>
      </div>

      {/* Toggle View Mode between Summary & AST Trace */}
      <div className="mt-5 rounded-xl border border-white/[0.08] bg-[#070b14] p-4">
        {viewMode === "summary" ? (
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
              <span className="flex items-center gap-1.5 text-neutral-200">
                <FileSearch className="h-3.5 w-3.5 text-emerald-400" />
                {t("pages.marketing.features.evidenceLabel")}
              </span>
              <span className="font-mono text-[11px] text-neutral-500">Hash: 8a4f…11c2</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {t("pages.marketing.features.findingEvidence")}
            </p>
          </div>
        ) : (
          <div className="font-mono text-xs">
            <div className="text-emerald-400 mb-1">AST Call Tree Traversal:</div>
            <div className="text-neutral-500">↳ FunctionDeclaration: processTransaction()</div>
            <div className="text-neutral-500 pl-4">↳ IfStatement (test: riskScore &gt; threshold)</div>
            <div className="text-rose-400 pl-8 font-bold">↳ DirectExecution: provider.score(tx) [VULNERABLE]</div>
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
              ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
              : "border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]"
          )}
        >
          <Code2 className="h-3.5 w-3.5 text-neutral-400" />
          <span>{viewMode === "ast" ? (locale === "vi" ? "Xem tóm tắt" : "View Summary") : t("pages.marketing.features.openSource")}</span>
        </button>

        <button
          type="button"
          onClick={() => setReviewed(!reviewed)}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-md transition-all cursor-pointer active:scale-95",
            reviewed
              ? "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>{reviewed ? (locale === "vi" ? "Đã duyệt ✓" : "Approved ✓") : t("pages.marketing.features.reviewFinding")}</span>
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
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c121e]/90 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t("pages.marketing.features.proposedChange")}
        </span>
        <button
          type="button"
          onClick={() => setRemediated(!remediated)}
          className="text-xs font-mono text-emerald-400 hover:underline cursor-pointer flex items-center gap-1"
        >
          <RefreshCw className={cn("h-3 w-3", remediated && "rotate-180 transition-transform")} />
          <span>{remediated ? (locale === "vi" ? "Khôi phục gốc" : "Reset original") : (locale === "vi" ? "Áp dụng bản vá" : "Apply patch")}</span>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.08] bg-[#070b14] p-4 font-mono text-[13px] leading-relaxed shadow-inner">
        {!remediated ? (
          <>
            <div className="bg-rose-500/10 -mx-4 px-4 py-1 text-rose-300 border-l-2 border-rose-500">
              <span>- return blockPayment;</span>
            </div>
            <div className="bg-emerald-500/10 -mx-4 px-4 py-1 text-emerald-300 border-l-2 border-emerald-500 mt-1">
              <span>+ const review = await requireHumanReview(tx);</span>
            </div>
            <div className="bg-emerald-500/10 -mx-4 px-4 py-1 text-emerald-300 border-l-2 border-emerald-500">
              <span>+ return review.approved ? blockPayment : continueFlow;</span>
            </div>
          </>
        ) : (
          <div className="bg-emerald-500/15 -mx-4 px-4 py-2 text-emerald-200 border-l-2 border-emerald-400">
            <div className="text-xs text-emerald-400 mb-1">// PATCHED: Human-in-the-loop oversight enforced</div>
            <div>const review = await requireHumanReview(tx);</div>
            <div>return review.approved ? blockPayment : continueFlow;</div>
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-4">
        <div>
          <p className="text-[11px] font-medium text-neutral-400">
            {t("pages.marketing.features.verificationSource")}
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationPinned")}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-neutral-400">
            {t("pages.marketing.features.verificationFinding")}
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {t("pages.marketing.features.verificationResolved")}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-neutral-400">
            {t("pages.marketing.features.verificationGate")}
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-teal-400 flex items-center gap-1">
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
      className="relative overflow-hidden border-t border-white/[0.08] bg-[#02050c] py-24"
    >
      <div className="mx-auto max-w-[1240px] px-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-1 text-xs font-semibold text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.12)] mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{t("pages.marketing.features.capabilitiesEyebrow")}</span>
          </div>
          <h2 className="mx-auto max-w-[800px] text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            {t("pages.marketing.features.capabilitiesTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-[700px] text-base sm:text-lg text-neutral-400">
            {t("pages.marketing.features.capabilitiesDescription")}
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {capabilities.map(([number, titleKey, descKey, metaKey]) => (
            <div
              key={number}
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c121e]/80 p-8 transition-all duration-300 hover:border-emerald-500/40 hover:bg-[#0f172a] hover:shadow-[0_0_30px_rgba(16,185,129,0.12)]"
            >
              <div className="absolute top-0 right-0 h-28 w-28 bg-emerald-500/[0.03] rounded-full blur-2xl group-hover:bg-emerald-500/[0.08] transition-all" />
              
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Phase {number}
                  </span>
                  <div className="h-2 w-2 rounded-full bg-emerald-500/50 group-hover:bg-emerald-400" />
                </div>

                <h3 className="mt-6 text-xl font-bold tracking-tight text-white group-hover:text-emerald-300 transition-colors">
                  {t(titleKey)}
                </h3>

                <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                  {t(descKey)}
                </p>
              </div>

              <div className="mt-8 border-t border-white/[0.08] pt-4">
                <p className="font-mono text-xs text-neutral-400 flex items-center justify-between">
                  <span>{t(metaKey)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-600 group-hover:text-emerald-400 transition-colors" />
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
      className="relative overflow-hidden border-t border-white/[0.08] bg-[#030712] py-24 text-center"
    >
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[350px] w-[700px] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[800px] px-6">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
          {t("pages.marketing.features.ctaTitle")}
        </h2>

        <p className="mx-auto mt-6 max-w-[640px] text-base sm:text-lg text-neutral-400 leading-relaxed">
          {t("pages.marketing.features.ctaDescription")}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/sign-up"
            className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-7 py-3.5 text-sm font-semibold text-slate-950 shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-2px_0_rgba(0,0,0,0.2)] transition-all duration-150 hover:bg-emerald-400 active:translate-y-0.5"
          >
            <span>{t("pages.marketing.nav.getStarted")}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href={`/${locale}/pricing`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-neutral-900/80 px-7 py-3.5 text-sm font-semibold text-neutral-200 backdrop-blur-sm shadow-sm transition-all duration-150 hover:border-white/20 hover:bg-neutral-800"
          >
            <span>{t("pages.marketing.features.viewPricing")}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
