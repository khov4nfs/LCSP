"use client";

import { resolveMessage } from "@lcsp/i18n";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { appLocale } from "@/lib/locale";

import { SettingsPage } from "./settings-page";
import type { SettingsSectionId } from "../../types/settings.types";

type SettingsModalProps = {
  activeSection: SettingsSectionId;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  open: boolean;
};

export function SettingsModal({
  activeSection,
  onOpenChange,
  onSectionChange,
  open,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent
          className="h-[calc(100svh-2rem)] max-h-205 w-[calc(100vw-2rem)] max-w-295 rounded-[14px] bg-card p-0 md:h-[calc(100svh-5rem)] [&_[data-slot=dialog-close]]:top-4.5 [&_[data-slot=dialog-close]]:right-5 [&_[data-slot=dialog-close]]:size-8"
          closeLabel={resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.closeLabel",
          )}
        >
          <DialogTitle className="sr-only">
            {resolveMessage(appLocale, "pages.workspace.settingsTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.description",
            )}
          </DialogDescription>
          <SettingsPage
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            presentation="modal"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
