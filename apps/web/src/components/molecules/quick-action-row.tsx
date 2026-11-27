"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type QuickActionRowProps = {
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
};

/**
 * Business purpose: Render a shared quick-action destination row aligned to Figma master 1828:13593 (LCSP Next / Quick action row).
 * Business rules:
 * - Supports either Next.js Link navigation (when href is provided) or button action (when only onClick is provided).
 * - Preserves keyboard focus visibility and reduced-motion preferences across both customer and admin shells.
 * Execution flow:
 * 1. Compose optional leading icon, title, description, and trailing navigation arrow.
 * 2. Render Link or button with semantic surface, hover, and focus-ring classes.
 * Failure cases:
 * - Missing icon renders cleanly without extra spacing artifacts.
 * Side effects:
 * - Invokes onClick when triggered.
 */
export function QuickActionRow({
  label,
  description,
  href,
  onClick,
  icon,
  className,
}: QuickActionRowProps) {
  const rowClasses = cn(
    "group flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/50 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
    className,
  );

  const content = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground motion-reduce:transition-none">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">
            {label}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        </span>
      </span>
      <ArrowRightIcon
        className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={rowClasses}
        data-component="QuickActionRow"
        data-figma-node="1828:13593"
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={rowClasses}
      data-component="QuickActionRow"
      data-figma-node="1828:13593"
    >
      {content}
    </button>
  );
}
