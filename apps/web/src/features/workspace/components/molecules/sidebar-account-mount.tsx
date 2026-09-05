"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthSettingsProfileQuery } from "@/lib/api/auth-queries";

import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "@/features/settings/types/settings.types";
import { AccountPopover } from "./account-popover";
import { SidebarAccountTrigger } from "./sidebar-account-trigger";

type SidebarAccountMountProps = {
  onOpenSettings?: (section: SettingsSectionId) => void;
  onSignOut: () => void;
  signOutPending: boolean;
  userInitial: string;
  userName: string;
};

export function SidebarAccountMount({
  onOpenSettings,
  onSignOut,
  signOutPending,
  userInitial,
  userName,
}: SidebarAccountMountProps) {
  const [open, setOpen] = useState(false);
  const profileQuery = useAuthSettingsProfileQuery();
  const accountEmail = profileQuery.data?.email;

  function openSettings(section: SettingsSectionId) {
    setOpen(false);
    onOpenSettings?.(section);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <SidebarAccountTrigger
            open={open}
            userInitial={userInitial}
            userName={userName}
          />
        }
      />
      <AccountPopover
        accountEmail={accountEmail}
        onLanguage={() => openSettings(SETTINGS_SECTION_IDS.general)}
        onSettings={() => openSettings(SETTINGS_SECTION_IDS.general)}
        onSignOut={onSignOut}
        signOutPending={signOutPending}
      />
    </DropdownMenu>
  );
}
