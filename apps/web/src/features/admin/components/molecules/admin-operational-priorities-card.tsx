"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle, Clock, FileText, CheckCircle2, ChevronRight, ArrowUpRight } from "lucide-react";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { FigmaAdminCardHeader } from "@/components/figma/admin-overview-masters";
import { cn } from "@/lib/utils";

export type AdminPriorityQueueItem = {
  id: string;
  title: string;
  category: string;
  count: number;
  href: string;
  tone: "warning" | "danger" | "info";
};

export function AdminOperationalPrioritiesCard({
  items,
  totalExceptions,
  totalLegalSources,
  className,
}: {
  items?: AdminPriorityQueueItem[];
  totalExceptions?: number;
  totalLegalSources?: number;
  className?: string;
}) {
  const defaultItems: AdminPriorityQueueItem[] = items ?? [
    {
      id: "awaiting-input",
      title: "12 awaiting customer input",
      category: "Assessment queue",
      count: 12,
      href: "/admin/overview",
      tone: "warning",
    },
    {
      id: "failed-assessments",
      title: "6 failed assessments",
      category: "Execution exceptions",
      count: 6,
      href: "/admin/overview",
      tone: "danger",
    },
    {
      id: "legal-reviews",
      title: "4 legal reviews pending",
      category: "Translation / preparation review",
      count: 4,
      href: "/admin/legal-sources",
      tone: "warning",
    },
  ];

  return (
    <div
      data-figma-node="1682:1743"
      data-figma-name="Operational priorities"
      className={cn(
        "flex flex-col justify-between rounded-2xl border border-[#DDE5EB] bg-white p-5 shadow-xs",
        className
      )}
    >
      <div>
        <div className="relative pl-3">
          <div className="absolute left-0 top-1 bottom-1 w-1 rounded-full bg-[#D97706]" />
          <FigmaAdminCardHeader
            title="Operational priorities"
            description="22 outstanding items across distinct queues"
            titleClassName="text-lg font-bold text-[#101C29]"
            descriptionClassName="text-xs text-[#48586A]"
          />
        </div>

        {/* Priority items list */}
        <div className="mt-4 divide-y divide-[#D6DFE7]">
          {defaultItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    item.tone === "danger"
                      ? "bg-red-50 text-red-600"
                      : "bg-amber-50 text-amber-600"
                  )}
                >
                  <AlertCircle className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#101C29]">{item.title}</p>
                  <p className="text-xs text-[#48586A]">{item.category}</p>
                </div>
              </div>
              <Link
                href={item.href}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#11545B] hover:text-[#0b383d] transition-colors"
              >
                <span>View</span>
                <span aria-hidden="true">›</span>
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Cards at bottom */}
      <div className="mt-4 space-y-2 pt-2 border-t border-[#D6DFE7]">
        <NextMetricCard
          label="Assessment exceptions"
          value={totalExceptions ?? 18}
          context="12 awaiting input · 6 failed"
          variant={NEXT_METRIC_VARIANTS.attention}
          href="/admin/overview"
        />
        <NextMetricCard
          label="Legal sources"
          value={totalLegalSources ?? 184}
          context="Published and draft documents"
          variant={NEXT_METRIC_VARIANTS.ready}
          href="/admin/legal-sources"
        />
      </div>
    </div>
  );
}
