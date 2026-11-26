import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Provide a shared response submission container with consistent error, stale-conflict, and saved-state feedback across M05 and M06.
 * Business rules:
 * - Surfaces 409 stale-revision conflicts separately from generic submission errors without discarding user input.
 * - Surfaces saved confirmation only after the backend confirms persistence.
 * Execution flow:
 * 1. Render the slotted answer control (`children`).
 * 2. Render stale-conflict, generic error, or saved confirmation banners when flagged.
 * Failure cases:
 * - None; displays nothing extra when all flags are false.
 * Side effects:
 * - Pure presentational wrapper.
 */
export function ResponseForm({
  children,
  failed = false,
  staleConflict = false,
  submitted = false,
  errorMessage,
  staleConflictMessage,
  className,
}: {
  children: ReactNode;
  failed?: boolean;
  staleConflict?: boolean;
  submitted?: boolean;
  errorMessage?: string;
  staleConflictMessage?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {children}

      {staleConflict ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">
            {staleConflictMessage ??
              resolveAppMessage("pages.assessmentConversation.answer.staleConflict")}
          </AlertDescription>
        </Alert>
      ) : failed ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">
            {errorMessage ??
              resolveAppMessage("pages.assessmentConversation.answer.failed")}
          </AlertDescription>
        </Alert>
      ) : null}

      {submitted ? (
        <p
          role="status"
          className="text-xs font-medium text-status-success"
        >
          {resolveAppMessage(
            "pages.workspace.tracking.requestsResponseSubmitted",
          )}
        </p>
      ) : null}
    </div>
  );
}
