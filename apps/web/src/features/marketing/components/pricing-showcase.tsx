"use client";

import { useState } from "react";
import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  Wallet,
  ArrowRight,
  ChevronRight,
  ShieldCheck,
  Coins,
  CreditCard,
  FileText,
  Clock,
  History,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function resolveMarketingMessage(locale: Locale, key: string) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
}

/**
 * Top-up packages according to Figma #1662:1040 (03 Landing · Pricing):
 * - Small top-up: 100,000 VND
 * - Standard top-up: 1,000,000 VND (Linear gradient dark-forest card)
 * - Larger top-up: 5,000,000 VND
 * No discounts or promotions. Simple, transparent prepaid top-up model.
 */
const vktCapPackages = [
  {
    id: "small",
    titleEn: "Small top-up",
    titleVi: "Gói nạp nhỏ",
    amountText: "100,000 VND",
    numericVnd: 100000,
    descEn: "Added after payment confirmation.",
    descVi: "Cộng vào số dư sau khi xác nhận thanh toán.",
    cardStyle: "bg-[#F2F8F7] border-[#C5DFD9] text-[#101C29]",
    badgeBg: "bg-white text-[#11545B]",
    actionStyle: "bg-[#123E46] text-white hover:bg-[#0c2b31]",
    isStandard: false,
  },
  {
    id: "standard",
    titleEn: "Standard top-up",
    titleVi: "Gói nạp tiêu chuẩn",
    amountText: "1,000,000 VND",
    numericVnd: 1000000,
    descEn: "Added after payment confirmation.",
    descVi: "Cộng vào số dư sau khi xác nhận thanh toán.",
    cardStyle:
      "bg-gradient-to-r from-[#102A38] to-[#174950] border-transparent text-white shadow-[0px_8px_24px_-4px_rgba(18,41,56,0.18)] lg:-translate-y-1.5",
    badgeBg: "bg-white/10 text-[#C6DFE1]",
    actionStyle:
      "bg-[#46D5B5] text-[#102A38] hover:bg-[#58e2c3] font-semibold shadow-xs",
    isStandard: true,
  },
  {
    id: "larger",
    titleEn: "Larger top-up",
    titleVi: "Gói nạp lớn",
    amountText: "5,000,000 VND",
    numericVnd: 5000000,
    descEn: "Added after payment confirmation.",
    descVi: "Cộng vào số dư sau khi xác nhận thanh toán.",
    cardStyle: "bg-[#F0F3FF] border-[#D4DBF4] text-[#101C29]",
    badgeBg: "bg-white text-[#101C29]",
    actionStyle: "bg-[#123E46] text-white hover:bg-[#0c2b31]",
    isStandard: false,
  },
] as const;

