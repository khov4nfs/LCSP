"use client";

import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { appLocale } from "@/lib/locale";

import type { ProviderCredentialDisconnectConfirmProps } from "../../types/provider-credential.types";

/**
 * Business purpose: Make the destructive consequence of disconnecting a provider explicit before it happens.
 * Business rules:
 * - Disconnecting needs an explicit confirm click; canceling leaves the credential untouched.
 * - Failures and canceled identity confirmation are announced and keep the provider connected.
 */
export function ProviderCredentialDisconnectConfirm({
  errorMessage,
  isPending,
  onCancel,
  onConfirm,
  reauthPending,
}: ProviderCredentialDisconnectConfirmProps) {
  const t = (key: Parameters<typeof resolveMessage>[1]) =>
    resolveMessage(appLocale, key);

  return (
    <div
      className="mt-4 flex min-h-0 flex-1 flex-col"
      data-component="ProviderCredentialDisconnectConfirm"
    >
      <h3 className="text-base font-semibold">
        {t("pages.workspace.settingsHub.repositories.disconnectConfirmTitle")}
      </h3>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">
        {t(
          "pages.workspace.settingsHub.repositories.disconnectConfirmDescription",
        )}
      </p>
      {errorMessage ? (
        <p role="alert" className="mt-3 text-xs font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {reauthPending ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {t("pages.workspace.settingsHub.reauth.description")}
        </p>
      ) : null}
      <DialogFooter className="mt-auto flex-row justify-end gap-2.5 px-0 pb-0">
        <Button
          className="h-9 w-23"
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
        >
          {t("pages.workspace.settingsHub.repositories.cancel")}
        </Button>
        <Button
          className="h-9 min-w-32"
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={onConfirm}
        >
          {t(
            isPending
              ? "pages.workspace.settingsHub.repositories.disconnecting"
              : "pages.workspace.settingsHub.repositories.disconnectConfirm",
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
