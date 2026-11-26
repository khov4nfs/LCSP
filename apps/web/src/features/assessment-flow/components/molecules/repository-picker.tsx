import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";

import {
  GitAccountStrip,
  resolveGitProviderLabel,
} from "@/components/molecules/git-provider-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveAppMessage } from "@/lib/i18n";

import type { RepositorySetupFormData } from "../../schemas/repository-setup.schema";
import { SourceVersionPicker } from "./source-version-picker";

/**
 * Business purpose: Render Step 3 (`Choose your repository`, Figma Frames 69–70) with URL input, pinned revision preview, and permission check notice.
 * Business rules:
 * - Binds `repositoryUrl` via `react-hook-form` `Controller` and displays localized validation errors inline.
 * - Disables repository submission when the provider credential is missing or preview-only.
 * Execution flow:
 * 1. Render `GitAccountStrip` for the active provider.
 * 2. Render URL input bound to `control` with helper text and validation error.
 * 3. Render `SourceVersionPicker` and repository READ/WRITE check notice.
 * 4. Render `Connect repository` submit button and `Back` button.
 * Failure cases:
 * - Invalid URL displays `pages.assessmentFlow.errors.repositoryUrl` below the input.
 * Side effects:
 * - Submitting invokes `onSubmit`; `onManageCredential` opens credential settings.
 */
export function RepositoryPicker({
  control,
  provider,
  connected,
  previewOnly,
  canEnterRepository,
  isSubmitting,
  pinnedCommitSha,
  errorMessage,
  onManageCredential,
  onBack,
}: {
  control: Control<RepositorySetupFormData>;
  provider: AssessmentRepositoryProvider;
  connected: boolean;
  previewOnly: boolean;
  canEnterRepository: boolean;
  isSubmitting: boolean;
  pinnedCommitSha?: string | null;
  errorMessage?: string;
  onManageCredential: () => void;
  onBack: () => void;
}) {
  const providerLabel = resolveGitProviderLabel(provider);

  return (
    <div className="space-y-4">
      <GitAccountStrip
        provider={provider}
        connected={connected}
        previewOnly={previewOnly}
        onManageCredential={onManageCredential}
      />

      <div className="space-y-2">
        <Label htmlFor="repository-setup-url">
          {resolveAppMessage("pages.assessmentFlow.source.urlLabel")}
        </Label>
        <Controller
          name="repositoryUrl"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              id="repository-setup-url"
              type="url"
              autoComplete="url"
              disabled={!canEnterRepository || isSubmitting}
              aria-invalid={Boolean(errorMessage)}
              placeholder={
                canEnterRepository
                  ? resolveAppMessage(
                      "pages.assessmentFlow.repositoryPlaceholder",
                    )
                  : resolveAppMessage(
                      "pages.assessmentFlow.repositoryDisabledPlaceholder",
                    )
              }
            />
          )}
        />
        <p className="text-xs text-muted-foreground">
          {resolveAppMessage("pages.assessmentFlow.source.urlHelper").replace(
            "{provider}",
            providerLabel,
          )}
        </p>
        {errorMessage ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <SourceVersionPicker pinnedCommitSha={pinnedCommitSha} />

      <div className="rounded-lg bg-muted/60 px-3.5 py-3">
        <p className="text-sm font-medium text-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.permissions.checkNoticeTitle",
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.permissions.checkNoticeBody",
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={!canEnterRepository || isSubmitting}>
          {isSubmitting
            ? resolveAppMessage("pages.assessmentFlow.source.connectingAction")
            : resolveAppMessage("pages.assessmentFlow.source.connectAction")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={onBack}
        >
          {resolveAppMessage("pages.assessmentFlow.actions.back")}
        </Button>
      </div>
    </div>
  );
}
