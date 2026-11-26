import { AlertTriangle, Check } from "lucide-react";

import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const SETUP_STEP_STATES = {
  complete: "complete",
  current: "current",
  upcoming: "upcoming",
  attention: "attention",
} as const;

export type SetupStepState =
  (typeof SETUP_STEP_STATES)[keyof typeof SETUP_STEP_STATES];

export interface SetupStepperItem {
  id: string;
  label: string;
  state: SetupStepState;
}

/**
 * Business purpose: Render the 4-step horizontal setup progress bar matching Figma Frames 67–75.
 * Business rules:
 * - Displays all four canonical setup stages (`Git provider`, `Secure connection`, `Repository source`, `Scan & activation`).
 * - Each step reflects one explicit state (`complete`, `current`, `upcoming`, or `attention`) using semantic tokens.
 * Execution flow:
 * 1. Render an accessible ordered list inside a card surface.
 * 2. Display step number/checkmark/alert icon, localized title, and localized state subtitle.
 * Failure cases:
 * - None; degrades to stacked grid on narrow/mobile viewports to prevent clipping.
 * Side effects:
 * - Pure presentational component.
 */
export function SetupStepper({
  steps,
  onStepSelect,
  className,
}: {
  steps: SetupStepperItem[];
  onStepSelect?: (stepId: string) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label={resolveAppMessage("pages.assessmentFlow.stepper.ariaLabel")}
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs",
        className,
      )}
    >
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const isComplete = step.state === SETUP_STEP_STATES.complete;
          const isCurrent = step.state === SETUP_STEP_STATES.current;
          const isAttention = step.state === SETUP_STEP_STATES.attention;
          const isClickable = isComplete && Boolean(onStepSelect);
          const stateLabel = isComplete
            ? resolveAppMessage("pages.assessmentFlow.stepper.complete")
            : isCurrent
              ? resolveAppMessage("pages.assessmentFlow.stepper.current")
              : isAttention
                ? resolveAppMessage("pages.assessmentFlow.stepper.attention")
                : resolveAppMessage("pages.assessmentFlow.stepper.upcoming");

          const content = (
            <>
              <span
                className={cn(
                  "flex size-8.5 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  isComplete && "bg-brand text-primary-foreground",
                  isCurrent && "bg-brand-mint text-brand-deep",
                  isAttention && "bg-status-danger-bg text-status-danger",
                  !isComplete &&
                    !isCurrent &&
                    !isAttention &&
                    "bg-muted text-muted-foreground",
                )}
              >
                {isComplete ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : isAttention ? (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>

              <div className="min-w-0 flex-1 text-left">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    isCurrent ? "text-brand-deep" : "text-foreground",
                  )}
                >
                  {step.label}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {stateLabel}
                </p>
              </div>
            </>
          );

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-center"
            >
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(step.id)}
                  className="flex w-full items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex w-full items-center gap-3 p-1">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
