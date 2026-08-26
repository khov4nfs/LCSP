"use client";

import { resolveMessage } from "@lcsp/i18n";
import { LinkIcon, UserIcon } from "lucide-react";

import { InfoGrid } from "@/components/molecules/info-grid";
import { SectionHeading } from "@/components/molecules/section-heading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";

import type { SettingsSectionSharedProps } from "../../types/settings-page.types";
import { formatDateTime } from "../../utils/settings-page.utils";

export function AccountSettingsSection({
  profile,
  oauthLinkStatus,
}: SettingsSectionSharedProps) {
  function startOAuthLink(provider: string) {
    window.location.href = `/api/auth/oauth/link/start?provider=${provider}`;
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.account.title",
        )}
        description={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.account.description",
        )}
        icon={<UserIcon className="size-4" />}
      />
      <InfoGrid
        rows={[
          {
            label: resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.displayName",
            ),
            value:
              profile?.display_name ??
              resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.states.notConfigured",
              ),
          },
          {
            label: resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.primaryEmail",
            ),
            value: profile?.email ?? "…",
          },
          {
            label: resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.accountRole",
            ),
            value: profile?.role ?? "…",
          },
          {
            label: resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.createdAt",
            ),
            value: formatDateTime(profile?.created_at),
          },
          {
            label: resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.labels.updatedAt",
            ),
            value: formatDateTime(profile?.updated_at),
          },
        ]}
      />
      {oauthLinkStatus === "success" ? (
        <Alert>
          <AlertTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthLinkSuccessTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthLinkSuccessDescription",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {oauthLinkStatus === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthLinkFailedTitle",
            )}
          </AlertTitle>
          <AlertDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthLinkFailedDescription",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthTitle",
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.account.oauthDescription",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => startOAuthLink("google")}
          >
            <LinkIcon className="size-4" />
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.actions.linkGoogle",
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