export function FigmaVndPricingHero() {
  const locale = useMarketingLocale();

  return (
    <section
      data-section="pricing-hero"
      className="relative overflow-hidden border-b border-border bg-[#F5F7FA] py-14 sm:py-20"
    >
      <div className="relative mx-auto max-w-[1240px] px-6 text-center">
        {/* Eyebrow: PREPAID BALANCE / SỐ DƯ TRẢ TRƯỚC */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[#087F75]/30 bg-white px-3.5 py-1 text-xs font-mono font-semibold tracking-wider text-[#087F75] uppercase shadow-2xs">
          <span className="size-2 rounded-full bg-[#087F75]" />
          <span>{locale === "vi" ? "SỐ DƯ TRẢ TRƯỚC" : "PREPAID BALANCE"}</span>
        </div>

        {/* Title from Figma #1757:13089: Top up when you need it */}
        <h1 className="mt-4 font-sans text-4xl sm:text-5xl lg:text-[50px] font-semibold tracking-tight text-[#101C29] leading-tight">
          {locale === "vi" ? "Nạp tiền khi bạn cần." : "Top up when you need it."}
        </h1>

        {/* Subtitle from Figma #1757:13090: Choose a VND top-up amount. Track payment orders separately from AI usage. */}
        <p className="mx-auto mt-4 max-w-[800px] text-base sm:text-lg text-[#48586A] leading-relaxed">
          {locale === "vi"
            ? "Chọn số tiền nạp theo đơn vị VND. Theo dõi đơn nạp tiền tách biệt với mức sử dụng AI."
            : "Choose a VND top-up amount. Track payment orders separately from AI usage."}
        </p>
      </div>
    </section>
  );
}

export function FigmaVndTopUpsSection() {
  const locale = useMarketingLocale();
  const [selectedPackage, setSelectedPackage] = useState<string>("standard");

  return (
    <section
      data-section="credit-topups"
      className="mx-auto w-full max-w-[1440px] px-6 pt-12 pb-8 md:px-[96px]"
    >
      {/* 3 Figma Cards Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {vktCapPackages.map((pkg) => {
          const isSelected = selectedPackage === pkg.id;

          return (
            <article
              key={pkg.id}
              onClick={() => setSelectedPackage(pkg.id)}
              className={cn(
                "relative flex min-h-[284px] flex-col justify-between rounded-2xl border p-6 sm:p-7 transition-all duration-200 cursor-pointer",
                pkg.cardStyle,
                isSelected && !pkg.isStandard && "ring-2 ring-[#087F75]/40"
              )}
            >
              <div>
                {/* Header: Wallet icon & Title */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-9 items-center justify-center rounded-xl",
                        pkg.isStandard
                          ? "bg-white/10 text-[#46D5B5]"
                          : "bg-white text-[#087F75] border border-slate-200/80 shadow-2xs"
                      )}
                    >
                      <Wallet className="size-5" />
                    </div>
                    <h3
                      className={cn(
                        "text-base font-medium",
                        pkg.isStandard ? "text-[#C6DFE1]" : "text-[#101C29]"
                      )}
                    >
                      {locale === "vi" ? pkg.titleVi : pkg.titleEn}
                    </h3>
                  </div>
                </div>

                {/* Amount display: 100,000 VND / 1,000,000 VND / 5,000,000 VND */}
                <div className="mt-7">
                  <div className="font-sans text-3xl sm:text-4xl font-semibold tracking-tight">
                    {pkg.amountText}
                  </div>
                  <p
                    className={cn(
                      "mt-2 text-sm leading-snug",
                      pkg.isStandard ? "text-[#C6DFE1]/90" : "text-[#48586A]"
                    )}
                  >
                    {locale === "vi" ? pkg.descVi : pkg.descEn}
                  </p>
                </div>
              </div>

              {/* Action Button: Choose amount */}
              <div className="mt-8">
                <Link
                  href="/sign-up"
                  className={cn(
                    "flex h-10 w-full items-center justify-center rounded-[7px] text-sm font-semibold transition-all duration-150 active:translate-y-0.5",
                    pkg.actionStyle
                  )}
                >
                  <span>{locale === "vi" ? "Chọn số tiền" : "Choose amount"}</span>
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {/* Payment Workflow from Figma #1757:13118 */}
      <div
        data-section="how-credits-work"
        className="mt-10 rounded-2xl border border-[#D6DFE7] bg-[#F8FAFC] p-6 sm:p-7"
      >
        <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#101C29]">
          {locale === "vi" ? "Quy trình nạp tiền" : "How top-ups work"}
        </h3>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Step 01 */}
          <div className="flex items-center gap-3 rounded-xl border border-[#D6DFE7] bg-white p-4 shadow-2xs">
            <span className="font-mono text-sm font-semibold text-[#087F75]">01</span>
            <span className="text-sm font-medium text-[#101C29]">
              {locale === "vi" ? "Tạo đơn nạp" : "Create order"}
            </span>
          </div>

          {/* Step 02 */}
          <div className="flex items-center gap-3 rounded-xl border border-[#D6DFE7] bg-white p-4 shadow-2xs">
            <span className="font-mono text-sm font-semibold text-[#087F75]">02</span>
            <span className="text-sm font-medium text-[#101C29]">
              {locale === "vi" ? "Chuyển khoản VND" : "Transfer VND"}
            </span>
          </div>

          {/* Step 03 */}
          <div className="flex items-center gap-3 rounded-xl border border-[#D6DFE7] bg-white p-4 shadow-2xs">
            <span className="font-mono text-sm font-semibold text-[#087F75]">03</span>
            <span className="text-sm font-medium text-[#101C29]">
              {locale === "vi" ? "Xác nhận thanh toán" : "Confirm payment"}
            </span>
          </div>

          {/* Step 04 */}
          <div className="flex items-center gap-3 rounded-xl border border-[#D6DFE7] bg-white p-4 shadow-2xs">
            <span className="font-mono text-sm font-semibold text-[#087F75]">04</span>
            <span className="text-sm font-medium text-[#101C29]">
              {locale === "vi" ? "Xem lịch sử giao dịch" : "Review history"}
            </span>
          </div>
        </div>

        {/* Note from Figma #1757:13132 */}
        <p className="mt-5 text-xs text-[#48586A]">
          {locale === "vi"
            ? "Chỉ là số tiền mẫu. Điều khoản thanh toán và hạn mức hỗ trợ được xác nhận trong sản phẩm."
            : "Example amounts only. Payment terms and supported limits are confirmed in the product."}
        </p>
      </div>
    </section>
  );
}

export function FigmaVndPricingFooter() {
  const locale = useMarketingLocale();

  return (
    <footer
      data-section="final-cta"
      className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-[96px]"
    >
      <div className="flex flex-col items-center justify-between gap-4 border-t border-[#D6DFE7] pt-6 sm:flex-row text-xs text-[#48586A]">
        <div>
          {locale === "vi"
            ? "LCSP · Không gian tuân thủ pháp lý"
            : "LCSP · Legal compliance workspace"}
        </div>
        <div>
          {locale === "vi"
            ? "Bằng chứng có thể truy vết. Quyết định có thể rà soát."
            : "Traceable evidence. Reviewable decisions."}
        </div>
      </div>
    </footer>
  );
}
