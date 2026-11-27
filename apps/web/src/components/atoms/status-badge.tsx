import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const STATUS_BADGE_TONES = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
} as const;

export type StatusBadgeTone =
  (typeof STATUS_BADGE_TONES)[keyof typeof STATUS_BADGE_TONES];

const TONE_CLASSES: Record<StatusBadgeTone, string> = {
  [STATUS_BADGE_TONES.success]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [STATUS_BADGE_TONES.warning]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [STATUS_BADGE_TONES.danger]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
  [STATUS_BADGE_TONES.info]:
    "border-status-info-border bg-status-info-bg text-status-info",
  [STATUS_BADGE_TONES.neutral]:
    "border-border bg-muted text-muted-foreground",
};

const DOT_CLASSES: Record<StatusBadgeTone, string> = {
  [STATUS_BADGE_TONES.success]: "bg-status-success",
  [STATUS_BADGE_TONES.warning]: "bg-status-warning",
  [STATUS_BADGE_TONES.danger]: "bg-status-danger",
  [STATUS_BADGE_TONES.info]: "bg-status-info",
  [STATUS_BADGE_TONES.neutral]: "bg-muted-foreground",
};

type StatusBadgeProps = {
  tone?: StatusBadgeTone;
  label?: ReactNode;
  children?: ReactNode;
  showDot?: boolean;
  pill?: boolean;
  className?: string;
};

/**
 * Business purpose: Provide the single canonical semantic status badge aligned to Figma LCSP Data / Status masters (1681:1297..1303).
 * Business rules:
 * - Maps semantic tones (success, warning, danger, info, neutral) to globals.css status tokens without hardcoded hex values.
 * - Supports optional 8px leading status dot and pill vs rounded-md badge shape.
 * Execution flow:
 * 1. Resolve semantic border, background, and foreground token classes for the requested tone.
 * 2. Render Badge with optional indicator dot and label/children content.
 * Failure cases:
 * - Defaults to neutral tone when tone is omitted.
 * Side effects:
 * - Pure presentational atom.
 */
export function StatusBadge({
  tone = STATUS_BADGE_TONES.neutral,
  label,
  children,
  showDot = false,
  pill = false,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        pill && "rounded-full px-2.5 py-0.5",
        TONE_CLASSES[tone],
        className,
      )}
      data-component="StatusBadge"
      data-tone={tone}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", DOT_CLASSES[tone])}
        />
      ) : null}
      {label ?? children}
    </Badge>
  );
}
