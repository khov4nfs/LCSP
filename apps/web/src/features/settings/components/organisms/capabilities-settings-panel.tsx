"use client";

import { useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  InfoIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Locale } from "@lcsp/contracts/shared";
import {
  TOOL_ACCESS_MODES,
  updateCapabilitySettingsSchema,
  type ToolAccessMode,
  type UpdateCapabilitySettingsInput,
} from "@lcsp/contracts/auth";
import { resolveMessage } from "@lcsp/i18n";

import { useHydrated } from "@/components/hooks/use-hydrated";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useCapabilitySettingsQuery,
  useUpdateCapabilitySettingsMutation,
} from "@/lib/api/auth-queries";

export type CapabilitiesSettingsPanelProps = {
  locale: Locale;
};

/**
 * Business purpose: Manage customer-configurable runtime capabilities and display enforced platform execution policies.
 *
 * Business rules:
 * - Backend is the single source of truth for effective capabilities and system policies.
 * - tool_access_mode, connector_search, and artifacts are customer-configurable.
 * - cloud_code_execution, network_egress, and domain_allowlist are enforced by platform/runtime policy and remain read-only.
 * - Updates persist via /api/auth/capabilities and trigger query cache invalidation.
 *
 * Execution flow:
 * 1. Fetch effective capability configuration via useCapabilitySettingsQuery.
 * 2. Sync form state with confirmed backend values via react-hook-form + zodResolver.
 * 3. Dispatch partial updates via useUpdateCapabilitySettingsMutation on control changes and surface toast feedback.
 *
 * Failure cases:
 * - Query failure renders an error alert with a retry button.
 * - Mutation failure surfaces a translated error toast and resets form values back to confirmed backend state.
 *
 * Side effects:
 * - Sends GET/PATCH requests to /api/auth/capabilities BFF route.
 * - Records audit trail events upstream on configuration changes.
 */
