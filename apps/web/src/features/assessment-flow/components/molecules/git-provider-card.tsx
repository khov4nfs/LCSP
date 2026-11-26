import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import { CheckCircle2 } from "lucide-react";

import {
  GitProviderBrandBadge,
  resolveGitProviderLabel,
} from "@/components/molecules/git-provider-identity";
import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Render an interactive Git provider selection card matching Figma Frame 67 (`1662:6005`).
 * Business rules:
 * - Shows provider logo, localized name, hostname, and credential/availability status.
 * - Preview-only / unavailable providers remain visibly distinct and cannot be mistaken for active backend connectors.
 * Execution flow:
 * 1. Render a button with `aria-pressed={selected}`.
 * 2. Display connection/preview badge and selection indicator.
 * Failure cases:
 * - Disabled state prevents activation while keeping focus/accessibility semantics clear.
 * Side effects:
 * - Calls `onSelect(provider)` on click.
 */
export function GitProviderCard({
  provider,
  hostname,
  selected,
  connected,
  enabled,
  onSelect,
  className,
}: {
  provider: AssessmentRepositoryProvider;
  hostname: string;
  selected: boolean;
  connected: boolean;
  enabled: boolean;
  onSelect: (provider: AssessmentRepositoryProvider) => void;
  className?: string;
}) {
  const label = resolveGitProviderLabel(provider);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(provider)}
      className={cn(
        "group flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-brand bg-brand-mint/45 shadow-xs"
          : "border-border bg-card hover:border-brand/50 hover:bg-muted/30",
        !enabled && "opacity-85",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <GitProviderBrandBadge provider={provider} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {label}
            </span>
            {!enabled ? (
              <Badge
                variant="outline"
                className="border-status-warning-border bg-status-warning-bg text-status-warning"
              >
                {resolveAppMessage(
                  "pages.assessmentFlow.providerCard.previewBadge",
                )}
              </Badge>
            ) : connected ? (
              <Badge
                variant="outline"
                className="border-status-success-border bg-status-success-bg text-status-success"
              >
                {resolveAppMessage(
                  "pages.assessmentFlow.providerCard.connectedBadge",
                )}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-status-warning-border bg-status-warning-bg text-status-warning"
              >
                {resolveAppMessage(
                  "pages.assessmentFlow.providerCard.needsTokenBadge",
                )}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {hostname}
          </p>
        </div>
      </div>

      {selected ? (
        <CheckCircle2
          className="mt-0.5 size-5 shrink-0 text-brand"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
