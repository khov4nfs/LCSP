"use client";

import {
  BookOpenIcon,
  CircleHelpIcon,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { resolveAppMessage } from "@/lib/i18n";

import { AccountPopoverItem } from "./account-popover-item";

type AccountPopoverProps = {
  accountEmail?: string;
  onLanguage: () => void;
  onSettings: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
};

export function AccountPopover({
  accountEmail,
  onLanguage,
  onSettings,
  onSignOut,
  signOutPending,
}: AccountPopoverProps) {
  return (
    <DropdownMenuContent
      align="start"
      className="w-50 rounded-2xl border-border/80 bg-popover p-2 shadow-2xl"
      data-component="AccountPopover"
      side="top"
      sideOffset={8}
    >
      <DropdownMenuGroup>
        <DropdownMenuLabel className="truncate px-2 py-1.5 text-[12.5px] font-normal">
          {accountEmail ??
            resolveAppMessage(
              "pages.workspace.settingsHub.states.loadingAccount",
            )}
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuGroup>
        <AccountPopoverItem icon={SettingsIcon} onSelect={onSettings}>
          {resolveAppMessage("pages.appShell.settings")}
        </AccountPopoverItem>
        <AccountPopoverItem icon={GlobeIcon} onSelect={onLanguage}>
          {resolveAppMessage("pages.appShell.language")}
        </AccountPopoverItem>
        <AccountPopoverItem disabled icon={CircleHelpIcon}>
          {resolveAppMessage("pages.appShell.getHelp")}
        </AccountPopoverItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <AccountPopoverItem disabled icon={BookOpenIcon}>
          {resolveAppMessage("pages.appShell.documentation")}
        </AccountPopoverItem>
        <AccountPopoverItem disabled icon={InfoIcon} trailingChevron>
          {resolveAppMessage("pages.appShell.learnMore")}
        </AccountPopoverItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <AccountPopoverItem
          disabled={signOutPending}
          icon={LogOutIcon}
          onSelect={onSignOut}
          variant="destructive"
        >
          {resolveAppMessage("pages.appShell.signOut")}
        </AccountPopoverItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}
