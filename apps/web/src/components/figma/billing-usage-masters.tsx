"use client";

import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Figma Component: LCSP Data / Table row / payment (#1682:1261)
 * Consumed by:
 * 1. BillingSettingsPanel (Top-up history table row)
 * 2. Admin Billing transaction tables
 */
export type FigmaPaymentTableRowProps = {
  c0Date: ReactNode;
  c1Amount: ReactNode;
  c2PaymentCode: ReactNode;
  c4Status: ReactNode;
  onClick?: () => void;
  className?: string;
  selected?: boolean;
};

export function FigmaPaymentTableRow({
  c0Date,
  c1Amount,
  c2PaymentCode,
  c4Status,
  onClick,
  className,
  selected,
}: FigmaPaymentTableRowProps) {
  return (
    <div
      data-figma-node="1682:1261"
      data-figma-name="LCSP Data / Table row / payment"
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[44px] items-center border-b border-[#D6DFE7] bg-white px-4 py-2.5 text-sm transition-colors",
        onClick && "cursor-pointer hover:bg-[#F8FAFC]",
        selected && "bg-[#F1F7F6]",
        className
      )}
    >
      <div className="w-[180px] shrink-0 font-semibold text-[#101C29]">
        {c0Date}
      </div>
      <div className="w-[200px] shrink-0 font-mono text-[#48586A]">
        {c1Amount}
      </div>
      <div className="w-[240px] shrink-0 font-mono text-[#48586A]">
        {c2PaymentCode}
      </div>
      <div className="flex-1 text-right font-medium text-[#11545B]">
        {c4Status}
      </div>
    </div>
  );
}

/**
 * Figma Component: LCSP Data / Table row / usage (#1682:1267)
 * Consumed by:
 * 1. CustomerUsageHistory (Settings / Usage table row)
 * 2. Admin Usage inspection tables
 */
export type FigmaUsageTableRowProps = {
  c0Time: ReactNode;
  c1Provider: ReactNode;
  c2Model: ReactNode;
  c3Tokens: ReactNode;
  c4CostOrStatus: ReactNode;
  className?: string;
  onClick?: () => void;
};

export function FigmaUsageTableRow({
  c0Time,
  c1Provider,
  c2Model,
  c3Tokens,
  c4CostOrStatus,
  className,
  onClick,
}: FigmaUsageTableRowProps) {
  return (
    <div
      data-figma-node="1682:1267"
      data-figma-name="LCSP Data / Table row / usage"
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[44px] items-center border-b border-[#D6DFE7] bg-white px-4 py-2.5 text-sm transition-colors",
        onClick && "cursor-pointer hover:bg-[#F8FAFC]",
        className
      )}
    >
      <div className="w-[220px] shrink-0 font-semibold text-[#101C29]">
        {c0Time}
      </div>
      <div className="w-[180px] shrink-0 text-[#48586A]">
        {c1Provider}
      </div>
      <div className="w-[200px] shrink-0 font-mono text-[#48586A]">
        {c2Model}
      </div>
      <div className="w-[200px] shrink-0 font-mono text-[#48586A]">
        {c3Tokens}
      </div>
      <div className="flex-1 text-right font-medium text-[#11545B]">
        {c4CostOrStatus}
      </div>
    </div>
  );
}

/**
 * Figma Component: LCSP Next / Metric / Financial & usage (#1837:14045)
 * Consumed by:
 * 1. BillingSettingsPanel (Available balance card)
 * 2. CustomerUsageSummary (Financial & usage metrics)
 */
export type FigmaFinancialMetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  context?: ReactNode;
  className?: string;
};

export function FigmaFinancialMetricCard({
  label,
  value,
  context,
  className,
}: FigmaFinancialMetricCardProps) {
  return (
    <div
      data-figma-node="1837:14045"
      data-figma-name="LCSP Next / Metric / Financial & usage"
      className={cn(
        "relative flex flex-col justify-between rounded-[10px] bg-[#214752] p-4 text-white shadow-xs transition-all",
        className
      )}
    >
      <span className="text-[13px] font-semibold text-[#C6DFE1] tracking-wide">
        {label}
      </span>
      <div className="mt-1 font-sans text-3xl font-semibold tracking-tight text-white">
        {value}
      </div>
      {context && (
        <span className="mt-2 text-xs text-[#C6DFE1]/90">
          {context}
        </span>
      )}
    </div>
  );
}

/**
 * Figma Component: LCSP Data / Status / warning (#1681:1299)
 * Consumed by:
 * 1. Billing payment order pending state
 * 2. Customer usage warning state
 */
export type FigmaStatusBadgeProps = {
  label: ReactNode;
  variant?: "warning" | "success" | "neutral" | "danger";
  className?: string;
};

export function FigmaStatusBadge({
  label,
  variant = "warning",
  className,
}: FigmaStatusBadgeProps) {
  const variantStyles = {
    warning: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
    success: "bg-[#E2F6F1] text-[#087F75] border-[#A8E5D8]",
    neutral: "bg-[#F1F5F7] text-[#48586A] border-[#D6DFE7]",
    danger: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
  };

  return (
    <span
      data-figma-node="1681:1299"
      data-figma-name="LCSP Data / Status / warning"
      className={cn(
        "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide",
        variantStyles[variant],
        className
      )}
    >
      {label}
    </span>
  );
}
