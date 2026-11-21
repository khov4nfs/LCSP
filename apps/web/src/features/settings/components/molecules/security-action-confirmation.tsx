"use client";

import { resolveMessage } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ACCOUNT_SECURITY_ACTIONS } from "../../config/account-security.config";
import type { SecurityConfirmationProps } from "../../types/account-security.types";

export function SecurityActionConfirmation({
  action,
  locale,
  onCancel,
  onConfirm,
}: SecurityConfirmationProps) {
  const disabling = action === ACCOUNT_SECURITY_ACTIONS.disable;
  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        closeLabel={resolveMessage(
          locale,
          "pages.workspace.settingsHub.reauth.close",
        )}
      >
        <DialogHeader className="flex-col gap-2">
          <DialogTitle className="text-lg leading-6 font-semibold">
            {resolveMessage(
              locale,
              disabling
                ? "pages.workspace.settingsHub.accountSecurity.disable"
                : "pages.workspace.settingsHub.accountSecurity.regenerate",
            )}
          </DialogTitle>
          <DialogDescription>
            {resolveMessage(
              locale,
              disabling
                ? "pages.workspace.settingsHub.accountSecurity.disableDescription"
                : "pages.workspace.settingsHub.accountSecurity.regenerateDescription",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.accountSecurity.cancel",
            )}
          </Button>
          <Button
            type="button"
            variant={disabling ? "destructive" : "default"}
            onClick={() => {
              if (action) onConfirm(action);
            }}
          >
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.accountSecurity.confirm",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
