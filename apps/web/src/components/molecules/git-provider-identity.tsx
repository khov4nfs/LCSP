import {
  ASSESSMENT_REPOSITORY_PROVIDERS,
  type AssessmentRepositoryProvider,
} from "@lcsp/contracts/assessment";
import { Lock, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Canonical provider brand asset mapping shared across M02 (Repository Setup)
 * and M14 (Workspace Settings).
 */
export const GIT_PROVIDER_LOGOS: Record<AssessmentRepositoryProvider, string> = {
  [ASSESSMENT_REPOSITORY_PROVIDERS.github]:
    "/assets/figma/settings/logo-github.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.gitlab]:
    "/assets/figma/settings/logo-gitlab.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket]:
    "/assets/figma/settings/logo-bitbucket.svg",
  [ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps]:
    "/assets/figma/settings/logo-azure-devops.svg",
};

/**
 * Business purpose: Resolve the localized display label for a canonical Git provider.
 * Business rules:
 * - Only canonical `AssessmentRepositoryProvider` values are mapped to `@lcsp/i18n` keys.
 * Execution flow:
 * 1. Look up the provider in the canonical key table.
 * 2. Resolve the localized string via `resolveAppMessage`.
 * Failure cases:
 * - Unknown runtime strings fall back to GitHub label resolution safely.
 * Side effects:
 * - Pure read of localized message catalog.
 */
export function resolveGitProviderLabel(
  provider: AssessmentRepositoryProvider,
): string {
  switch (provider) {
    case ASSESSMENT_REPOSITORY_PROVIDERS.gitlab:
      return resolveAppMessage("pages.assessmentFlow.providers.gitlab");
    case ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket:
      return resolveAppMessage("pages.assessmentFlow.providers.bitbucket");
    case ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps:
      return resolveAppMessage("pages.assessmentFlow.providers.azureDevOps");
    case ASSESSMENT_REPOSITORY_PROVIDERS.github:
    default:
      return resolveAppMessage("pages.assessmentFlow.providers.github");
  }
}

/**
 * Business purpose: Render the canonical Figma brand icon for GitHub, GitLab, Bitbucket, or Azure DevOps.
 * Business rules:
 * - Uses shared static SVG assets under `/assets/figma/settings/` rather than inline or Lucide approximations.
 * Execution flow:
 * 1. Select the provider logo URL from `GIT_PROVIDER_LOGOS`.
 * 2. Render an accessible image inside a bordered surface container.
 * Failure cases:
 * - None; decorative when `decorative` is true.
 * Side effects:
 * - Pure presentational component.
 */
export function GitProviderBrandBadge({
  provider,
  size = "md",
  className,
}: {
  provider: AssessmentRepositoryProvider;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const boxSize =
    size === "sm" ? "size-6" : size === "lg" ? "size-10" : "size-8";
  const imgSize =
    size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-card",
        boxSize,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG brand icon */}
      <img
        alt=""
        aria-hidden="true"
        className={cn("object-contain", imgSize)}
        src={GIT_PROVIDER_LOGOS[provider]}
      />
    </span>
  );
}

/**
 * Business purpose: Render the Figma `LCSP shadcn / Git permissions` (`1717:8741`) badge strip.
 * Business rules:
 * - Always clarifies that READ access is required and WRITE access is optional.
 * Execution flow:
 * 1. Render the READ required badge with brand-mint styling.
 * 2. Render the WRITE optional badge with neutral outline styling.
 * Failure cases:
 * - None.
 * Side effects:
 * - Pure presentational component.
 */
export function GitPermissionsBadges({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Badge
        variant="secondary"
        className="gap-1 border border-status-success-border bg-status-success-bg text-status-success"
      >
        <ShieldCheck className="size-3" aria-hidden="true" />
        <span>
          {resolveAppMessage("pages.assessmentFlow.permissions.readRequired")} ·{" "}
          {resolveAppMessage("pages.assessmentFlow.permissions.readLabel")}
        </span>
      </Badge>
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Lock className="size-3" aria-hidden="true" />
        <span>
          {resolveAppMessage("pages.assessmentFlow.permissions.writeOptional")}{" "}
          · {resolveAppMessage("pages.assessmentFlow.permissions.writeLabel")}
        </span>
      </Badge>
    </div>
  );
}

/**
 * Business purpose: Render the shared `LCSP Git / Account strip` (`1719:9102`) showing provider identity, credential status, and optional action.
 * Business rules:
 * - Preview-only providers must display preview-only status and never imply active backend credentials.
 * - Connected credentials display a positive semantic badge; missing credentials prompt configuration.
 * Execution flow:
 * 1. Render provider brand badge and localized provider name.
 * 2. Render connection status badge (`Connected`, `Needs token`, or `Preview only`).
 * 3. Render optional subtitle (e.g., masked account/token hint) and action button.
 * Failure cases:
 * - Missing action callback omits the action button cleanly.
 * Side effects:
 * - Invokes `onManageCredential` when clicked.
 */
export function GitAccountStrip({
  provider,
  connected,
  previewOnly = false,
  subtitle,
  actionLabel,
  onManageCredential,
  className,
}: {
  provider: AssessmentRepositoryProvider;
  connected: boolean;
  previewOnly?: boolean;
  subtitle?: string | null;
  actionLabel?: string;
  onManageCredential?: () => void;
  className?: string;
}) {
  const providerLabel = resolveGitProviderLabel(provider);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <GitProviderBrandBadge provider={provider} size="md" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {providerLabel}
            </span>
            {previewOnly ? (
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
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {onManageCredential && !previewOnly ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onManageCredential}
        >
          {actionLabel ??
            resolveAppMessage("pages.assessmentFlow.actions.changeCredential")}
        </Button>
      ) : null}
    </div>
  );
}