export function CapabilitiesSettingsPanel({
  locale,
}: CapabilitiesSettingsPanelProps) {
  const query = useCapabilitySettingsQuery();
  const updateMutation = useUpdateCapabilitySettingsMutation();
  const hydrated = useHydrated();
  const data = hydrated ? query.data : undefined;
  const isUpdating = updateMutation.isPending;

  const { control, reset } = useForm<UpdateCapabilitySettingsInput>({
    resolver: zodResolver(updateCapabilitySettingsSchema),
    defaultValues: {
      tool_access_mode: TOOL_ACCESS_MODES.loadWhenNeeded,
      connector_search: true,
      artifacts: true,
    },
    values: data
      ? {
          tool_access_mode: data.tool_access_mode,
          connector_search: data.connector_search,
          artifacts: data.artifacts,
        }
      : undefined,
  });

  /**
   * Business purpose: Persist a single configurable capability change and surface confirmation or error feedback.
   *
   * Business rules:
   * - Only sends the changed configurable field to the backend.
   * - Reverts form state to the last confirmed server values if persistence fails.
   *
   * Execution flow:
   * 1. Call updateMutation.mutateAsync with the partial update.
   * 2. Show translated success toast on confirmation.
   * 3. On failure, reset form values from confirmed query data and show translated error toast.
   *
   * Failure cases:
   * - Network or validation failures trigger toast.error and preserve confirmed backend state.
   *
   * Side effects:
   * - Mutates capability settings and invalidates query cache.
   */
  const applyUpdate = useCallback(
    async (updates: UpdateCapabilitySettingsInput) => {
      try {
        await updateMutation.mutateAsync(updates);
        toast.success(
          resolveMessage(
            locale,
            "pages.workspace.settingsHub.capabilities.saveSuccess",
          ),
        );
      } catch {
        if (data) {
          reset({
            tool_access_mode: data.tool_access_mode,
            connector_search: data.connector_search,
            artifacts: data.artifacts,
          });
        }
        toast.error(
          resolveMessage(
            locale,
            "pages.workspace.settingsHub.capabilities.saveError",
          ),
        );
      }
    },
    [data, locale, reset, updateMutation],
  );

  return (
    <div
      data-component="CapabilitiesSettingsPanel"
      className="h-full space-y-6 overflow-y-auto p-4 sm:p-8"
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.capabilities.title",
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {resolveMessage(
            locale,
            "pages.workspace.settingsHub.capabilities.description",
          )}
        </p>
      </div>

      <Separator />

      {!hydrated || query.isPending ? (
        <div role="status" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.capabilities.loading",
            )}
          </p>
          <div className="space-y-4">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </div>
      ) : null}

      {hydrated && query.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon className="size-4" />
          <AlertTitle>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.capabilities.loadError",
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
                "pages.workspace.settingsHub.capabilities.retry",
              )}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <Alert>
            <InfoIcon className="size-4" />
            <AlertDescription className="text-xs text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.capabilities.appliesToNewAssessments",
              )}
            </AlertDescription>
          </Alert>

          <div className="divide-y divide-border/70 rounded-md border border-border/70">
            {/* Configurable: Tool access mode */}
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="settings-tool-access-mode"
                  >
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.toolAccessMode",
                    )}
                  </label>
                  <Badge variant="outline" className="text-xs">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.configurableBadge",
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.capabilities.toolAccessModeDescription",
                  )}
                </p>
              </div>
              <Controller
                control={control}
                name="tool_access_mode"
                render={({ field }) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          id="settings-tool-access-mode"
                          type="button"
                          variant="outline"
                          disabled={isUpdating}
                          className="w-full justify-between sm:w-56"
                        >
                          <span>
                            {field.value === TOOL_ACCESS_MODES.guided
                              ? resolveMessage(
                                  locale,
                                  "pages.workspace.settingsHub.capabilities.guidedMode",
                                )
                              : resolveMessage(
                                  locale,
                                  "pages.workspace.settingsHub.capabilities.loadToolsWhenNeeded",
                                )}
                          </span>
                          <ChevronDownIcon className="size-4 text-muted-foreground" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuRadioGroup
                        value={field.value}
                        onValueChange={(nextValue) => {
                          const mode = nextValue as ToolAccessMode;
                          field.onChange(mode);
                          void applyUpdate({ tool_access_mode: mode });
                        }}
                      >
                        <DropdownMenuRadioItem
                          value={TOOL_ACCESS_MODES.loadWhenNeeded}
                        >
                          {resolveMessage(
                            locale,
                            "pages.workspace.settingsHub.capabilities.loadToolsWhenNeeded",
                          )}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value={TOOL_ACCESS_MODES.guided}>
                          {resolveMessage(
                            locale,
                            "pages.workspace.settingsHub.capabilities.guidedMode",
                          )}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              />
            </div>

            {/* Configurable: Connector search */}
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.connectorSearch",
                    )}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.configurableBadge",
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.capabilities.connectorSearchDescription",
                  )}
                </p>
              </div>
              <Controller
                control={control}
                name="connector_search"
                render={({ field }) => (
                  <Switch
                    checked={Boolean(field.value)}
                    disabled={isUpdating}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      void applyUpdate({ connector_search: checked });
                    }}
                    aria-label={resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.connectorSearch",
                    )}
                  />
                )}
              />
            </div>

            {/* Configurable: Artifacts */}
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.artifacts",
                    )}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.configurableBadge",
                    )}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.capabilities.artifactsDescription",
                  )}
                </p>
              </div>
              <Controller
                control={control}
                name="artifacts"
                render={({ field }) => (
                  <Switch
                    checked={Boolean(field.value)}
                    disabled={isUpdating}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      void applyUpdate({ artifacts: checked });
                    }}
                    aria-label={resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.artifacts",
                    )}
                  />
                )}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.capabilities.executionTitle",
              )}
            </h3>

            <div className="divide-y divide-border/70 rounded-md border border-border/70">
              {/* System Policy: Cloud code execution */}
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {resolveMessage(
                        locale,
                        "pages.workspace.settingsHub.capabilities.cloudCodeExecution",
                      )}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {resolveMessage(
                        locale,
                        "pages.workspace.settingsHub.capabilities.systemPolicyBadge",
                      )}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.cloudCodeExecutionDescription",
                    )}
                  </p>
                </div>
                <Switch
                  checked={data.cloud_code_execution.enabled}
                  disabled
                  aria-label={resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.capabilities.cloudCodeExecution",
                  )}
                />
              </div>

              {/* System Policy: Network egress */}
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {resolveMessage(
                        locale,
                        "pages.workspace.settingsHub.capabilities.networkEgress",
                      )}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {resolveMessage(
                        locale,
                        "pages.workspace.settingsHub.capabilities.systemPolicyBadge",
                      )}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.networkEgressDescription",
                    )}
                  </p>
                </div>
                <Switch
                  checked={data.network_egress.enabled}
                  disabled
                  aria-label={resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.capabilities.networkEgress",
                  )}
                />
              </div>

              {/* Unsupported / System Policy: Domain allowlist */}
              <div className="space-y-3 bg-muted/30 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.capabilities.domainAllowlist",
                        )}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.capabilities.unsupportedBadge",
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {resolveMessage(
                        locale,
                        "pages.workspace.settingsHub.capabilities.domainAllowlistDescription",
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit text-xs">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.packageManagersOnly",
                    )}
                  </Badge>
                </div>

                <div className="flex items-start gap-2 rounded-md border border-border/60 bg-background/70 px-3 py-2.5 text-xs text-muted-foreground">
                  <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.domainAllowlistUnsupported",
                    )}
                  </span>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="settings-domain-input"
                    className="h-9 flex-1 text-xs"
                    disabled
                    placeholder={resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.domainInputPlaceholder",
                    )}
                  />
                  <Button type="button" className="h-9 sm:w-20" disabled>
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.capabilities.addDomain",
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
