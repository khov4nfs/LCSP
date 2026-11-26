import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import { KeyRound, Lock } from "lucide-react";

import {
  GitAccountStrip,
  GitPermissionsBadges,
  resolveGitProviderLabel,
} from "@/components/molecules/git-provider-identity";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";

/**
 * Business purpose: Render Step 2 (`Configure secure connection`, Figma Frame 68) for verifying or updating provider credentials before entering a repository URL.
 * Business rules:
 * - Displays the selected provider account strip, required READ / optional WRITE permissions, and encryption notice.
 * - Preview-only providers cannot proceed as verified backend connections.
 * Execution flow:
 * 1. Render `GitAccountStrip` for the selected provider and credential state.
 * 2. Render `GitPermissionsBadges` card and security lock notice.
 * 3. Provide actions to configure/manage credentials or continue when connected.
 * Failure cases:
 * - Unconfigured or preview-only provider disables the Continue action.
 * Side effects:
 * - Opens `ProviderCredentialDialog` via `onConfigureCredential`.
 */
export function SecureConnectionForm({
  provider,
  connected,
  previewOnly,
  credentialHint,
  onConfigureCredential,
  onContinue,
  onBack,
}: {
  provider: AssessmentRepositoryProvider;
  connected: boolean;
  previewOnly: boolean;
  credentialHint?: string | null;
  onConfigureCredential: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const providerLabel = resolveGitProviderLabel(provider);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.providerCard.selectedProviderLabel",
          )}
        </p>
        <GitAccountStrip
          provider={provider}
          connected={connected}
          previewOnly={previewOnly}
          subtitle={
            credentialHint ??
            resolveAppMessage("pages.assessmentFlow.providerHelp")
          }
          onManageCredential={onConfigureCredential}
        />
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <p className="text-sm font-medium text-foreground">
          {resolveAppMessage("pages.assessmentFlow.permissions.cardTitle")}
        </p>
        <GitPermissionsBadges className="mt-2.5" />
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {resolveAppMessage(
              "pages.assessmentFlow.permissions.securityLockNotice",
            )}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {connected && !previewOnly ? (
          <Button type="button" onClick={onContinue}>
            {resolveAppMessage("pages.assessmentFlow.actions.continue")}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={previewOnly}
            onClick={onConfigureCredential}
          >
            <KeyRound className="mr-2 size-4" aria-hidden="true" />
            {resolveAppMessage("pages.assessmentFlow.configureProvider")}
          </Button>
        )}

        <Button type="button" variant="outline" onClick={onBack}>
          {resolveAppMessage("pages.assessmentFlow.actions.back")}
        </Button>

        {previewOnly ? (
          <p className="w-full text-xs text-status-warning">
            {resolveAppMessage(
              "pages.assessmentFlow.providerCard.previewNotice",
            )}{" "}
            ({providerLabel})
          </p>
        ) : null}
      </div>
    </div>
  );
}
