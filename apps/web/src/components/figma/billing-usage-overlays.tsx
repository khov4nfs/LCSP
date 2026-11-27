"use client";

import React, { type ReactNode } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CopyIcon,
  CheckIcon,
  RefreshCw,
  QrCode,
  AlertCircle,
  Filter,
  CheckCircle2,
  Clock,
  HelpCircle,
} from "lucide-react";
import { FigmaStatusBadge } from "./billing-usage-masters";
import { BILLING_ORDER_STATUSES, type BillingOrderView } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";

/**
 * Overlay 1: Payment Order Detail Modal (#1662:2552 overlay 1)
 */
export function FigmaPaymentOrderDetailOverlay({
  open,
  onOpenChange,
  order,
  locale,
  onRefreshStatus,
  onCopyReference,
  hasCopied,
  qrCodeUrl,
  accountNumber,
  bankName,
  isRefreshing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: BillingOrderView | null;
  locale: Locale;
  onRefreshStatus?: () => void;
  onCopyReference?: () => void;
  hasCopied?: boolean;
  qrCodeUrl?: string | null;
  accountNumber?: string;
  bankName?: string;
  isRefreshing?: boolean;
}) {
  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1687:3323-overlay"
        data-figma-name="Overlay 1 / Payment order detail"
        className="max-w-[540px] rounded-2xl border border-[#D6DFE7] bg-white p-6 shadow-xl sm:p-8"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-[#101C29]">
              {locale === "vi" ? "Chi tiết đơn nạp tiền" : "Payment Order Detail"}
            </DialogTitle>
            <FigmaStatusBadge
              label={order.status}
              variant={
                order.status === BILLING_ORDER_STATUSES.CREDITED
                  ? "success"
                  : order.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
                      order.status === BILLING_ORDER_STATUSES.PENDING_RECONCILIATION
                    ? "warning"
                    : "danger"
              }
            />
          </div>
          <DialogDescription className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Sử dụng thông tin chuyển khoản bên dưới để hoàn tất việc nạp số dư."
              : "Use the transfer details below to complete your prepaid balance top-up."}
          </DialogDescription>
        </DialogHeader>

        {/* QR Code and Bank Details */}
        <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-[#F8FAFC] p-4 text-center">
          {qrCodeUrl ? (
            <div className="relative size-44 overflow-hidden rounded-lg bg-white p-2 shadow-2xs">
              <Image
                src={qrCodeUrl}
                alt="SePay QR Code"
                fill
                className="object-contain p-1"
                unoptimized
              />
            </div>
          ) : (
            <div className="flex size-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-slate-400">
              <QrCode className="size-16" />
            </div>
          )}

          <div className="w-full space-y-2 text-left text-xs">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <span className="text-[#48586A]">{locale === "vi" ? "Ngân hàng:" : "Bank:"}</span>
              <span className="font-semibold text-[#101C29]">{bankName ?? "MB Bank"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <span className="text-[#48586A]">{locale === "vi" ? "Số tài khoản:" : "Account No:"}</span>
              <span className="font-mono font-semibold text-[#101C29]">{accountNumber ?? "0987654321"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <span className="text-[#48586A]">{locale === "vi" ? "Số tiền:" : "Amount:"}</span>
              <span className="font-sans text-base font-bold text-[#11545B]">
                {Number(order.amountVnd).toLocaleString()} VND
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[#48586A]">{locale === "vi" ? "Nội dung chuyển khoản:" : "Reference code:"}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-[#101C29]">{order.paymentCode}</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={onCopyReference}
                  className="size-6 text-[#11545B]"
                >
                  {hasCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={onRefreshStatus}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-[#11545B]" : ""}`} />
            <span>
              {isRefreshing
                ? locale === "vi"
                  ? "Đang đồng bộ..."
                  : "Checking..."
                : locale === "vi"
                  ? "Kiểm tra trạng thái"
                  : "Refresh status"}
            </span>
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="bg-[#11545B] hover:bg-[#0c3e43]">
            {locale === "vi" ? "Đóng" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 2: Usage Filters Popover / Dialog (#1662:2552 overlay 2)
 */
export function FigmaUsageFiltersOverlay({
  open,
  onOpenChange,
  locale,
  onApply,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  onApply?: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-filter"
        data-figma-name="Overlay 2 / Usage filters"
        className="max-w-[480px] rounded-2xl border border-[#D6DFE7] bg-white p-6 shadow-xl"
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-[#101C29]">
            <Filter className="size-5 text-[#31BDA7]" />
            <DialogTitle className="text-lg font-bold">
              {locale === "vi" ? "Bộ lọc mức sử dụng AI" : "Filter AI Model Usage"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Tùy chỉnh khoảng thời gian và tiêu chí truy vấn mức sử dụng mô hình."
              : "Adjust query periods and criteria to inspect targeted model token consumption."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {children}
        </div>

        <DialogFooter className="mt-6 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {locale === "vi" ? "Hủy" : "Cancel"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply?.();
              onOpenChange(false);
            }}
            className="bg-[#11545B] hover:bg-[#0c3e43]"
          >
            {locale === "vi" ? "Áp dụng bộ lọc" : "Apply filters"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 3: Payment Status Refreshing Overlay (#1662:2552 overlay 3)
 */
export function FigmaPaymentRefreshOverlay({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-refresh"
        data-figma-name="Overlay 3 / Payment status checking"
        className="max-w-[400px] rounded-2xl border border-[#D6DFE7] bg-white p-6 text-center shadow-xl"
      >
        <div className="flex flex-col items-center justify-center space-y-3 py-4">
          <RefreshCw className="size-10 animate-spin text-[#11545B]" />
          <h3 className="text-base font-semibold text-[#101C29]">
            {locale === "vi" ? "Đang kiểm tra thanh toán" : "Checking Payment Status"}
          </h3>
          <p className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Hệ thống đang đồng bộ với cổng SePay để xác nhận giao dịch của bạn..."
              : "Synchronizing with SePay gateway to confirm your payment..."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 4: Payment Confirmed / Credited Overlay (#1662:2552 overlay 4)
 */
export function FigmaPaymentConfirmedOverlay({
  open,
  onOpenChange,
  locale,
  amountVnd,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  amountVnd: string;
  onContinue?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-confirmed"
        data-figma-name="Overlay 4 / Payment confirmed"
        className="max-w-[420px] rounded-2xl border border-[#D6DFE7] bg-white p-6 text-center shadow-xl"
      >
        <div className="flex flex-col items-center space-y-3 py-2">
          <div className="rounded-full bg-emerald-100 p-3 text-emerald-600">
            <CheckCircle2 className="size-10" />
          </div>
          <h3 className="text-lg font-bold text-[#101C29]">
            {locale === "vi" ? "Nạp tiền thành công!" : "Payment Confirmed!"}
          </h3>
          <p className="text-xs text-[#48586A]">
            {locale === "vi"
              ? `Số tiền ${Number(amountVnd).toLocaleString()} VND đã được cộng vào số dư trả trước của bạn.`
              : `${Number(amountVnd).toLocaleString()} VND has been credited to your prepaid balance.`}
          </p>
        </div>
        <DialogFooter className="mt-4 sm:justify-center">
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onContinue?.();
            }}
            className="w-full bg-[#11545B] hover:bg-[#0c3e43]"
          >
            {locale === "vi" ? "Hoàn tất" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 5: Payment Failed or Expired Overlay (#1662:2552 overlay 5)
 */
export function FigmaPaymentExpiredOverlay({
  open,
  onOpenChange,
  locale,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  onRetry?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-expired"
        data-figma-name="Overlay 5 / Payment expired or failed"
        className="max-w-[420px] rounded-2xl border border-[#D6DFE7] bg-white p-6 text-center shadow-xl"
      >
        <div className="flex flex-col items-center space-y-3 py-2">
          <div className="rounded-full bg-amber-100 p-3 text-amber-600">
            <Clock className="size-10" />
          </div>
          <h3 className="text-lg font-bold text-[#101C29]">
            {locale === "vi" ? "Đơn nạp tiền đã hết hạn" : "Order Expired"}
          </h3>
          <p className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Mã chuyển khoản của đơn nạp này đã hết hiệu lực. Vui lòng tạo đơn mới."
              : "This payment reference code has expired. Please create a new order."}
          </p>
        </div>
        <DialogFooter className="mt-4 flex gap-2 sm:justify-center">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {locale === "vi" ? "Đóng" : "Close"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onRetry?.();
            }}
            className="bg-[#11545B] hover:bg-[#0c3e43]"
          >
            {locale === "vi" ? "Tạo đơn mới" : "Create new order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 6: Additional Order Confirmation Warning (#1662:2552 overlay 6)
 */
export function FigmaAdditionalOrderOverlay({
  open,
  onOpenChange,
  locale,
  onConfirmNew,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  onConfirmNew: () => void;
  onOpenExisting: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-additional"
        data-figma-name="Overlay 6 / Additional order warning"
        className="max-w-[460px] rounded-2xl border border-[#D6DFE7] bg-white p-6 shadow-xl"
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="size-5" />
            <DialogTitle className="text-base font-bold text-[#101C29]">
              {locale === "vi" ? "Đang có đơn nạp chờ xử lý" : "Pending Order Detected"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Bạn hiện có đơn nạp tiền chưa thanh toán. Bạn có muốn tiếp tục tạo thêm đơn mới không?"
              : "You already have a pending top-up order. Do you wish to create another order or open the existing one?"}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onOpenExisting}>
            {locale === "vi" ? "Mở đơn hiện tại" : "Open existing order"}
          </Button>
          <Button
            size="sm"
            onClick={onConfirmNew}
            className="bg-[#11545B] hover:bg-[#0c3e43]"
          >
            {locale === "vi" ? "Tiếp tục tạo mới" : "Create new order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 7: Reference Code Copied Toast / Feedback (#1662:2552 overlay 7)
 */
export function FigmaReferenceCopiedFeedback({
  copied,
  locale,
}: {
  copied: boolean;
  locale: Locale;
}) {
  if (!copied) return null;
  return (
    <div
      data-figma-node="1662:2552-overlay-copied"
      data-figma-name="Overlay 7 / Reference copied feedback"
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 animate-in fade-in"
    >
      <CheckIcon className="size-3.5" />
      <span>{locale === "vi" ? "Đã sao chép mã" : "Reference copied"}</span>
    </div>
  );
}

/**
 * Overlay 8: Usage Token Breakdown Drill-down Modal (#1662:2552 overlay 8)
 */
export function FigmaUsageDetailBreakdownOverlay({
  open,
  onOpenChange,
  locale,
  provider,
  model,
  breakdown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  provider: string;
  model: string;
  breakdown?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-usage-detail"
        data-figma-name="Overlay 8 / Token usage breakdown detail"
        className="max-w-[500px] rounded-2xl border border-[#D6DFE7] bg-white p-6 shadow-xl"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#101C29]">
            {locale === "vi" ? "Chi tiết phân rã mô hình AI" : "AI Model Breakdown"}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#48586A]">
            {provider} / <span className="font-mono">{model}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3">
          {breakdown}
        </div>

        <DialogFooter className="mt-4">
          <Button size="sm" onClick={() => onOpenChange(false)} className="bg-[#11545B] hover:bg-[#0c3e43]">
            {locale === "vi" ? "Đóng" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Overlay 9: Empty Wallet / First-time Top-up Guidance (#1662:2552 overlay 9)
 */
export function FigmaWalletGuideOverlay({
  open,
  onOpenChange,
  locale,
  onStartTopUp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  onStartTopUp?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-figma-node="1662:2552-overlay-wallet-guide"
        data-figma-name="Overlay 9 / Digital wallet guidance"
        className="max-w-[440px] rounded-2xl border border-[#D6DFE7] bg-white p-6 text-center shadow-xl"
      >
        <div className="flex flex-col items-center space-y-3 py-2">
          <div className="rounded-full bg-cyan-100 p-3 text-[#11545B]">
            <HelpCircle className="size-10" />
          </div>
          <h3 className="text-lg font-bold text-[#101C29]">
            {locale === "vi" ? "Ví trả trước LCSP" : "Prepaid Digital Wallet"}
          </h3>
          <p className="text-xs text-[#48586A]">
            {locale === "vi"
              ? "Nạp tiền vào ví trả trước bằng VND để duy trì hoạt động đánh giá AI. Số dư được bảo lưu và hiển thị minh bạch."
              : "Top up your wallet with VND to maintain AI operations. Balances are held safely and audited transparently."}
          </p>
        </div>
        <DialogFooter className="mt-4 flex gap-2 sm:justify-center">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {locale === "vi" ? "Để sau" : "Later"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onStartTopUp?.();
            }}
            className="bg-[#11545B] hover:bg-[#0c3e43]"
          >
            {locale === "vi" ? "Nạp tiền ngay" : "Top up now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
