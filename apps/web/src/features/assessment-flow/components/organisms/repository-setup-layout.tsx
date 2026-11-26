import type { ReactNode } from "react";
import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import { CheckCircle2 } from "lucide-react";

import {
  GitPermissionsBadges,
  GitProviderBrandBadge,
  resolveGitProviderLabel,
} from "@/components/molecules/git-provider-identity";
import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  SetupStepper,
  type SetupStepperItem,
} from "../molecules/setup-stepper";

export const SETUP_HEADER_TONES = {
  brand: "brand",
  danger: "danger",
} as const;

export type SetupHeaderTone =
  (typeof SETUP_HEADER_TONES)[keyof typeof SETUP_HEADER_TONES];

export const SUMMARY_STATUS_TONES = {
  info: "info",
  warning: "warning",
  danger: "danger",
  success: "success",
} as const;

export type SummaryStatusTone =
  (typeof SUMMARY_STATUS_TONES)[keyof typeof SUMMARY_STATUS_TONES];

/**
 * Business purpose: Render the canonical 2-column Repository Setup shell matching Figma Frames 67–75, 88–90, and 98–104.
 * Business rules:
 * - Combines the page header, 4-step `SetupStepper`, left `Current setup step` card, and right `Assessment summary` card.
 * - Uses semantic Tailwind tokens (`from-bento-from to-bento-to`, `status-*`, `brand`) without hardcoded colors.
 * - Explicitly notes that setup status is not a legal compliance result.
 * Execution flow:
 * 1. Render page title, subtitle, and `SetupStepper`.
 * 2. Render left step card with tone-aware header and retained-progress footer.
 * 3. Render right `Assessment summary` card with provider, repository, compliance rules, and next-step guidance.
 * Failure cases:
 * - Responsive single-column fallback on viewports narrower than `lg`.
 * Side effects:
 * - Pure layout component.
 */
export function RepositorySetupLayout({
  steps,
  onStepSelect,
  stepTitle,
  stepSubtitle,
  headerTone = SETUP_HEADER_TONES.brand,
  showReadyIndicator = false,
  assessmentTitle,
  summaryStatusLabel,
  summaryStatusTone = SUMMARY_STATUS_TONES.info,
  provider,
  repositoryLabel,
  rulesLabel,
  children,
}: {
  steps: SetupStepperItem[];
  onStepSelect?: (stepId: string) => void;
  stepTitle: string;
  stepSubtitle: string;
  headerTone?: SetupHeaderTone;
  showReadyIndicator?: boolean;
  assessmentTitle: string;
  summaryStatusLabel: string;
  summaryStatusTone?: SummaryStatusTone;
  provider?: AssessmentRepositoryProvider | null;
  repositoryLabel?: string | null;
  rulesLabel: string;
  children: ReactNode;
}) {
  const isDangerHeader = headerTone === SETUP_HEADER_TONES.danger;
  const summaryBadgeClass =
    summaryStatusTone === SUMMARY_STATUS_TONES.success
      ? "border-status-success-border bg-status-success-bg text-status-success"
      : summaryStatusTone === SUMMARY_STATUS_TONES.warning
        ? "border-status-warning-border bg-status-warning-bg text-status-warning"
        : summaryStatusTone === SUMMARY_STATUS_TONES.danger
          ? "border-status-danger-border bg-status-danger-bg text-status-danger"
          : "border-status-info-border bg-status-info-bg text-status-info";

  return (
    <div className="flex w-full flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {resolveAppMessage("pages.assessmentFlow.setupPageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {resolveAppMessage("pages.assessmentFlow.setupPageSubtitle")}
        </p>
      </header>

      <SetupStepper steps={steps} onStepSelect={onStepSelect} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_408px]">
        <section
          aria-label={stepTitle}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        >
          <div
            className={cn(
              "flex items-start justify-between gap-4 border-b border-border px-5 py-4",
              isDangerHeader
                ? "bg-status-danger-bg text-status-danger"
                : "bg-linear-to-r from-bento-from to-bento-to text-bento-foreground",
            )}
          >
            <div className="min-w-0 space-y-1">
              <h2
                className={cn(
                  "text-xl font-semibold tracking-tight",
                  isDangerHeader ? "text-status-danger" : "text-bento-heading",
                )}
              >
                {stepTitle}
              </h2>
              <p
                className={cn(
                  "text-sm",
                  isDangerHeader ? "text-foreground/85" : "text-bento-muted",
                )}
              >
                {stepSubtitle}
              </p>
            </div>
            {showReadyIndicator ? (
              <CheckCircle2
                className="mt-0.5 size-7 shrink-0 text-brand-mint"
                aria-hidden="true"
              />
            ) : null}
          </div>

          <div className="flex flex-1 flex-col justify-between gap-4 p-5">
            <div>{children}</div>
            <p className="text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.assessmentFlow.statusRows.progressRetained",
              )}
            </p>
          </div>
        </section>

        <aside
          aria-label={resolveAppMessage("pages.assessmentFlow.summary.title")}
          className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs"
        >
          <div className="space-y-3 bg-linear-to-r from-bento-from to-bento-to px-5 py-4 text-bento-foreground">
            <p className="text-sm font-semibold text-bento-muted">
              {resolveAppMessage("pages.assessmentFlow.summary.title")}
            </p>
            <p className="text-lg font-semibold leading-snug text-bento-heading">
              {assessmentTitle}
            </p>
            <div>
              <Badge variant="outline" className={summaryBadgeClass}>
                {summaryStatusLabel}
              </Badge>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between gap-5 p-5">
            <dl className="space-y-4">
              <div className="border-l-2 border-brand pl-3">
                <dt className="text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.summary.providerLabel",
                  )}
                </dt>
                <dd className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                  {provider ? (
                    <>
                      <GitProviderBrandBadge provider={provider} size="sm" />
                      <span>{resolveGitProviderLabel(provider)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {resolveAppMessage(
                        "pages.assessmentFlow.summary.providerUnselected",
                      )}
                    </span>
                  )}
                </dd>
                {provider ? <GitPermissionsBadges className="mt-2" /> : null}
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.summary.repositoryLabel",
                  )}
                </dt>
                <dd className="mt-1 break-all text-sm font-semibold text-foreground">
                  {repositoryLabel || (
                    <span className="font-normal text-muted-foreground">
                      {resolveAppMessage(
                        "pages.assessmentFlow.summary.repositoryUnselected",
                      )}
                    </span>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs text-muted-foreground">
                  {resolveAppMessage("pages.assessmentFlow.summary.rulesLabel")}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {rulesLabel}
                </dd>
              </div>
            </dl>

            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.summary.whatNextTitle",
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resolveAppMessage(
                    "pages.assessmentFlow.summary.whatNextBody",
                  )}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {resolveAppMessage("pages.assessmentFlow.summary.disclaimer")}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
