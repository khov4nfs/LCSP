import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Business purpose: Render the shared Figma `LCSP Next / Document gallery card` (`1831:13681`) consumed by M10 (Reports) and M11 (Artifacts).
 * Business rules:
 * - Displays document icon tile, status slot/label, title, source & date metadata, and bottom action link or slot.
 * - Uses semantic tokens (`bg-brand-mint`, `text-brand`, `border-border`, `bg-card`) with zero hardcoded hex colors.
 * Execution flow:
 * 1. Render top icon tile and status indicator.
 * 2. Render title and source/date metadata row.
 * 3. Render footer divider and action link or custom `actions` slot.
 * Failure cases:
 * - Missing `actions` and `actionHref` omits the footer action cleanly.
 * Side effects:
 * - Pure presentational card with Next.js navigation when `actionHref` is provided.
 */
export function DocumentGalleryCard({
  title,
  status,
  source,
  date,
  badges,
  actionLabel,
  actionHref,
  actions,
  className,
}: {
  title: string;
  status: ReactNode;
  source: string;
  date: string;
  badges?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "flex h-full flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-brand/40",
        className,
      )}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-brand-mint text-brand"
            >
              <FileTextIcon className="size-4.5" />
            </span>
            <div className="text-xs font-semibold text-brand">{status}</div>
          </div>
          {badges ? <div className="flex flex-wrap gap-1">{badges}</div> : null}
        </div>

        <h2 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
          {title}
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{source}</span>
          <span className="shrink-0">{date}</span>
        </div>
      </div>

      {actions || (actionHref && actionLabel) ? (
        <div className="mt-4 border-t border-border pt-3">
          {actions ?? (
            <Link
              href={actionHref!}
              className="inline-flex w-full items-center justify-between text-xs font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span>{actionLabel}</span>
              <ArrowUpRightIcon className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : null}
    </article>
  );
}
