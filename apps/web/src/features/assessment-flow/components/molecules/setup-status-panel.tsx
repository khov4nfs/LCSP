import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const SETUP_STATUS_ROW_TONES = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
} as const;

export type SetupStatusRowTone =
  (typeof SETUP_STATUS_ROW_TONES)[keyof typeof SETUP_STATUS_ROW_TONES];

export interface SetupStatusRowItem {
  id: string;
  label: string;
  context: string;
  badgeLabel: string;
  tone: SetupStatusRowTone;
}

/**
 * Business purpose: Render `LCSP Data / Setup status row` (`1692:4268`) list and optional notice block for connecting, waiting, resume, retry, and ready states.
 * Business rules:
 * - Each row pairs a left vertical accent rail with a semantic status badge so state is readable without relying on color alone.
 * - Optional notice block surfaces either safe-retry checkpoint reassurance or next-step guidance.
 * Execution flow:
 * 1. Render each status row with tone-matched left rail and badge.
 * 2. Render optional notice banner below the rows when provided.
 * Failure cases:
 * - Empty `rows` renders nothing.
 * Side effects:
 * - Pure presentational component.
 */
export function SetupStatusPanel({
  rows,
  noticeTitle,
  noticeBody,
  noticeTone = SETUP_STATUS_ROW_TONES.info,
  className,
}: {
  rows: SetupStatusRowItem[];
  noticeTitle?: string;
  noticeBody?: string;
  noticeTone?: SetupStatusRowTone;
  className?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <ul className="space-y-2.5">
        {rows.map((row) => {
          const railClass =
            row.tone === SETUP_STATUS_ROW_TONES.success
              ? "bg-brand"
              : row.tone === SETUP_STATUS_ROW_TONES.warning
                ? "bg-status-warning"
                : row.tone === SETUP_STATUS_ROW_TONES.danger
                  ? "bg-status-danger"
                  : row.tone === SETUP_STATUS_ROW_TONES.info
                    ? "bg-status-info"
                    : "bg-muted-foreground";

          const badgeClass =
            row.tone === SETUP_STATUS_ROW_TONES.success
              ? "border-status-success-border bg-status-success-bg text-status-success"
              : row.tone === SETUP_STATUS_ROW_TONES.warning
                ? "border-status-warning-border bg-status-warning-bg text-status-warning"
                : row.tone === SETUP_STATUS_ROW_TONES.danger
                  ? "border-status-danger-border bg-status-danger-bg text-status-danger"
                  : row.tone === SETUP_STATUS_ROW_TONES.info
                    ? "border-status-info-border bg-status-info-bg text-status-info"
                    : "border-border bg-muted text-muted-foreground";

          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3.5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn("h-10 w-0.75 shrink-0 rounded-full", railClass)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {row.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.context}
                  </p>
                </div>
              </div>

              <Badge variant="outline" className={cn("shrink-0", badgeClass)}>
                {row.badgeLabel}
              </Badge>
            </li>
          );
        })}
      </ul>

      {noticeTitle || noticeBody ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3",
            noticeTone === SETUP_STATUS_ROW_TONES.success
              ? "border-status-success-border bg-brand-mint text-foreground"
              : noticeTone === SETUP_STATUS_ROW_TONES.warning
                ? "border-status-warning-border bg-status-warning-bg text-foreground"
                : noticeTone === SETUP_STATUS_ROW_TONES.danger
                  ? "border-status-danger-border bg-status-danger-bg text-foreground"
                  : "border-border bg-muted/60 text-foreground",
          )}
        >
          {noticeTitle ? (
            <p className="text-sm font-medium text-foreground">{noticeTitle}</p>
          ) : null}
          {noticeBody ? (
            <p className="mt-1 text-xs text-muted-foreground">{noticeBody}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
