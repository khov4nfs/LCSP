"use client";

import { useCallback } from "react";
import { AlertCircleIcon } from "lucide-react";
import { toast } from "sonner";
import type { Locale } from "@lcsp/contracts/shared";
import type { UpdatePrivacySettingsInput } from "@lcsp/contracts/auth";
import { resolveMessage } from "@lcsp/i18n";

import { useHydrated } from "@/components/hooks/use-hydrated";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  usePrivacySettingsQuery,
  useUpdatePrivacySettingsMutation,
} from "@/lib/api/auth-queries";

export type PrivacySettingsPanelProps = {
  locale: Locale;
};

/**
 * Business purpose: Manage workspace and account privacy preferences, telemetry, and policy enforcement.
 *
 * Business rules:
 * - improve_models capability is enforced by system policy to disabled (false) and cannot be toggled.
 * - retain_repository_telemetry, enable_audit_export_api, restricted_assessment_sharing, and purge_agent_memory_on_completion are configurable by the user.
 * - Mutations persist directly to the database and trigger reactive cache invalidation.
 *
 * Execution flow:
 * 1. Query current privacy settings from the backend via usePrivacySettingsQuery.
 * 2. Render capability rows with appropriate switch controls or policy badges.
 * 3. On toggle change, invoke useUpdatePrivacySettingsMutation and display feedback toast.
 *
 * Failure cases:
 * - Query failure displays an alert with a retry action.
 * - Mutation failure displays an error toast without corrupting local state.
 *
 * Side effects:
 * - Dispatches HTTP requests via BFF route /api/auth/privacy.
 * - Emits audit trail events on backend upon mutation.
 */
export function PrivacySettingsPanel({ locale }: PrivacySettingsPanelProps) {
  const query = usePrivacySettingsQuery();
  const updateMutation = useUpdatePrivacySettingsMutation();
  const hydrated = useHydrated();

  // Rationale (Why): Separates mutation logic with user feedback to avoid inline closure complexity.
  // Mechanism (How): Dispatches partial update and displays translated sonner toast.
  // Invariants (What): Rejects and handles upstream errors cleanly.
  /**
   * Business purpose: Apply a user privacy toggle update and surface feedback.
   *
   * Business rules:
   * - Only sends the specific field being changed.
   * - Notifies the user via toast upon success or failure.
   *
   * Execution flow:
   * 1. Call mutateAsync with the requested updates.
   * 2. On success, show translated success toast.
   * 3. On error, catch and show translated error toast.
   *
   * Failure cases:
   * - Network or server rejections trigger toast.error.
   *
   * Side effects:
   * - Persists setting change and invalidates query cache.
   */
  const handleToggle = useCallback(
    async (updates: UpdatePrivacySettingsInput) => {
      try {
        await updateMutation.mutateAsync(updates);
        toast.success(
          resolveMessage(
            locale,
            "pages.workspace.settingsHub.privacy.saveSuccess",
          ),
        );
      } catch {
        toast.error(
          resolveMessage(
            locale,
            "pages.workspace.settingsHub.privacy.saveError",
          ),
        );
      }
    },
    [locale, updateMutation],
  );

  const data = hydrated ? query.data : undefined;
  const isUpdating = updateMutation.isPending;

  return (
    <div
      data-component="PrivacySettingsPanel"
      className="h-full space-y-6 overflow-y-auto p-4 sm:p-8"
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {resolveMessage(locale, "pages.workspace.settingsHub.privacy.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.privacy.description",
          )}
        </p>
      </div>

      <Separator />

      {!hydrated || query.isPending ? (
        <div role="status" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.privacy.loading",
            )}
          </p>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        </div>
      ) : null}

      {hydrated && query.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon className="size-4" />
          <AlertTitle>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.privacy.saveError",
            )}
          </AlertTitle>
          <AlertDescription className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
            >
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.billing.retry",
              )}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <div className="divide-y divide-border/70 rounded-md border border-border/70">
          {/* Policy-Enforced: Improve models */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.privacy.improveModels",
                  )}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.privacy.enforcedByPolicy",
                  )}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.improveModelsDescription",
                )}
              </p>
            </div>
            <Switch
              checked={false}
              disabled
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.privacy.improveModels",
              )}
            />
          </div>

          {/* Configurable: Repository metadata */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <span className="text-sm font-medium">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.repositoryMetadata",
                )}
              </span>
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.repositoryMetadataDescription",
                )}
              </p>
            </div>
            <Switch
              checked={data.retain_repository_telemetry}
              disabled={isUpdating}
              onCheckedChange={(checked) =>
                handleToggle({ retain_repository_telemetry: checked })
              }
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.privacy.repositoryMetadata",
              )}
            />
          </div>

          {/* Configurable: Export assessment data */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <span className="text-sm font-medium">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.exportData",
                )}
              </span>
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.exportDataDescription",
                )}
              </p>
            </div>
            <Switch
              checked={data.enable_audit_export_api}
              disabled={isUpdating}
              onCheckedChange={(checked) =>
                handleToggle({ enable_audit_export_api: checked })
              }
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.privacy.exportData",
              )}
            />
          </div>

          {/* Configurable: Restricted assessment sharing */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <span className="text-sm font-medium">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.sharedAssessments",
                )}
              </span>
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.sharedAssessmentsDescription",
                )}
              </p>
            </div>
            <Switch
              checked={data.restricted_assessment_sharing}
              disabled={isUpdating}
              onCheckedChange={(checked) =>
                handleToggle({ restricted_assessment_sharing: checked })
              }
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.privacy.sharedAssessments",
              )}
            />
          </div>

          {/* Configurable: Purge agent memory */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <span className="text-sm font-medium">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.memoryPreferences",
                )}
              </span>
              <p className="text-xs text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.privacy.memoryPreferencesDescription",
                )}
              </p>
            </div>
            <Switch
              checked={data.purge_agent_memory_on_completion}
              disabled={isUpdating}
              onCheckedChange={(checked) =>
                handleToggle({ purge_agent_memory_on_completion: checked })
              }
              aria-label={resolveMessage(
                locale,
                "pages.workspace.settingsHub.privacy.memoryPreferences",
              )}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
