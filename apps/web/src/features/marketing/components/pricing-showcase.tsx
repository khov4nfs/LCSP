"use client";

import { useState } from "react";
import Link from "next/link";
import { useMarketingLocale } from "./marketing-locale";
import { resolveMessage } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared/locale";
import {
  ShieldCheck,
  Zap,
  CreditCard,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Check,
  Calculator,
  ArrowRight,
  HelpCircle,
  Coins,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

function resolveMarketingMessage(locale: Locale, key: string) {
  return resolveMessage(locale, key as Parameters<typeof resolveMessage>[1]);
}

/**
 * Top-up packages using VND, no discounts or fake percentage savings.
 * 100,000 VND / 1,000,000 VND / 5,000,000 VND matching the system prepaid contract.
 */
const topUpsVnd = [
  {
    amount: "100,000 VND",
    value: 100000,
    titleEn: "Small top-up",
    titleVi: "Gói nạp nhỏ",
    descEn: "A flexible prepaid amount for exploratory assessments and verification.",
    descVi: "Gói nạp linh hoạt cho các phiên đánh giá và xác minh bước đầu.",
    balanceEn: "100,000 VND added to your LCSP balance",
    balanceVi: "100.000 đ cộng trực tiếp vào số dư LCSP",
    ctaEn: "Add 100,000 VND",
    ctaVi: "Nạp 100.000 đ",
    featured: false,
    tag: null,
  },
  {
    amount: "1,000,000 VND",
    value: 1000000,
    titleEn: "Standard top-up",
    titleVi: "Gói nạp tiêu chuẩn",
    descEn: "Ideal balance for active repository scans and targeted remediation runs.",
    descVi: "Số dư tiêu chuẩn cho các phiên quét kho mã và khắc phục có chủ đích.",
    balanceEn: "1,000,000 VND added to your LCSP balance",
    balanceVi: "1.000.000 đ cộng trực tiếp vào số dư LCSP",
    ctaEn: "Add 1,000,000 VND",
    ctaVi: "Nạp 1.000.000 đ",
    featured: true,
    tag: "RECOMMENDED",
    tagVi: "TIÊU CHUẨN",
  },
  {
    amount: "5,000,000 VND",
    value: 5000000,
    titleEn: "Larger top-up",
    titleVi: "Gói nạp lớn",
    descEn: "Designed for larger repositories with continuous evidence tracking.",
    descVi: "Phù hợp cho kho mã quy mô lớn và theo dõi bằng chứng liên tục.",
    balanceEn: "5,000,000 VND added to your LCSP balance",
    balanceVi: "5.000.000 đ cộng trực tiếp vào số dư LCSP",
    ctaEn: "Add 5,000,000 VND",
    ctaVi: "Nạp 5.000.000 đ",
    featured: false,
    tag: "HIGH VOLUME",
    tagVi: "KHỐI LƯỢNG LỚN",
  },
] as const;

export function EnhancedPricingHero() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <section
      data-section="pricing-hero"
      className="relative overflow-hidden border-b border-border bg-[#F4F9F8] py-16 lg:py-24"
    >
      {/* Hairline subtle background grid */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03] [background-image:linear-gradient(to_right,#000_1px,transparent_1px),linear-gradient(to_bottom,#000_1px,transparent_1px)] [background-size:32px_32px]" />

      <div className="relative mx-auto max-w-[1240px] px-6 text-center">
        {/* Eyebrow badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[#31BDA7]/40 bg-white px-3.5 py-1 text-xs font-semibold text-[#11545B] shadow-xs">
          <span className="size-2 rounded-full bg-[#31BDA7] animate-pulse" />
          <span>{locale === "vi" ? "SỐ DƯ TRẢ TRƯỚC" : "PREPAID BALANCE"}</span>
          <span className="text-slate-300">•</span>
          <span className="text-[#31BDA7] font-mono text-[11px]">
            {locale === "vi" ? "ĐƠN VỊ VND" : "VND CREDITS"}
          </span>
        </div>

        {/* Title */}
        <h1 className="mt-5 font-sans text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#101C29]">
          {locale === "vi" ? "Chỉ trả cho phần bạn sử dụng." : "Pay only for what you use."}
        </h1>

        {/* Description */}
        <p className="mx-auto mt-4 max-w-[720px] text-base sm:text-lg leading-relaxed text-[#48586A]">
          {locale === "vi"
            ? "LCSP sử dụng số dư trả trước bằng đơn vị VND. Nạp tiền linh hoạt, dùng số dư khi phiên đánh giá chạy và nạp thêm bất kỳ lúc nào."
            : "LCSP uses prepaid VND credits. Top up conveniently, spend balance as assessments run, and reload whenever you need."}
        </p>

        {/* Hero detail pills */}
        <div className="mx-auto mt-7 flex max-w-[700px] flex-wrap items-center justify-center gap-2 text-xs font-medium text-[#48586A]">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 shadow-2xs">
            <Coins className="size-3.5 text-[#31BDA7]" />
            {locale === "vi" ? "Số dư trả trước theo VND" : "Prepaid VND wallet"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 shadow-2xs">
            <ShieldCheck className="size-3.5 text-[#31BDA7]" />
            {locale === "vi" ? "Không phí ẩn hàng tháng" : "No monthly subscription"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 shadow-2xs">
            <Sparkles className="size-3.5 text-[#31BDA7]" />
            {locale === "vi" ? "Minh bạch 100% từng lần quét" : "100% transparent per run"}
          </span>
        </div>
      </div>
    </section>
  );
}

export function EnhancedCreditTopUpsSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);
  const [selectedTopUp, setSelectedTopUp] = useState<string>("1,000,000 VND");
  const [customInput, setCustomInput] = useState<string>("");

  return (
    <section
      data-section="credit-topups"
      className="mx-auto min-h-[720px] w-full max-w-[1440px] px-8 pt-16 pb-12 md:px-[96px]"
    >
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#31BDA7]">
            {locale === "vi" ? "DANH MỤC GÓI NẠP" : "PRESET TOP-UP AMOUNTS"}
          </span>
          <h2 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[#101C29]">
            {locale === "vi" ? "Chọn số tiền nạp" : "Choose a top-up amount"}
          </h2>
          <p className="mt-1 text-sm sm:text-base text-[#48586A]">
            {locale === "vi"
              ? "Số dư được cộng trực tiếp vào tài khoản LCSP ngay sau khi thanh toán thành công."
              : "Credits are added to your LCSP balance immediately after a successful payment."}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-[#F4F9F8] px-3 py-1.5 text-xs font-semibold text-[#11545B]">
          <ShieldCheck className="size-4 text-[#31BDA7]" />
          <span>{locale === "vi" ? "Thanh toán an toàn bảo mật" : "Secure payment gateway"}</span>
        </div>
      </div>

      {/* 3 Top Up Cards Grid */}
      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        {topUpsVnd.map((item) => {
          const isSelected = selectedTopUp === item.amount;
          return (
            <article
              key={item.amount}
              onClick={() => setSelectedTopUp(item.amount)}
              className={cn(
                "group relative flex flex-col justify-between rounded-2xl border p-7 transition-all duration-300 cursor-pointer",
                item.featured
                  ? "border-[#31BDA7] bg-white shadow-[0_12px_36px_rgba(49,189,167,0.12)] ring-1 ring-[#31BDA7]/30 lg:-translate-y-2"
                  : "border-slate-200/90 bg-white shadow-xs hover:border-[#31BDA7]/40 hover:shadow-md",
                isSelected && !item.featured && "ring-1 ring-[#11545B]/30"
              )}
            >
              {/* Badge header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#48586A]">
                  {locale === "vi" ? item.titleVi : item.titleEn}
                </span>
                {item.tag && (
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-bold tracking-wide",
                      item.featured
                        ? "bg-[#31BDA7] text-white"
                        : "bg-[#EAF6F4] text-[#11545B]"
                    )}
                  >
                    {locale === "vi" ? item.tagVi : item.tag}
                  </span>
                )}
              </div>

              {/* Amount Display */}
              <div className="mt-6">
                <div className="flex items-baseline gap-2">
                  <span className="font-sans text-4xl sm:text-[42px] font-extrabold tracking-tight text-[#101C29]">
                    {item.amount}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
                  {locale === "vi" ? item.descVi : item.descEn}
                </p>
              </div>

              {/* Feature / Benefit rows */}
              <div className="mt-8 space-y-3 border-t border-slate-100 pt-6">
                <div className="flex items-center gap-3 text-sm text-[#101C29]">
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#EAF6F4] text-[#31BDA7]">
                    <Check className="size-3.5 stroke-[2.5]" />
                  </div>
                  <span className="font-medium">
                    {locale === "vi" ? item.balanceVi : item.balanceEn}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[#48586A]">
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <CreditCard className="size-3 stroke-[2]" />
                  </div>
                  <span>
                    {locale === "vi" ? "Chuyển khoản & thẻ nội địa / quốc tế" : "Bank transfer & domestic/international cards"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[#48586A]">
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <ShieldCheck className="size-3 stroke-[2]" />
                  </div>
                  <span>
                    {locale === "vi" ? "Không hết hạn sử dụng số dư" : "Credits do not expire"}
                  </span>
                </div>
              </div>

              {/* Call to Action Button */}
              <div className="mt-8 pt-2">
                <Link
                  href="/sign-up"
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all duration-200",
                    item.featured
                      ? "bg-[#11545B] text-white hover:bg-[#0c3e43] shadow-sm hover:shadow-md active:scale-[0.98]"
                      : "bg-[#F4F9F8] text-[#11545B] hover:bg-[#31BDA7] hover:text-white"
                  )}
                >
                  <span>{locale === "vi" ? item.ctaVi : item.ctaEn}</span>
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {/* Custom Amount Box (matches contract data-section="custom-amount") */}
      <div
        data-section="custom-amount"
        className="mt-8 flex flex-col gap-5 rounded-2xl border border-slate-200/90 bg-[#FAFBFB] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between shadow-xs hover:border-[#31BDA7]/30 transition-colors"
      >
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 text-[#31BDA7] shadow-2xs">
            <Calculator className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#101C29]">
              {locale === "vi" ? "Cần số tiền nạp khác?" : "Need a custom top-up amount?"}
            </h3>
            <p className="mt-1 text-sm text-[#48586A]">
              {locale === "vi"
                ? "Nhập số tiền nạp tùy chọn theo nhu cầu. Hỗ trợ từ 10.000 đ đến 10.000.000 đ."
                : "Enter any custom top-up amount. Supports from 10,000 VND to 10,000,000 VND."}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative">
            <input
              type="number"
              min="10000"
              max="10000000"
              step="1000"
              placeholder={locale === "vi" ? "VD: 500,000..." : "e.g. 500,000..."}
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="h-11 w-full sm:w-48 rounded-xl border border-slate-200 bg-white px-4 text-sm font-mono text-[#101C29] placeholder:text-slate-400 focus:border-[#31BDA7] focus:outline-none focus:ring-2 focus:ring-[#31BDA7]/20"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-medium text-[#48586A]">
              VND
            </span>
          </div>
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-[#101C29] shadow-2xs hover:bg-slate-50 hover:border-slate-400 transition-colors"
          >
            {t("pages.marketing.pricing.customPlaceholder")}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function EnhancedHowCreditsWorkSection() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  const steps = [
    {
      step: "01",
      icon: CreditCard,
      titleEn: "Create order & Transfer VND",
      titleVi: "Tạo đơn nạp & Chuyển khoản",
      descEn: "Select a preset VND amount or enter a custom amount. Transfer securely via QR or card.",
      descVi: "Chọn số tiền VND có sẵn hoặc tùy chỉnh. Thanh toán an toàn qua mã QR hoặc thẻ.",
      metaEn: "Instant balance confirmation",
      metaVi: "Cộng số dư tức thì",
    },
    {
      step: "02",
      icon: Zap,
      titleEn: "Use balance as work runs",
      titleVi: "Dùng số dư theo phiên quét",
      descEn: "Automated AST scanning and legal compliance audits draw directly from your prepaid wallet.",
      descVi: "Các phiên quét AST và kiểm toán tuân thủ pháp lý trừ dần từ số dư thực tế.",
      metaEn: "Precise AST evidence tracking",
      metaVi: "Minh bạch từng dòng mã",
    },
    {
      step: "03",
      icon: RefreshCw,
      titleEn: "Reload whenever you need",
      titleVi: "Nạp thêm khi bạn muốn",
      descEn: "Top up manually anytime or set a notification balance threshold in your Billing settings.",
      descVi: "Nạp thêm thủ công bất cứ lúc nào hoặc thiết lập ngưỡng cảnh báo trong mục Thanh toán.",
      metaEn: "No lock-in or recurring fees",
      metaVi: "Không phí duy trì định kỳ",
    },
  ] as const;

  return (
    <section
      data-section="how-credits-work"
      className="mx-auto min-h-[540px] w-full max-w-[1440px] px-8 pt-12 pb-16 md:px-[96px]"
    >
      <div className="max-w-[760px]">
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#31BDA7]">
          {locale === "vi" ? "CƠ CHẾ MINH BẠCH" : "TRANSPARENT BALANCE MODEL"}
        </span>
        <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-[#101C29]">
          {locale === "vi" ? "Số dư hoạt động như thế nào" : "How credits work"}
        </h2>
        <p className="mt-3 text-base text-[#48586A] leading-relaxed">
          {locale === "vi"
            ? "Một số dư duy nhất. Nạp thêm khi cần và sử dụng trên toàn bộ các tính năng kiểm toán của LCSP."
            : "One balance. Add credits when you need them and use them across all LCSP compliance features."}
        </p>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-3">
        {steps.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.step}
              className="relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xs hover:border-[#31BDA7]/40 hover:shadow-md transition-all duration-200"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-[#F4F9F8] font-mono text-base font-bold text-[#11545B]">
                    {item.step}
                  </span>
                  <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                    <Icon className="size-4 text-[#31BDA7]" />
                  </div>
                </div>

                <h3 className="mt-6 text-xl font-bold tracking-tight text-[#101C29]">
                  {locale === "vi" ? item.titleVi : item.titleEn}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[#48586A]">
                  {locale === "vi" ? item.descVi : item.descEn}
                </p>
              </div>

              <div className="mt-8 border-t border-slate-100 pt-4">
                <span className="font-mono text-[11px] font-medium text-[#11545B]/80 uppercase">
                  {locale === "vi" ? item.metaVi : item.metaEn}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function EnhancedPricingFaqSection() {
  const locale = useMarketingLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqList = [
    {
      qEn: "How does pay as you go work?",
      qVi: "Thanh toán theo mức sử dụng hoạt động như thế nào?",
      aEn: "Add prepaid VND credits to your balance, then LCSP draws from that balance as repository assessments and remediation work run.",
      aVi: "Nạp tiền trả trước vào số dư bằng VND, sau đó LCSP trừ dần từ số dư này khi các hoạt động đánh giá và khắc phục diễn ra.",
    },
    {
      qEn: "Can I choose my top-up amount?",
      qVi: "Tôi có thể tự chọn số tiền nạp không?",
      aEn: "Yes. Choose 100,000 VND, 1,000,000 VND, 5,000,000 VND, or enter any custom amount between 10,000 VND and 10,000,000 VND.",
      aVi: "Có. Bạn có thể chọn 100.000 đ, 1.000.000 đ, 5.000.000 đ hoặc nhập số tiền tùy chọn từ 10.000 đ đến 10.000.000 đ.",
    },
    {
      qEn: "Are there any hidden subscription fees?",
      qVi: "Có bất kỳ khoản phí duy trì định kỳ nào không?",
      aEn: "No. LCSP operates entirely on a transparent prepaid balance model. You only pay for the assessments you run, with no monthly recurring fees.",
      aVi: "Không. LCSP hoạt động hoàn toàn trên mô hình số dư trả trước minh bạch. Bạn chỉ trả tiền cho các lượt đánh giá bạn thực hiện, không có phí duy trì hàng tháng.",
    },
    {
      qEn: "Can LCSP reload credits automatically?",
      qVi: "LCSP có thể tự động nạp thêm tiền không?",
      aEn: "Yes. In your Billing settings, you can set a balance threshold and configure notifications or automated reloading to prevent work interruptions.",
      aVi: "Có. Trong mục Thanh toán, bạn có thể đặt ngưỡng cảnh báo số dư hoặc thiết lập nạp tự động để không bị gián đoạn công việc.",
    },
  ] as const;

  return (
    <section
      data-section="faq"
      className="mx-auto min-h-[560px] w-full max-w-[1440px] px-8 py-16 md:px-[96px]"
    >
      <div className="grid gap-12 lg:grid-cols-[400px_1fr]">
        <div>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#31BDA7]">
            {locale === "vi" ? "GIẢI ĐÁP CHI TIẾT" : "PREPAID QUESTIONS"}
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#101C29] sm:text-4xl">
            {locale === "vi" ? "Câu hỏi về số dư & thanh toán" : "Credit & Payment Questions"}
          </h2>
          <p className="mt-3 text-base text-[#48586A]">
            {locale === "vi"
              ? "Thông tin chi tiết về nạp tiền bằng chuyển khoản / thẻ, số tiền tùy chọn và cách nạp số dư."
              : "Key details about bank top-ups, custom amounts, and reloading your balance."}
          </p>

          <div className="mt-8 rounded-xl border border-slate-200 bg-[#F4F9F8] p-5">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#11545B]">
              <HelpCircle className="size-5 text-[#31BDA7]" />
              <span>
                {locale === "vi" ? "Cần hỗ trợ thanh toán doanh nghiệp?" : "Enterprise Billing Support"}
              </span>
            </div>
            <p className="mt-2 text-xs text-[#48586A] leading-relaxed">
              {locale === "vi"
                ? "Liên hệ đội ngũ LCSP để xuất hóa đơn VAT, hợp đồng dịch vụ hoặc thanh toán chuyển khoản doanh nghiệp."
                : "Contact our team for VAT invoicing, enterprise compliance agreements, or corporate transfer arrangements."}
            </p>
            <Link
              href="/sign-up"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#11545B] hover:text-[#31BDA7] transition-colors"
            >
              <span>{locale === "vi" ? "Trao đổi với đội ngũ" : "Speak to an advisor"}</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="space-y-3">
          {faqList.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={item.qEn}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="group rounded-xl border border-slate-200/90 bg-white p-5 transition-all duration-200 hover:border-[#31BDA7]/40 hover:shadow-xs cursor-pointer"
              >
                <div className="flex w-full items-center justify-between text-left">
                  <h3 className="text-base font-semibold text-[#101C29] transition-colors group-hover:text-[#11545B]">
                    {locale === "vi" ? item.qVi : item.qEn}
                  </h3>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-[#48586A] transition-transform duration-300",
                      isOpen ? "rotate-180 text-[#31BDA7]" : "group-hover:text-[#31BDA7]"
                    )}
                  />
                </div>
                {isOpen && (
                  <p className="pt-3 text-sm leading-relaxed text-[#48586A]">
                    {locale === "vi" ? item.aVi : item.aEn}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function EnhancedPricingFinalCta() {
  const locale = useMarketingLocale();
  const t = (key: string) => resolveMarketingMessage(locale, key);

  return (
    <section
      data-section="final-cta"
      className="mx-auto w-full max-w-[1440px] px-8 py-16 md:px-[96px]"
    >
      <div className="relative overflow-hidden rounded-[20px] bg-[#0A2633] px-8 py-16 text-center text-white shadow-xl sm:px-14">
        {/* Ambient glow effect */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 size-96 rounded-full bg-[#31BDA7]/15 blur-3xl" />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#46D5B5]/30 bg-[#46D5B5]/10 px-3.5 py-1 text-xs font-mono text-[#86E8D4]">
            <Sparkles className="size-3 text-[#46D5B5]" />
            <span>{locale === "vi" ? "SẴN SÀNG KIỂM TOÁN" : "GET AUDIT READY"}</span>
          </div>

          <h2 className="mx-auto mt-4 max-w-2xl font-sans text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            {locale === "vi" ? "Nạp thêm khi bạn cần." : "Add credits when you need them."}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-[#86E8D4]/90 leading-relaxed">
            {locale === "vi"
              ? "Nạp tiền dễ dàng, sử dụng số dư trên toàn bộ LCSP và nạp thêm bất kỳ lúc nào."
              : "Top up easily, use credits across LCSP, and reload whenever you need more."}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#46D5B5] px-7 text-sm font-semibold text-[#0A2633] shadow-sm transition-all duration-200 hover:bg-[#58e2c3] hover:shadow-md active:scale-95"
            >
              <span>{t("pages.marketing.nav.getStarted")}</span>
              <ChevronRight className="size-4" />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 px-7 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 hover:border-white/30 active:scale-95"
            >
              {t("pages.marketing.nav.signIn")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
