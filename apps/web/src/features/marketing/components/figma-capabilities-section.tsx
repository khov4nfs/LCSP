"use client";

import { useState } from "react";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import { 
  MessageCircleIcon, 
  TargetIcon, 
  ShieldAlertIcon, 
  ShieldCheckIcon,
  SearchIcon,
  CheckCircle2Icon,
  ArrowRightIcon,
  GitCommitIcon
} from "lucide-react";

export function FigmaCapabilitiesSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMessage(locale as Locale, key as Parameters<typeof resolveMessage>[1]);
  const [activeTab, setActiveTab] = useState<"finding" | "request" | "recheck">("finding");
  const [isFixedDiff, setIsFixedDiff] = useState(false);

  return (
    <section
      data-section="figma-capabilities"
      className="relative w-full overflow-hidden bg-white py-20 text-[#101C29] border-b border-slate-200/60"
    >
      {/* Vercel subtle grid lines background */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-grid-slate opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_90%)]" 
      />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-8 md:px-[96px]">
        <div className="max-w-2xl scroll-reveal">
          <p className="text-xs font-semibold tracking-wider text-[#11545B] uppercase font-mono">
            {locale === "vi" ? "Năng lực kiểm toán" : "Audit Capabilities"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#101C29] sm:text-4xl">
            {t("pages.marketing.home.capabilitiesTitle")}
          </h2>
          <p className="mt-3 text-base text-[#48586A]">
            {t("pages.marketing.home.capabilitiesDescription")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* Main Large Card: Interactive Console dynamically reacting to tabs */}
          <div className="scroll-reveal scroll-delay-1 group relative flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white/95 p-8 text-[#101C29] shadow-xs transition-all duration-300 hover:border-[#31BDA7] hover:shadow-md">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-block rounded-md border border-[#31BDA7]/30 bg-[#ECF5F3] px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider text-[#11545B]">
                  {activeTab === "finding" && t("pages.marketing.home.capabilitiesMainEyebrow")}
                  {activeTab === "request" && (locale === "vi" ? "Hỏi đáp ngữ cảnh" : "Context Clarification")}
                  {activeTab === "recheck" && (locale === "vi" ? "Tái kiểm toán có mục tiêu" : "Targeted Re-Evaluation")}
                </span>

                {activeTab === "finding" && (
                  <button
                    type="button"
                    onClick={() => setIsFixedDiff(!isFixedDiff)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-[11px] font-semibold text-slate-700 transition-colors hover:border-[#31BDA7] hover:bg-[#ECF5F3] hover:text-[#11545B] cursor-pointer"
                  >
                    <span>{isFixedDiff ? (locale === "vi" ? "Đã sửa: 730 ngày" : "Remediated: 730d") : (locale === "vi" ? "Xem bản vá code" : "Preview code fix")}</span>
                    <span className="text-xs font-bold text-[#31BDA7]">⚡</span>
                  </button>
                )}
              </div>

              <h3 className="mt-4 text-2xl font-bold tracking-tight text-[#101C29]">
                {activeTab === "finding" && t("pages.marketing.home.capabilitiesMainTitle")}
                {activeTab === "request" && (locale === "vi" ? "Hỏi đúng thông tin khi kho mã chưa đủ ngữ cảnh." : "Targeted questions when code alone lacks context.")}
                {activeTab === "recheck" && (locale === "vi" ? "Chạy lại kiểm toán siêu tốc cho các thay đổi mới." : "Fast-track selective verification on new commits.")}
              </h3>

              <p className="mt-1 font-mono text-xs text-[#48586A]">
                {activeTab === "finding" && t("pages.marketing.home.capabilitiesMainTag")}
                {activeTab === "request" && "acme/notice-service • config/telemetry.json"}
                {activeTab === "recheck" && "Commit 4f2a1b9 • PR #104: Fix data retention"}
              </p>

              {/* Dynamic Console Panel based on selected Tab */}
              {activeTab === "finding" && (
                <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-6 shadow-2xs transition-all duration-300">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[#48586A] font-semibold">
                    {t("pages.marketing.home.capabilitiesMainReqLabel")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#101C29]">
                    {t("pages.marketing.home.capabilitiesMainReqValue")}
                  </p>

                  <div className="my-4 h-px w-full bg-slate-200" />

                  <p className="font-mono text-[11px] uppercase tracking-wider text-[#48586A] font-semibold">
                    {t("pages.marketing.home.capabilitiesMainEvidenceLabel")}
                  </p>
                  <div className="mt-2 space-y-1 font-mono text-xs text-[#334155] bg-white p-3.5 rounded-md border border-slate-200">
                    {isFixedDiff ? (
                      <>
                        <p className="text-red-600 line-through">↳ - retention_days = 90</p>
                        <p className="text-emerald-700 font-bold">↳ + retention_days = 730  # Fixed: Statutory 2-year min</p>
                      </>
                    ) : (
                      <>
                        <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence1")}</p>
                        <p>↳ {t("pages.marketing.home.capabilitiesMainEvidence2")}</p>
                      </>
                    )}
                  </div>

                  <div className={`mt-5 flex items-center gap-3 rounded-md border p-3 text-xs transition-all duration-300 ${
                    isFixedDiff 
                      ? "border-emerald-300/60 bg-emerald-50 text-emerald-900" 
                      : "border-amber-300/60 bg-amber-50 text-amber-900"
                  }`}>
                    {isFixedDiff ? (
                      <>
                        <ShieldCheckIcon className="size-4 text-emerald-600 shrink-0" />
                        <span className="font-bold text-emerald-900 font-mono text-[11px] uppercase tracking-wider">
                          {locale === "vi" ? "ĐÃ TUÂN THỦ:" : "COMPLIANT:"}
                        </span>
                        <span className="text-emerald-800">
                          {locale === "vi" ? "Thời hạn lưu trữ đã đạt chuẩn tối thiểu 2 năm luật định." : "Retention period satisfies the statutory minimum requirement."}
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlertIcon className="size-4 text-amber-600 shrink-0" />
                        <span className="font-bold text-amber-900 font-mono text-[11px] uppercase tracking-wider">
                          {t("pages.marketing.home.capabilitiesMainStatus")}:
                        </span>
                        <span className="text-amber-800">
                          {t("pages.marketing.home.capabilitiesMainStatusDetail")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "request" && (
                <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-6 shadow-2xs transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold uppercase text-slate-500">
                      {locale === "vi" ? "Câu hỏi xác minh ngữ cảnh" : "Context Verification Question"}
                    </span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      {locale === "vi" ? "Chờ phản hồi" : "Awaiting Input"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#101C29]">
                    {locale === "vi" 
                      ? "Dữ liệu nhật ký tài khoản này có được sao lưu sang vùng dữ liệu ngoài biên giới hay không?" 
                      : "Are these account audit logs replicated or transferred to foreign cloud regions?"}
                  </p>
                  
                  <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="font-bold text-[#11545B]">dev@acme.corp:</span>
                      <span>{locale === "vi" ? "Chỉ lưu trữ tại cụm máy chủ nội địa Hà Nội & TP.HCM theo tiêu chuẩn Tier-3." : "Stored exclusively in local Hanoi & HCMC Tier-3 clusters."}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs font-mono text-emerald-700">
                    <CheckCircle2Icon className="size-4 text-emerald-600" />
                    <span>{locale === "vi" ? "Đã ghi nhận bối cảnh vào cây bằng chứng AST." : "Context recorded into deterministic AST proof tree."}</span>
                  </div>
                </div>
              )}

              {activeTab === "recheck" && (
                <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/70 p-6 shadow-2xs transition-all duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitCommitIcon className="size-4 text-[#11545B]" />
                      <span className="font-mono text-xs font-semibold text-slate-700">PR #104: Fix data retention</span>
                    </div>
                    <span className="rounded bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      {locale === "vi" ? "CI Check: ĐẠT" : "CI Check: PASSED"}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 font-mono text-xs text-slate-600 bg-white p-3.5 rounded-md border border-slate-200">
                    <p className="flex items-center justify-between">
                      <span>{locale === "vi" ? "✓ Quy tắc: Thời hạn lưu trữ tài khoản" : "✓ Rule: Account record retention period"}</span>
                      <span className="text-emerald-600 font-bold">{locale === "vi" ? "100% Đạt" : "100% Passed"}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span>{locale === "vi" ? "✓ Thời gian rà soát: 1.2s" : "✓ Evaluation time: 1.2s"}</span>
                      <span className="text-slate-500">{locale === "vi" ? "Tiết kiệm 98% chi phí" : "Saves 98% scan overhead"}</span>
                    </p>
                  </div>

                  <div className="mt-4 text-xs text-slate-600">
                    {locale === "vi"
                      ? "Chỉ đánh giá lại đúng quy tắc bị ảnh hưởng bởi commit thay vì quét lại toàn bộ repo từ đầu."
                      : "Evaluates only the rules impacted by the changed commit without costly full-repository rescans."}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{locale === "vi" ? "Nhấn vào các mục bên phải để xem chi tiết năng lực" : "Click items on the right to examine capabilities"}</span>
              <span className="font-mono text-[#11545B]">3 / 3 Modes Ready</span>
            </div>
          </div>

          {/* 3 Right Column Selectors */}
          <div className="flex flex-col justify-between gap-4">
            {/* Card 1: Investigation */}
            <div 
              onClick={() => setActiveTab("finding")}
              className={`cursor-pointer rounded-xl border p-6 transition-all duration-200 ${
                activeTab === "finding"
                  ? "border-[#31BDA7] bg-[#ECF5F3]/50 shadow-xs ring-1 ring-[#31BDA7]"
                  : "border-slate-200/90 bg-white hover:border-[#31BDA7]/60 hover:bg-slate-50/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-white text-[#11545B]">
                  <SearchIcon className="size-5 text-[#11545B]" />
                </div>
                <span className={`text-[11px] font-mono font-bold ${activeTab === "finding" ? "text-[#11545B]" : "text-slate-400"}`}>
                  01
                </span>
              </div>
              <h4 className="mt-4 text-base font-bold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesMainTitle")}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-[#48586A]">
                {locale === "vi"
                  ? "Đọc chi tiết từng bằng chứng mã nguồn liên kết với văn bản pháp lý."
                  : "Investigate precise source code evidence connected to statutory mandates."}
              </p>
            </div>

            {/* Card 2: Information request */}
            <div 
              onClick={() => setActiveTab("request")}
              className={`cursor-pointer rounded-xl border p-6 transition-all duration-200 ${
                activeTab === "request"
                  ? "border-[#31BDA7] bg-[#ECF5F3]/50 shadow-xs ring-1 ring-[#31BDA7]"
                  : "border-slate-200/90 bg-white hover:border-[#31BDA7]/60 hover:bg-slate-50/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-white text-[#11545B]">
                  <MessageCircleIcon className="size-5 text-[#11545B]" />
                </div>
                <span className={`text-[11px] font-mono font-bold ${activeTab === "request" ? "text-[#11545B]" : "text-slate-400"}`}>
                  02
                </span>
              </div>
              <h4 className="mt-4 text-base font-bold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesCard2Title")}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.capabilitiesCard2Description")}
              </p>
            </div>

            {/* Card 3: Selective re-evaluation */}
            <div 
              onClick={() => setActiveTab("recheck")}
              className={`cursor-pointer rounded-xl border p-6 transition-all duration-200 ${
                activeTab === "recheck"
                  ? "border-[#31BDA7] bg-[#ECF5F3]/50 shadow-xs ring-1 ring-[#31BDA7]"
                  : "border-slate-200/90 bg-white hover:border-[#31BDA7]/60 hover:bg-slate-50/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg border border-[#31BDA7]/20 bg-white text-[#11545B]">
                  <TargetIcon className="size-5 text-[#11545B]" />
                </div>
                <span className={`text-[11px] font-mono font-bold ${activeTab === "recheck" ? "text-[#11545B]" : "text-slate-400"}`}>
                  03
                </span>
              </div>
              <h4 className="mt-4 text-base font-bold text-[#101C29]">
                {t("pages.marketing.home.capabilitiesCard3Title")}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-[#48586A]">
                {t("pages.marketing.home.capabilitiesCard3Description")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
